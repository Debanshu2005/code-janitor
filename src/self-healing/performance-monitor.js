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
    this.maxHistorySize = 20;
    this.maxIssueLogSize = 50;
    this.slowResponseThreshold = 30000; // Default 30 seconds, can be overridden by settings
    this.autoHealEnabled = true; // Can be overridden by settings
    this.pendingAutoHeal = null; // Store pending auto-heal to avoid interrupting responses
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
    if (!settings.enabled) {
      return; // Self-healing disabled in settings
    }

    // Use threshold from settings
    if (duration > settings.slowThreshold) {
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
    if (this.responseHistory.length < 5) {
      return {
        status: "insufficient_data",
        message: "Not enough data to analyze performance",
        issues: [],
        recommendations: [],
        issueLog: this.issueLog.slice(-20) // Include recent issues
      };
    }

    const settings = this._getSettings();
    const threshold = settings.slowThreshold;
    const recentResponses = this.responseHistory.slice(-10);
    const avgDuration = recentResponses.reduce((sum, r) => sum + r.duration, 0) / recentResponses.length;
    const slowResponses = recentResponses.filter(r => r.duration > threshold);
    const failureRate = recentResponses.filter(r => !r.success).length / recentResponses.length;

    const issues = [];
    const recommendations = [];

    // Detect slow model
    if (avgDuration > threshold) {
      issues.push(`Average response time: ${(avgDuration / 1000).toFixed(1)}s (threshold: ${threshold / 1000}s)`);
      
      const slowModel = this._getMostCommonSlowModel(recentResponses, threshold);
      if (slowModel) {
        recommendations.push({
          type: "switch_model",
          from: slowModel,
          to: this._getFasterAlternative(slowModel),
          reason: "Current model is consistently slow"
        });
      }
    }

    // Detect high failure rate
    if (failureRate > 0.3) {
      issues.push(`High failure rate: ${(failureRate * 100).toFixed(0)}%`);
      recommendations.push({
        type: "increase_timeout",
        reason: "Many requests are timing out"
      });
    }

    // Analyze issue log
    const recentIssues = this.issueLog.slice(-20);
    const blockedCommands = recentIssues.filter(i => i.type === "blocked_command");
    const validationErrors = recentIssues.filter(i => i.type === "validation_error");
    const fileErrors = recentIssues.filter(i => i.type === "file_error");
    
    if (blockedCommands.length > 0) {
      issues.push(`${blockedCommands.length} command(s) blocked in recent operations`);
    }
    if (validationErrors.length > 0) {
      issues.push(`${validationErrors.length} validation error(s) detected`);
    }
    if (fileErrors.length > 0) {
      issues.push(`${fileErrors.length} file operation error(s) detected`);
    }

    return {
      status: issues.length > 0 ? "needs_optimization" : "healthy",
      avgDuration,
      slowResponses: slowResponses.length,
      failureRate,
      issues,
      recommendations,
      issueLog: recentIssues // Include recent issues in report
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

    const analysis = this.analyzePerformance();
    if (analysis.status !== "needs_optimization") {
      return;
    }

    this.pendingAutoHeal = true;

    // Show notification with auto-heal option
    const action = await vscode.window.showWarningMessage(
      `⚠️ Code Janitor detected slow AI responses (${(duration / 1000).toFixed(1)}s). Auto-optimize settings?`,
      "Auto-Fix Now",
      "Show Details",
      "Dismiss",
      "Disable Auto-Heal"
    );

    this.pendingAutoHeal = null;

    if (action === "Auto-Fix Now") {
      await this._applyOptimizations(analysis.recommendations);
    } else if (action === "Show Details") {
      this._showPerformanceReport(analysis);
    } else if (action === "Disable Auto-Heal") {
      // Disable in settings permanently
      const cfg = vscode.workspace.getConfiguration("codeJanitor.ai.selfHealing");
      await cfg.update("enabled", false, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage("✅ Self-healing disabled. You can re-enable it in settings (codeJanitor.ai.selfHealing.enabled).");
    }
    // If "Dismiss" is clicked, do nothing - user wants to keep using the slow model
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
        }
      } catch (error) {
        console.error("[Self-Heal] Failed to apply optimization:", error);
      }
    }

    if (applied.length > 0) {
      vscode.window.showInformationMessage(
        `✅ Auto-optimized Code Janitor:\n${applied.join("\n")}`,
        "View Settings"
      ).then(action => {
        if (action === "View Settings") {
          vscode.commands.executeCommand("workbench.action.openSettings", "codeJanitor.ai");
        }
      });

      // Log the auto-heal event
      this._logAutoHeal(applied);
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

  /**
   * Save metrics to disk
   */
  async _saveMetrics() {
    try {
      const metricsPath = path.join(this.context.globalStorageUri.fsPath, "performance-metrics.json");
      await fs.mkdir(path.dirname(metricsPath), { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify({
        history: this.responseHistory,
        issueLog: this.issueLog,
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
      const metricsPath = path.join(this.context.globalStorageUri.fsPath, "performance-metrics.json");
      const data = await fs.readFile(metricsPath, "utf8");
      const metrics = JSON.parse(data);
      this.responseHistory = metrics.history || [];
      this.issueLog = metrics.issueLog || [];
    } catch (error) {
      this.responseHistory = [];
      this.issueLog = [];
    }
  }

  /**
   * Log auto-heal event
   */
  async _logAutoHeal(changes) {
    try {
      const logPath = path.join(this.context.globalStorageUri.fsPath, "auto-heal-log.json");
      let log = [];
      
      try {
        const existing = await fs.readFile(logPath, "utf8");
        log = JSON.parse(existing);
      } catch {
        // Log file doesn't exist yet
      }

      log.push({
        timestamp: new Date().toISOString(),
        changes
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
      const logPath = path.join(this.context.globalStorageUri.fsPath, "auto-heal-log.json");
      const data = await fs.readFile(logPath, "utf8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }
}

module.exports = PerformanceMonitor;
