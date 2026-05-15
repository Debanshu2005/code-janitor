const vscode = require("vscode");
const fs = require("fs").promises;
const path = require("path");

/**
 * Self-Healing Performance Monitor
 * Detects slow AI responses and automatically optimizes settings
 */
class PerformanceMonitor {
  constructor(context) {
    this.context = context;
    this.responseHistory = [];
    this.issueLog = []; // Track all issues: blocked commands, errors, warnings
    this.maxHistorySize = 30;
    this.maxIssueLogSize = 50;
    this.slowResponseThreshold = 30000; // Default 30 seconds, can be overridden by settings
    this.autoHealEnabled = true; // Can be overridden by settings
    this.pendingAutoHeal = null; // Store pending auto-heal to avoid interrupting responses
    this.autoHealCooldownMs = 10 * 60 * 1000;
    this.lastAutoHealAt = 0;
    this.lastAutoHealSummary = "";
    this.lastAutoHealChanges = [];
    this.onStateChange = null;
  }

  /**
   * Record an issue (blocked command, validation error, etc.)
   */
  recordIssue(type, details) {
    const issue = {
      type, // 'blocked_command', 'validation_error', 'file_error', 'timeout', 'api_error'
      details,
      timestamp: Date.now()
    };

    this.issueLog.push(issue);

    // Keep only recent issues
    if (this.issueLog.length > this.maxIssueLogSize) {
      this.issueLog.shift();
    }

    // Save metrics asynchronously
    this._saveMetrics().catch(err => {
      console.error("[PerformanceMonitor] Failed to save metrics:", err);
    });
  }

  /**
   * Get current settings
   */
  _getSettings() {
    const config = require("vscode").workspace.getConfiguration("codeJanitor.ai.selfHealing");
    return {
      enabled: config.get("enabled", true),
      slowThreshold: config.get("slowThreshold", 30000)
    };
  }

  _getAiSettings() {
    const config = require("vscode").workspace.getConfiguration("codeJanitor.ai");
    const provider = config.get("provider", "ollama");
    const genericModel = config.get("model", "");
    return {
      provider,
      model:
        provider === "nvidia"
          ? config.get("nvidiaModel", genericModel || "meta/llama-3.1-8b-instruct")
          : genericModel,
      timeout: config.get("timeout", 300000),
      gstackGateMode: config.get("gstackGateMode", "smart")
    };
  }

  _notifyStateChange() {
    if (typeof this.onStateChange !== "function") {
      return;
    }
    try {
      this.onStateChange();
    } catch (error) {
      console.warn("[Self-Heal] Failed to notify state change:", error);
    }
  }

  _getMetricsPath() {
    return path.join(this.context.globalStorageUri.fsPath, "performance-metrics.json");
  }

  _getAutoHealLogPath() {
    return path.join(this.context.globalStorageUri.fsPath, "auto-heal-log.json");
  }

  _buildRecommendationKey(recommendation = {}) {
    return [
      recommendation.type || "unknown",
      recommendation.from || "",
      recommendation.to || "",
      recommendation.reason || ""
    ].join("::");
  }

  _pushRecommendation(collection, recommendation, seenKeys) {
    if (!recommendation || !recommendation.type) {
      return;
    }
    const key = this._buildRecommendationKey(recommendation);
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    collection.push(recommendation);
  }

  _buildConsecutiveSlowStreak(responses = [], threshold = 0) {
    let streak = 0;
    for (let index = responses.length - 1; index >= 0; index -= 1) {
      const duration = Number(responses[index]?.duration) || 0;
      if (duration <= threshold) {
        break;
      }
      streak += 1;
    }
    return streak;
  }

  _calculateHealthScore(metrics = {}) {
    let score = 100;
    const threshold = Number(metrics.threshold) || 30000;
    const avgDuration = Number(metrics.avgDuration) || 0;
    const p95Duration = Number(metrics.p95Duration) || 0;
    const failureRate = Number(metrics.failureRate) || 0;
    const blockedCommands = Number(metrics.blockedCommands) || 0;
    const reliabilityIssues = Number(metrics.reliabilityIssues) || 0;
    const apiErrors = Number(metrics.apiErrors) || 0;
    const timeouts = Number(metrics.timeouts) || 0;
    const slowStreak = Number(metrics.slowStreak) || 0;

    if (avgDuration > threshold) {
      score -= Math.min(25, Math.round(((avgDuration - threshold) / threshold) * 20));
    }
    if (p95Duration > threshold) {
      score -= Math.min(20, Math.round(((p95Duration - threshold) / threshold) * 12));
    }

    score -= Math.round(failureRate * 35);
    score -= Math.min(10, blockedCommands * 2);
    score -= Math.min(16, reliabilityIssues * 4);
    score -= Math.min(14, apiErrors * 5);
    score -= Math.min(12, timeouts * 4);
    score -= Math.min(12, slowStreak * 3);

    return Math.max(0, Math.min(100, score));
  }

  _getActionableRecommendations(recommendations = []) {
    return (recommendations || []).filter((recommendation) =>
      ["switch_model", "increase_timeout", "enable_gstack_gate"].includes(
        recommendation.type
      )
    );
  }

  setAutoHealEnabled(enabled) {
    this.autoHealEnabled = !!enabled;
    this._notifyStateChange();
  }

  _formatDuration(duration) {
    const ms = Number(duration) || 0;
    if (ms >= 60000) {
      return `${(ms / 60000).toFixed(1)} min`;
    }
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)} s`;
    }
    return `${Math.round(ms)} ms`;
  }

  _formatPercent(rate) {
    return `${((Number(rate) || 0) * 100).toFixed(0)}%`;
  }

  _calculatePercentile(values, percentile) {
    const numericValues = (values || [])
      .map((value) => Number(value) || 0)
      .filter((value) => value >= 0)
      .sort((a, b) => a - b);

    if (numericValues.length === 0) {
      return 0;
    }

    const index = Math.min(
      numericValues.length - 1,
      Math.max(
        0,
        Math.ceil((Number(percentile) || 0) / 100 * numericValues.length) - 1
      )
    );
    return numericValues[index];
  }

  _buildIssueCounts(issueLog = []) {
    const counts = {};
    for (const issue of issueLog) {
      const type = String(issue?.type || "unknown");
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }

  _buildPerformanceTrend(recentResponses = [], previousResponses = []) {
    if (!recentResponses.length) {
      return {
        direction: "flat",
        summary: "No recent responses recorded yet.",
        recentAverage: 0,
        previousAverage: 0,
        delta: 0
      };
    }

    const recentAverage =
      recentResponses.reduce((sum, response) => sum + (Number(response.duration) || 0), 0) /
      recentResponses.length;
    const previousAverage = previousResponses.length
      ? previousResponses.reduce((sum, response) => sum + (Number(response.duration) || 0), 0) /
        previousResponses.length
      : recentAverage;
    const delta = recentAverage - previousAverage;
    const normalizedDelta = previousAverage > 0 ? delta / previousAverage : 0;

    let direction = "flat";
    if (normalizedDelta >= 0.15) {
      direction = "worsening";
    } else if (normalizedDelta <= -0.15) {
      direction = "improving";
    }

    const summary =
      direction === "worsening"
        ? `Latency is trending up by ${this._formatPercent(Math.abs(normalizedDelta))} versus the previous window.`
        : direction === "improving"
          ? `Latency improved by ${this._formatPercent(Math.abs(normalizedDelta))} versus the previous window.`
          : "Latency is holding steady across the last two windows.";

    return {
      direction,
      summary,
      recentAverage,
      previousAverage,
      delta
    };
  }

  _buildResponseBreakdown(responses = []) {
    const buckets = new Map();

    for (const response of responses) {
      const provider = String(response?.provider || "unknown");
      const model = String(response?.model || "unknown");
      const key = `${provider}::${model}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          provider,
          model,
          count: 0,
          durations: [],
          failures: 0,
          successes: 0,
          latestTimestamp: 0
        });
      }

      const bucket = buckets.get(key);
      const duration = Number(response?.duration) || 0;
      bucket.count += 1;
      bucket.durations.push(duration);
      bucket.latestTimestamp = Math.max(
        bucket.latestTimestamp,
        Number(response?.timestamp) || 0
      );
      if (response?.success) {
        bucket.successes += 1;
      } else {
        bucket.failures += 1;
      }
    }

    return Array.from(buckets.values())
      .map((bucket) => ({
        provider: bucket.provider,
        model: bucket.model,
        count: bucket.count,
        avgDuration:
          bucket.durations.reduce((sum, duration) => sum + duration, 0) /
          Math.max(bucket.durations.length, 1),
        p95Duration: this._calculatePercentile(bucket.durations, 95),
        failureRate: bucket.failures / Math.max(bucket.count, 1),
        latestTimestamp: bucket.latestTimestamp
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return right.latestTimestamp - left.latestTimestamp;
      });
  }

  _buildRecentTimeline(responses = [], limit = 8) {
    return (responses || [])
      .slice(-limit)
      .map((response) => ({
        provider: String(response?.provider || "unknown"),
        model: String(response?.model || "unknown"),
        duration: Number(response?.duration) || 0,
        success: !!response?.success,
        timestamp: Number(response?.timestamp) || 0
      }))
      .reverse();
  }

  _buildPerformanceSummaryMessage(status, metrics = {}) {
    const avg = this._formatDuration(metrics.avgDuration || 0);
    const p95 = this._formatDuration(metrics.p95Duration || 0);
    const healthScore = Number(metrics.healthScore) || 0;

    if (status === "insufficient_data") {
      return "Code Janitor needs a few more AI runs before the performance review becomes meaningful.";
    }
    if (status === "needs_optimization") {
      return `Recent AI work is under strain. Average latency is ${avg}, p95 latency is ${p95}, and the health score is ${healthScore}.`;
    }
    if (status === "watch") {
      return `Code Janitor is working, but there are warning signs. Average latency is ${avg}, p95 latency is ${p95}, and the health score is ${healthScore}.`;
    }
    return `Code Janitor looks healthy. Average latency is ${avg}, p95 latency is ${p95}, and the health score is ${healthScore}.`;
  }

  getAutoHealUiState(analysis = this.analyzePerformance()) {
    const settings = this._getSettings();
    const thresholdLabel = this._formatDuration(settings.slowThreshold || 0);
    const recommendationCount = (analysis.recommendations || []).length;
    const actionableCount = this._getActionableRecommendations(
      analysis.recommendations
    ).length;
    const recentIssueCount = (analysis.issueLog || []).length;
    const autoHealEnabled = settings.enabled;
    const healthScore = Number(analysis.healthScore) || 0;
    const cooldownRemainingMs =
      this.lastAutoHealAt > 0
        ? Math.max(
            0,
            this.autoHealCooldownMs - (Date.now() - Number(this.lastAutoHealAt || 0))
          )
        : 0;

    let badge = autoHealEnabled ? "Auto-heal on" : "Auto-heal off";
    let summary = `Watching latency, failures, and edit safety. Threshold ${thresholdLabel}.`;

    if (!autoHealEnabled) {
      summary = `Monitoring is paused. Re-enable auto-heal to react to slow or flaky runs. Threshold ${thresholdLabel}.`;
    } else if (analysis.status === "insufficient_data") {
      summary = `Learning from the first ${analysis.responseCount || 0} AI runs. Threshold ${thresholdLabel}.`;
    } else if (analysis.status === "needs_optimization") {
      badge = actionableCount > 0 ? "Auto-heal ready" : "Health warning";
      summary = `${recommendationCount} recommendation(s) found. Health score ${healthScore}. p95 is ${this._formatDuration(analysis.p95Duration || 0)}.`;
    } else if (analysis.status === "watch") {
      badge = "Watching closely";
      summary = `${recentIssueCount} recent issue(s), ${analysis.slowResponses || 0} slow run(s), score ${healthScore}.`;
    } else if (this.lastAutoHealSummary) {
      summary = this.lastAutoHealSummary;
    }

    if (cooldownRemainingMs > 0 && autoHealEnabled) {
      summary += ` Cooldown ${this._formatDuration(cooldownRemainingMs)} remaining.`;
    }

    return {
      enabled: autoHealEnabled,
      status: analysis.status || "healthy",
      badge,
      summary,
      thresholdLabel,
      recommendationCount,
      actionableCount,
      healthScore,
      responseCount: analysis.responseCount || 0,
      recentIssueCount,
      lastAutoHealAt: this.lastAutoHealAt || 0
    };
  }

  /**
   * Record an AI response time
   */
  recordResponse(provider, model, duration, success) {
    const record = {
      provider,
      model,
      duration,
      success,
      timestamp: Date.now()
    };

    this.responseHistory.push(record);

    // Keep only recent history
    if (this.responseHistory.length > this.maxHistorySize) {
      this.responseHistory.shift();
    }

    // Check settings before triggering auto-heal
    const settings = this._getSettings();
    this.autoHealEnabled = settings.enabled;
    const shouldTriggerAutoHeal =
      settings.enabled && duration > settings.slowThreshold;

    // Use threshold from settings
    if (shouldTriggerAutoHeal) {
      // Delay auto-heal notification to avoid interrupting response rendering
      setTimeout(() => {
        this._triggerAutoHeal(provider, model, duration, settings.slowThreshold);
      }, 2000); // 2 second delay after response completes
    }

    // Save metrics asynchronously (fire and forget)
    this._saveMetrics().catch(err => {
      console.error("[PerformanceMonitor] Failed to save metrics:", err);
    });
  }

  /**
   * Analyze performance and suggest optimizations
   */
  analyzePerformance() {
    const settings = this._getSettings();
    this.autoHealEnabled = settings.enabled;
    const aiSettings = this._getAiSettings();
    const totalResponses = this.responseHistory.length;
    const recentResponses = this.responseHistory.slice(-10);
    const previousResponses = this.responseHistory.slice(-20, -10);
    const recentIssues = this.issueLog.slice(-20);
    const issueCounts = this._buildIssueCounts(recentIssues);
    const providerStats = this._buildResponseBreakdown(recentResponses);
    const timeline = this._buildRecentTimeline(this.responseHistory);

    if (totalResponses < 5) {
      return {
        status: "insufficient_data",
        message: this._buildPerformanceSummaryMessage("insufficient_data"),
        issues: [],
        recommendations: [],
        actionableRecommendations: [],
        issueLog: recentIssues,
        issueCounts,
        settings: {
          slowThreshold: settings.slowThreshold,
          autoHealEnabled: settings.enabled,
          gstackGateMode: aiSettings.gstackGateMode,
          timeout: aiSettings.timeout,
          provider: aiSettings.provider,
          model: aiSettings.model
        },
        responseCount: totalResponses,
        recentWindowSize: recentResponses.length,
        providerStats,
        timeline,
        healthScore: 100,
        consecutiveSlowResponses: 0
      };
    }

    const threshold = settings.slowThreshold;
    const durations = recentResponses.map((response) => Number(response.duration) || 0);
    const avgDuration =
      durations.reduce((sum, duration) => sum + duration, 0) /
      Math.max(durations.length, 1);
    const medianDuration = this._calculatePercentile(durations, 50);
    const p95Duration = this._calculatePercentile(durations, 95);
    const slowResponses = recentResponses.filter(r => r.duration > threshold);
    const failureRate = recentResponses.filter(r => !r.success).length / recentResponses.length;
    const successRate = 1 - failureRate;
    const trend = this._buildPerformanceTrend(recentResponses, previousResponses);
    const consecutiveSlowResponses = this._buildConsecutiveSlowStreak(
      recentResponses,
      threshold
    );
    const slowestResponse = recentResponses.reduce((slowest, response) => {
      if (!slowest || (Number(response.duration) || 0) > (Number(slowest.duration) || 0)) {
        return response;
      }
      return slowest;
    }, null);
    const lastResponse = recentResponses[recentResponses.length - 1] || null;

    const issues = [];
    const recommendations = [];
    const recommendationKeys = new Set();

    // Detect slow model
    if (avgDuration > threshold) {
      issues.push(
        `Average response time is ${this._formatDuration(avgDuration)} against a ${this._formatDuration(threshold)} threshold.`
      );
      
      const slowModel = this._getMostCommonSlowModel(recentResponses, threshold);
      if (slowModel) {
        const fasterAlternative = this._getFasterAlternative(slowModel);
        if (fasterAlternative && fasterAlternative !== slowModel) {
          this._pushRecommendation(
            recommendations,
            {
              type: "switch_model",
              from: slowModel,
              to: fasterAlternative,
              reason: "Current model is consistently slow"
            },
            recommendationKeys
          );
        }
      }
    }

    if (p95Duration > threshold * 1.25) {
      issues.push(
        `Tail latency is high: p95 response time reached ${this._formatDuration(p95Duration)}.`
      );
    }

    // Detect high failure rate
    if (failureRate > 0.3) {
      issues.push(`Failure rate is elevated at ${this._formatPercent(failureRate)}.`);
      this._pushRecommendation(
        recommendations,
        {
          type: "increase_timeout",
          reason: "Many requests are timing out or failing before completion."
        },
        recommendationKeys
      );
    }

    if (trend.direction === "worsening") {
      issues.push(trend.summary);
    }

    if (consecutiveSlowResponses >= 2) {
      issues.push(
        `${consecutiveSlowResponses} consecutive recent response(s) crossed the slow threshold.`
      );
    }

    // Analyze issue log
    const blockedCommands = recentIssues.filter(i => i.type === "blocked_command");
    const validationErrors = recentIssues.filter(i => i.type === "validation_error");
    const fileErrors = recentIssues.filter(i => i.type === "file_error");
    const apiErrors = recentIssues.filter(i => i.type === "api_error");
    const timeouts = recentIssues.filter(i => i.type === "timeout");
    
    if (blockedCommands.length > 0) {
      issues.push(`${blockedCommands.length} generated command(s) were blocked in recent operations.`);
    }
    if (validationErrors.length > 0) {
      issues.push(`${validationErrors.length} validation error(s) were detected after AI work.`);
    }
    if (fileErrors.length > 0) {
      issues.push(`${fileErrors.length} file operation error(s) were recorded.`);
    }
    if (apiErrors.length > 0) {
      issues.push(`${apiErrors.length} API error(s) were logged.`);
    }
    if (timeouts.length > 0) {
      issues.push(`${timeouts.length} timeout event(s) were recorded.`);
    }

    const editReliabilityIssues = validationErrors.length + fileErrors.length;
    if (editReliabilityIssues >= 3) {
      const targetGateMode =
        aiSettings.gstackGateMode === "off" ? "smart" : "always";
      this._pushRecommendation(
        recommendations,
        {
          type: "enable_gstack_gate",
          to: targetGateMode,
          reason: "Recent edit failures suggest adding stronger plan review before execution."
        },
        recommendationKeys
      );
    }

    if (blockedCommands.length >= 3) {
      this._pushRecommendation(
        recommendations,
        {
          type: "review_command_scope",
          reason: "The agent is generating commands that your safety rules are rejecting."
        },
        recommendationKeys
      );
    }

    if (p95Duration > threshold * 1.5 && failureRate <= 0.3) {
      this._pushRecommendation(
        recommendations,
        {
          type: "stay_in_fast_mode",
          reason: "Heavy requests are showing long tail latency. Prefer Fast mode for lighter chat loops."
        },
        recommendationKeys
      );
    }

    if (apiErrors.length >= 2 || timeouts.length >= 2) {
      this._pushRecommendation(
        recommendations,
        {
          type: "inspect_provider_connection",
          reason: "Provider connectivity looks unstable. Review the current provider, model, and network path."
        },
        recommendationKeys
      );
    }

    if (
      consecutiveSlowResponses >= 3 ||
      (avgDuration > threshold && p95Duration > threshold * 1.5)
    ) {
      this._pushRecommendation(
        recommendations,
        {
          type: "reduce_context_pressure",
          reason: "Recent runs look context-heavy. Prefer smaller edits, narrower prompts, or split the task."
        },
        recommendationKeys
      );
    }

    const healthScore = this._calculateHealthScore({
      threshold,
      avgDuration,
      p95Duration,
      failureRate,
      blockedCommands: blockedCommands.length,
      reliabilityIssues: editReliabilityIssues,
      apiErrors: apiErrors.length,
      timeouts: timeouts.length,
      slowStreak: consecutiveSlowResponses
    });
    const actionableRecommendations = this._getActionableRecommendations(
      recommendations
    );

    let status = "healthy";
    if (healthScore <= 64 || actionableRecommendations.length >= 2) {
      status = "needs_optimization";
    } else if (
      slowResponses.length > 0 ||
      blockedCommands.length > 0 ||
      validationErrors.length > 0 ||
      trend.direction === "worsening" ||
      healthScore < 85
    ) {
      status = "watch";
    }

    return {
      status,
      message: this._buildPerformanceSummaryMessage(status, {
        avgDuration,
        p95Duration,
        healthScore
      }),
      avgDuration,
      medianDuration,
      p95Duration,
      healthScore,
      slowResponses: slowResponses.length,
      consecutiveSlowResponses,
      failureRate,
      successRate,
      issues,
      recommendations,
      actionableRecommendations,
      issueLog: recentIssues,
      issueCounts,
      trend,
      providerStats,
      timeline,
      slowestResponse,
      lastResponse,
      responseCount: totalResponses,
      recentWindowSize: recentResponses.length,
      settings: {
        slowThreshold: threshold,
        autoHealEnabled: settings.enabled,
        gstackGateMode: aiSettings.gstackGateMode,
        timeout: aiSettings.timeout,
        provider: aiSettings.provider,
        model: aiSettings.model
      }
    };
  }

  /**
   * Auto-heal: automatically apply optimizations
   */
  async _triggerAutoHeal(provider, model, duration, threshold) {
    console.log(`[Self-Heal] Detected slow response: ${model} took ${duration}ms (threshold: ${threshold}ms)`);

    // Prevent duplicate notifications
    if (this.pendingAutoHeal) {
      console.log("[Self-Heal] Auto-heal already pending, skipping duplicate notification");
      return;
    }

    if (
      this.lastAutoHealAt &&
      Date.now() - this.lastAutoHealAt < this.autoHealCooldownMs
    ) {
      return;
    }

    const analysis = this.analyzePerformance();
    if (analysis.status !== "needs_optimization") {
      return;
    }
    const actionableRecommendations = this._getActionableRecommendations(
      analysis.recommendations
    );
    if (actionableRecommendations.length === 0) {
      return;
    }

    this.pendingAutoHeal = true;

    // Show notification with auto-heal option
    const action = await vscode.window.showWarningMessage(
      `⚠️ Code Janitor detected slow AI responses (${(duration / 1000).toFixed(1)}s). Auto-optimize settings?`,
      "Apply Safe Fixes",
      "Review Health",
      "Not Now",
      "Disable Auto-Heal"
    );

    this.pendingAutoHeal = null;

    if (action === "Apply Safe Fixes") {
      await this._applyOptimizations(actionableRecommendations);
    } else if (action === "Review Health") {
      await this.showPerformanceReview(analysis);
    } else if (action === "Disable Auto-Heal") {
      // Disable in settings permanently
      const cfg = vscode.workspace.getConfiguration("codeJanitor.ai.selfHealing");
      await cfg.update("enabled", false, vscode.ConfigurationTarget.Global);
      this.autoHealEnabled = false;
      this.lastAutoHealSummary = "Auto-heal was disabled from the performance warning prompt.";
      this._notifyStateChange();
      vscode.window.showInformationMessage("✅ Self-healing disabled. You can re-enable it in settings (codeJanitor.ai.selfHealing.enabled).");
    }
    // If "Not Now" is clicked, keep the current settings and continue monitoring.
  }

  /**
   * Apply recommended optimizations
   */
  async _applyOptimizations(recommendations) {
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const applied = [];

    for (const rec of recommendations) {
      try {
        if (rec.type === "switch_model") {
          // CRITICAL: Only switch if user explicitly clicks "Auto-Fix Now"
          // Don't auto-switch providers - stay on current provider
          const currentProvider = cfg.get("provider", "ollama");
          
          // Update model within the SAME provider
          if (currentProvider === "nvidia") {
            await cfg.update("nvidiaModel", rec.to, vscode.ConfigurationTarget.Global);
          } else if (currentProvider === "groq") {
            await cfg.update("model", rec.to, vscode.ConfigurationTarget.Global);
          } else if (currentProvider === "openrouter") {
            await cfg.update("model", rec.to, vscode.ConfigurationTarget.Global);
          } else {
            // For ollama and others, update generic model
            await cfg.update("model", rec.to, vscode.ConfigurationTarget.Global);
          }

          applied.push(`Switched model: ${rec.from} → ${rec.to}`);
        } else if (rec.type === "increase_timeout") {
          const currentTimeout = cfg.get("timeout", 180000);
          const newTimeout = Math.min(currentTimeout * 1.5, 600000); // Max 10 minutes
          await cfg.update("timeout", newTimeout, vscode.ConfigurationTarget.Global);
          applied.push(`Increased timeout: ${currentTimeout / 1000}s → ${newTimeout / 1000}s`);
        } else if (rec.type === "enable_gstack_gate") {
          const nextGateMode =
            rec.to === "always" || rec.to === "smart" ? rec.to : "smart";
          await cfg.update(
            "gstackGateMode",
            nextGateMode,
            vscode.ConfigurationTarget.Global
          );
          applied.push(`Raised GStack gate mode to ${nextGateMode}`);
        }
      } catch (error) {
        console.error("[Self-Heal] Failed to apply optimization:", error);
      }
    }

    if (applied.length > 0) {
      this.lastAutoHealAt = Date.now();
      this.lastAutoHealSummary = `Applied ${applied.length} auto-heal change(s): ${applied.join(", ")}.`;
      this.lastAutoHealChanges = applied.slice();
      vscode.window.showInformationMessage(
        `✅ Auto-optimized Code Janitor:\n${applied.join("\n")}`,
        "View Settings"
      ).then(action => {
        if (action === "View Settings") {
          vscode.commands.executeCommand("workbench.action.openSettings", "codeJanitor.ai");
        }
      });

      // Log the auto-heal event
      await this._logAutoHeal(applied, {
        summary: this.lastAutoHealSummary
      });
      this._notifyStateChange();
    }
  }

  /**
   * Get faster alternative for a slow model (within same provider)
   */
  _getFasterAlternative(slowModel) {
    // NVIDIA provider alternatives
    const nvidiaAlternatives = {
      "minimaxai/minimax-m2.7": "meta/llama-3.1-8b-instruct",
      "meta/llama-3.1-70b-instruct": "meta/llama-3.1-8b-instruct",
      "nvidia/llama-3.3-nemotron-super-49b-v1.5": "meta/llama-3.1-8b-instruct"
    };
    
    // Groq provider alternatives
    const groqAlternatives = {
      "llama-3.1-70b-versatile": "llama-3.1-8b-instant",
      "llama-3.3-70b-versatile": "llama-3.1-8b-instant",
      "mixtral-8x7b-32768": "llama-3.1-8b-instant"
    };
    
    // OpenRouter alternatives
    const openrouterAlternatives = {
      "qwen/qwen-2.5-coder-32b-instruct": "qwen/qwen-2.5-coder-7b-instruct",
      "meta-llama/llama-3.1-70b-instruct": "meta-llama/llama-3.1-8b-instruct:free"
    };

    // Check which provider this model belongs to
    if (nvidiaAlternatives[slowModel]) {
      return nvidiaAlternatives[slowModel];
    }
    if (groqAlternatives[slowModel]) {
      return groqAlternatives[slowModel];
    }
    if (openrouterAlternatives[slowModel]) {
      return openrouterAlternatives[slowModel];
    }
    
    // Default: return the same model (no switch)
    return slowModel;
  }

  /**
   * Find the most common slow model
   */
  _getMostCommonSlowModel(responses, threshold) {
    const slowModels = responses
      .filter(r => r.duration > threshold)
      .map(r => r.model);

    if (slowModels.length === 0) return null;

    const counts = {};
    slowModels.forEach(model => {
      counts[model] = (counts[model] || 0) + 1;
    });

    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
  }

  /**
   * Show detailed performance report
   */
  _showPerformanceReport(analysis) {
    const panel = vscode.window.createWebviewPanel(
      "codeJanitorPerformance",
      "Code Janitor Performance",
      vscode.ViewColumn.One,
      {}
    );

    const issues = analysis.issues || [];
    const recommendations = analysis.recommendations || [];
    const avgDuration = analysis.avgDuration || 0;
    const slowResponses = analysis.slowResponses || 0;
    const failureRate = analysis.failureRate || 0;
    const issueLog = analysis.issueLog || [];

    // Group issues by type
    const blockedCommands = issueLog.filter(i => i.type === "blocked_command");
    const validationErrors = issueLog.filter(i => i.type === "validation_error");
    const fileErrors = issueLog.filter(i => i.type === "file_error");
    const apiErrors = issueLog.filter(i => i.type === "api_error");
    const timeouts = issueLog.filter(i => i.type === "timeout");

    const formatIssueList = (issueArray, title) => {
      if (issueArray.length === 0) return "";
      return `
        <h3>${title} (${issueArray.length})</h3>
        <ul>
          ${issueArray.map(issue => {
            const time = new Date(issue.timestamp).toLocaleTimeString();
            const details = typeof issue.details === "string" 
              ? issue.details 
              : JSON.stringify(issue.details);
            return `<li><strong>${time}:</strong> ${details}</li>`;
          }).join("")}
        </ul>
      `;
    };

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
          h1 { color: #007acc; }
          h2 { color: #333; margin-top: 20px; }
          h3 { color: #555; margin-top: 15px; font-size: 1.1em; }
          ul { line-height: 1.8; }
          .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
          .healthy { background: #d4edda; color: #155724; }
          .needs_optimization { background: #fff3cd; color: #856404; }
          .insufficient_data { background: #e7f3ff; color: #004085; }
          .issue-section { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .blocked { color: #dc3545; }
          .error { color: #fd7e14; }
        </style>
      </head>
      <body>
        <h1>📊 Code Janitor Performance Report</h1>
        <div class="status ${analysis.status}">${analysis.status.replace(/_/g, " ").toUpperCase()}</div>
        ${analysis.message ? `<p>${analysis.message}</p>` : ""}
        ${avgDuration > 0 ? `<p><strong>Average Response Time:</strong> ${(avgDuration / 1000).toFixed(1)}s</p>` : ""}
        ${avgDuration > 0 ? `<p><strong>Slow Responses:</strong> ${slowResponses} / ${this.responseHistory.length}</p>` : ""}
        ${avgDuration > 0 ? `<p><strong>Failure Rate:</strong> ${(failureRate * 100).toFixed(0)}%</p>` : ""}
        
        <h2>🔍 Issues Detected</h2>
        ${issues.length > 0 ? `<ul>${issues.map(i => `<li>${i}</li>`).join("")}</ul>` : "<p>No issues detected.</p>"}
        
        <h2>💡 Recommendations</h2>
        ${recommendations.length > 0 ? `<ul>${recommendations.map(rec => {
          if (rec.type === "switch_model") {
            return `<li>Switch from <strong>${rec.from}</strong> to <strong>${rec.to}</strong> (${rec.reason})</li>`;
          } else if (rec.type === "increase_timeout") {
            return `<li>Increase timeout setting (${rec.reason})</li>`;
          }
          return `<li>${rec.reason}</li>`;
        }).join("")}</ul>` : "<p>No recommendations at this time.</p>"}
        
        ${issueLog.length > 0 ? `
          <h2>🚨 Recent Issues Log</h2>
          <div class="issue-section">
            ${formatIssueList(blockedCommands, "🚫 Blocked Commands")}
            ${formatIssueList(validationErrors, "⚠️ Validation Errors")}
            ${formatIssueList(fileErrors, "📁 File Operation Errors")}
            ${formatIssueList(apiErrors, "🌐 API Errors")}
            ${formatIssueList(timeouts, "⏱️ Timeouts")}
          </div>
        ` : ""}
      </body>
      </html>
    `;
  }

  _escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async showPerformanceReview(analysis = this.analyzePerformance()) {
    const panel = vscode.window.createWebviewPanel(
      "codeJanitorPerformance",
      "Code Janitor Performance",
      vscode.ViewColumn.One,
      {}
    );

    const issues = analysis.issues || [];
    const recommendations = analysis.recommendations || [];
    const avgDuration = analysis.avgDuration || 0;
    const medianDuration = analysis.medianDuration || 0;
    const p95Duration = analysis.p95Duration || 0;
    const slowResponses = analysis.slowResponses || 0;
    const failureRate = analysis.failureRate || 0;
    const successRate = analysis.successRate || 0;
    const issueLog = analysis.issueLog || [];
    const issueCounts = analysis.issueCounts || {};
    const providerStats = analysis.providerStats || [];
    const timeline = analysis.timeline || [];
    const trend = analysis.trend || { direction: "flat", summary: "No trend data yet." };
    const settings = analysis.settings || {};
    const autoHealHistory = await this.getAutoHealHistory();

    const metricCard = (label, value, tone = "") => `
      <div class="metric-card ${tone}">
        <div class="metric-label">${label}</div>
        <div class="metric-value">${value}</div>
      </div>
    `;

    const recommendationCopy = (recommendation) => {
      if (recommendation.type === "switch_model") {
        return `Switch <strong>${this._escapeHtml(recommendation.from)}</strong> to <strong>${this._escapeHtml(recommendation.to)}</strong>.<span>${this._escapeHtml(recommendation.reason)}</span>`;
      }
      if (recommendation.type === "increase_timeout") {
        return `Increase timeout.<span>${this._escapeHtml(recommendation.reason)}</span>`;
      }
      if (recommendation.type === "enable_gstack_gate") {
        return `Set GStack gate mode to <strong>${this._escapeHtml(recommendation.to)}</strong>.<span>${this._escapeHtml(recommendation.reason)}</span>`;
      }
      if (recommendation.type === "review_command_scope") {
        return `Tighten command usage.<span>${this._escapeHtml(recommendation.reason)}</span>`;
      }
      if (recommendation.type === "stay_in_fast_mode") {
        return `Prefer Fast mode for routine loops.<span>${this._escapeHtml(recommendation.reason)}</span>`;
      }
      return this._escapeHtml(recommendation.reason || "Review this recommendation.");
    };

    const recommendationItems = recommendations.length
      ? recommendations
          .map(
            (recommendation) =>
              `<li class="recommendation-item">${recommendationCopy(recommendation)}</li>`
          )
          .join("")
      : "<li class=\"recommendation-item quiet\">No urgent changes are recommended right now.</li>";

    const issueListMarkup = issues.length
      ? `<ul class="bullets">${issues
          .map((issue) => `<li>${this._escapeHtml(issue)}</li>`)
          .join("")}</ul>`
      : "<div class=\"empty-state\">No issues detected in the latest review window.</div>";

    const issuePills = Object.keys(issueCounts).length
      ? Object.entries(issueCounts)
          .sort((left, right) => right[1] - left[1])
          .map(
            ([type, count]) =>
              `<div class="issue-pill"><strong>${count}</strong> ${this._escapeHtml(type.replace(/_/g, " "))}</div>`
          )
          .join("")
      : "<div class=\"issue-pill quiet\">No recent issue types logged.</div>";

    const providerRows = providerStats.length
      ? providerStats
          .map(
            (entry) => `
              <tr>
                <td>${this._escapeHtml(entry.provider)}</td>
                <td>${this._escapeHtml(entry.model)}</td>
                <td>${entry.count}</td>
                <td>${this._formatDuration(entry.avgDuration)}</td>
                <td>${this._formatDuration(entry.p95Duration)}</td>
                <td>${this._formatPercent(entry.failureRate)}</td>
              </tr>
            `
          )
          .join("")
      : "<tr><td colspan=\"6\" class=\"empty-cell\">No recent provider data available.</td></tr>";

    const timelineRows = timeline.length
      ? timeline
          .map(
            (entry) => `
              <tr>
                <td>${this._escapeHtml(new Date(entry.timestamp).toLocaleTimeString())}</td>
                <td>${this._escapeHtml(entry.provider)}</td>
                <td>${this._escapeHtml(entry.model)}</td>
                <td>${this._formatDuration(entry.duration)}</td>
                <td class="${entry.success ? "good" : "bad"}">${entry.success ? "Success" : "Failed"}</td>
              </tr>
            `
          )
          .join("")
      : "<tr><td colspan=\"5\" class=\"empty-cell\">No recent response timeline available.</td></tr>";

    const issueRows = issueLog.length
      ? issueLog
          .slice()
          .reverse()
          .map((issue) => {
            const details =
              typeof issue.details === "string"
                ? issue.details
                : JSON.stringify(issue.details, null, 2);
            return `
              <tr>
                <td>${this._escapeHtml(new Date(issue.timestamp).toLocaleTimeString())}</td>
                <td>${this._escapeHtml(String(issue.type || "unknown").replace(/_/g, " "))}</td>
                <td><pre>${this._escapeHtml(details)}</pre></td>
              </tr>
            `;
          })
          .join("")
      : "<tr><td colspan=\"3\" class=\"empty-cell\">No recent issue log entries.</td></tr>";

    const autoHealRows = autoHealHistory.length
      ? autoHealHistory
          .slice(-6)
          .reverse()
          .map(
            (entry) => `
              <tr>
                <td>${this._escapeHtml(new Date(entry.timestamp).toLocaleString())}</td>
                <td>${this._escapeHtml((entry.changes || []).join(", "))}</td>
              </tr>
            `
          )
          .join("")
      : "<tr><td colspan=\"2\" class=\"empty-cell\">No auto-heal actions have been recorded yet.</td></tr>";

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          :root {
            --border: #243244;
            --text: #e6edf3;
            --muted: #8ba0b6;
            --accent: #58a6ff;
            --green: #3fb950;
            --yellow: #d29922;
            --red: #f85149;
            --shadow: rgba(0, 0, 0, 0.24);
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 24px;
            background:
              radial-gradient(circle at top, rgba(88, 166, 255, 0.12), transparent 28%),
              linear-gradient(180deg, #0b0f14 0%, #0d1117 100%);
            color: var(--text);
            font-family: "Segoe UI", "SF Pro Text", system-ui, sans-serif;
          }
          .page {
            max-width: 1180px;
            margin: 0 auto;
            display: grid;
            gap: 18px;
          }
          .hero,
          .panel {
            background: rgba(17, 24, 39, 0.92);
            border: 1px solid var(--border);
            border-radius: 18px;
            box-shadow: 0 18px 40px var(--shadow);
          }
          .hero { padding: 22px 24px; }
          .hero-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            flex-wrap: wrap;
          }
          h1 {
            margin: 0;
            font-size: 28px;
            line-height: 1.1;
          }
          .hero-copy { max-width: 760px; }
          .hero-copy p {
            margin: 10px 0 0;
            color: var(--muted);
            line-height: 1.6;
          }
          .status-badge {
            padding: 10px 14px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            border: 1px solid var(--border);
          }
          .status-badge.healthy {
            color: var(--green);
            background: rgba(63, 185, 80, 0.12);
            border-color: rgba(63, 185, 80, 0.28);
          }
          .status-badge.watch {
            color: var(--yellow);
            background: rgba(210, 153, 34, 0.12);
            border-color: rgba(210, 153, 34, 0.28);
          }
          .status-badge.needs_optimization {
            color: #f7c97c;
            background: rgba(248, 81, 73, 0.14);
            border-color: rgba(248, 81, 73, 0.28);
          }
          .status-badge.insufficient_data {
            color: var(--accent);
            background: rgba(88, 166, 255, 0.12);
            border-color: rgba(88, 166, 255, 0.28);
          }
          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
            margin-top: 18px;
          }
          .metric-card {
            padding: 14px;
            border-radius: 14px;
            background: rgba(24, 34, 48, 0.72);
            border: 1px solid rgba(88, 166, 255, 0.12);
          }
          .metric-card.warn { border-color: rgba(210, 153, 34, 0.3); }
          .metric-card.good { border-color: rgba(63, 185, 80, 0.3); }
          .metric-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--muted);
          }
          .metric-value {
            margin-top: 8px;
            font-size: 24px;
            font-weight: 700;
          }
          .two-col {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 18px;
          }
          .panel { padding: 18px 20px; }
          .panel h2 {
            margin: 0 0 12px;
            font-size: 18px;
          }
          .bullets {
            margin: 0;
            padding-left: 20px;
            line-height: 1.7;
          }
          .recommendations {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            gap: 12px;
          }
          .recommendation-item {
            padding: 14px;
            border-radius: 14px;
            background: rgba(24, 34, 48, 0.72);
            border: 1px solid rgba(88, 166, 255, 0.14);
            line-height: 1.6;
          }
          .recommendation-item span {
            display: block;
            color: var(--muted);
            margin-top: 4px;
          }
          .recommendation-item.quiet,
          .empty-state,
          .empty-cell,
          .subtle,
          .issue-pill.quiet { color: var(--muted); }
          .settings-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 12px;
          }
          .settings-item,
          .trend-callout {
            padding: 12px 14px;
            border-radius: 12px;
            background: rgba(24, 34, 48, 0.72);
            border: 1px solid rgba(88, 166, 255, 0.12);
          }
          .settings-item strong,
          .trend-callout strong {
            display: block;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--muted);
            margin-bottom: 8px;
          }
          .issue-pill-row {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 14px;
          }
          .issue-pill {
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(24, 34, 48, 0.8);
            border: 1px solid rgba(88, 166, 255, 0.14);
            font-size: 12px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
          }
          th,
          td {
            padding: 10px 8px;
            border-bottom: 1px solid rgba(139, 160, 182, 0.12);
            text-align: left;
            vertical-align: top;
          }
          th {
            color: var(--muted);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          tr:last-child td { border-bottom: none; }
          pre {
            margin: 0;
            white-space: pre-wrap;
            font-family: "Cascadia Code", Consolas, monospace;
          }
          .good { color: var(--green); }
          .bad { color: var(--red); }
          @media (max-width: 760px) {
            body { padding: 14px; }
            .hero,
            .panel { padding: 16px; }
            h1 { font-size: 22px; }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <section class="hero">
            <div class="hero-top">
              <div class="hero-copy">
                <h1>Code Janitor Performance Review</h1>
                <p>${this._escapeHtml(analysis.message || "Performance summary unavailable.")}</p>
              </div>
              <div class="status-badge ${analysis.status}">${this._escapeHtml(String(analysis.status || "unknown").replace(/_/g, " "))}</div>
            </div>
            <div class="metrics-grid">
              ${metricCard("Health score", String(analysis.healthScore || 0), (analysis.healthScore || 0) >= 85 ? "good" : (analysis.healthScore || 0) >= 65 ? "warn" : "")}
              ${metricCard("Average latency", this._formatDuration(avgDuration), avgDuration > (settings.slowThreshold || 0) ? "warn" : "")}
              ${metricCard("Median latency", this._formatDuration(medianDuration))}
              ${metricCard("p95 latency", this._formatDuration(p95Duration), p95Duration > (settings.slowThreshold || 0) ? "warn" : "")}
              ${metricCard("Success rate", this._formatPercent(successRate), successRate >= 0.8 ? "good" : "warn")}
              ${metricCard("Slow responses", `${slowResponses} / ${analysis.recentWindowSize || 0}`)}
              ${metricCard("Failure rate", this._formatPercent(failureRate), failureRate > 0.3 ? "warn" : "")}
              ${metricCard("Slow streak", String(analysis.consecutiveSlowResponses || 0), (analysis.consecutiveSlowResponses || 0) >= 2 ? "warn" : "")}
            </div>
          </section>

          <section class="two-col">
            <div class="panel">
              <h2>What needs attention</h2>
              ${issueListMarkup}
            </div>
            <div class="panel">
              <h2>Recommended next moves</h2>
              <ul class="recommendations">${recommendationItems}</ul>
            </div>
          </section>

          <section class="two-col">
            <div class="panel">
              <h2>Current operating profile</h2>
              <div class="settings-grid">
                <div class="settings-item"><strong>Provider</strong>${this._escapeHtml(settings.provider || "unknown")}</div>
                <div class="settings-item"><strong>Model</strong>${this._escapeHtml(settings.model || "default")}</div>
                <div class="settings-item"><strong>Timeout</strong>${this._formatDuration(settings.timeout || 0)}</div>
                <div class="settings-item"><strong>Auto-heal</strong>${settings.autoHealEnabled ? "Enabled" : "Disabled"}</div>
                <div class="settings-item"><strong>Slow threshold</strong>${this._formatDuration(settings.slowThreshold || 0)}</div>
                <div class="settings-item"><strong>GStack gate</strong>${this._escapeHtml(settings.gstackGateMode || "smart")}</div>
              </div>
            </div>
            <div class="panel">
              <h2>Trend signal</h2>
              <div class="trend-callout">
                <strong>${this._escapeHtml(trend.direction || "flat")}</strong>
                <div>${this._escapeHtml(trend.summary || "No trend summary available.")}</div>
              </div>
              <div class="subtle" style="margin-top: 12px;">
                Recent average: ${this._formatDuration(trend.recentAverage || 0)}<br />
                Previous average: ${this._formatDuration(trend.previousAverage || 0)}
              </div>
              <div class="subtle" style="margin-top: 12px;">
                ${analysis.lastResponse
                  ? `Latest run used ${this._escapeHtml(analysis.lastResponse.provider || "unknown")} / ${this._escapeHtml(analysis.lastResponse.model || "unknown")} and finished in ${this._formatDuration(analysis.lastResponse.duration || 0)}.`
                  : "No latest response details available."}
              </div>
              <div class="subtle" style="margin-top: 8px;">
                ${analysis.slowestResponse
                  ? `Slowest recent run was ${this._formatDuration(analysis.slowestResponse.duration || 0)} on ${this._escapeHtml(analysis.slowestResponse.provider || "unknown")} / ${this._escapeHtml(analysis.slowestResponse.model || "unknown")}.`
                  : "No slowest-response highlight available yet."}
              </div>
            </div>
          </section>

          <section class="panel">
            <h2>Issue mix</h2>
            <div class="issue-pill-row">${issuePills}</div>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>${issueRows}</tbody>
            </table>
          </section>

          <section class="panel">
            <h2>Provider and model breakdown</h2>
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Runs</th>
                  <th>Average</th>
                  <th>p95</th>
                  <th>Failure rate</th>
                </tr>
              </thead>
              <tbody>${providerRows}</tbody>
            </table>
          </section>

          <section class="panel">
            <h2>Recent response timeline</h2>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Latency</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>${timelineRows}</tbody>
            </table>
          </section>

          <section class="panel">
            <h2>Auto-heal history</h2>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Applied changes</th>
                </tr>
              </thead>
              <tbody>${autoHealRows}</tbody>
            </table>
          </section>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Save metrics to disk
   */
  async _saveMetrics() {
    try {
      const metricsPath = this._getMetricsPath();
      await fs.mkdir(path.dirname(metricsPath), { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify({
        history: this.responseHistory,
        issueLog: this.issueLog,
        autoHeal: {
          lastAutoHealAt: this.lastAutoHealAt,
          lastAutoHealSummary: this.lastAutoHealSummary,
          lastAutoHealChanges: this.lastAutoHealChanges
        },
        lastUpdated: Date.now()
      }, null, 2));
    } catch (error) {
      console.error("[Self-Heal] Failed to save metrics:", error);
    }
  }

  /**
   * Load metrics from disk
   */
  async loadMetrics() {
    try {
      const metricsPath = this._getMetricsPath();
      const data = await fs.readFile(metricsPath, "utf8");
      const metrics = JSON.parse(data);
      this.responseHistory = metrics.history || [];
      this.issueLog = metrics.issueLog || [];
      this.lastAutoHealAt = Number(metrics.autoHeal?.lastAutoHealAt || 0);
      this.lastAutoHealSummary = String(metrics.autoHeal?.lastAutoHealSummary || "");
      this.lastAutoHealChanges = Array.isArray(metrics.autoHeal?.lastAutoHealChanges)
        ? metrics.autoHeal.lastAutoHealChanges
        : [];
    } catch (error) {
      this.responseHistory = [];
      this.issueLog = [];
      this.lastAutoHealAt = 0;
      this.lastAutoHealSummary = "";
      this.lastAutoHealChanges = [];
    }
    this._notifyStateChange();
  }

  /**
   * Log auto-heal event
   */
  async _logAutoHeal(changes, meta = {}) {
    try {
      const logPath = this._getAutoHealLogPath();
      let log = [];
      
      try {
        const existing = await fs.readFile(logPath, "utf8");
        log = JSON.parse(existing);
      } catch {
        // Log file doesn't exist yet
      }

      log.push({
        timestamp: new Date().toISOString(),
        changes,
        summary: meta.summary || ""
      });

      if (log.length > 50) {
        log = log.slice(-50);
      }

      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.writeFile(logPath, JSON.stringify(log, null, 2));
    } catch (error) {
      console.error("[Self-Heal] Failed to log auto-heal:", error);
    }
  }

  /**
   * Get auto-heal history
   */
  async getAutoHealHistory() {
    try {
      const logPath = this._getAutoHealLogPath();
      const data = await fs.readFile(logPath, "utf8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }
}

module.exports = PerformanceMonitor;
