/**
 * Integration layer for Performance Optimizer
 * Provides drop-in replacements for existing methods with optimizations
 */

const { PerformanceOptimizer } = require("./performance-optimizer");
const { FeedbackLoopOptimizer } = require("./feedback-loop-optimizer");

/**
 * Create optimized version of agent methods
 */
function createOptimizedAgent(agent) {
  const optimizer = new PerformanceOptimizer();
  const feedbackOptimizer = new FeedbackLoopOptimizer();
  const normalizeWorkspaceRelativePath =
    typeof agent._normalizeWorkspaceRelativePath === "function"
      ? agent._normalizeWorkspaceRelativePath.bind(agent)
      : (input) => String(input || "").trim().replace(/\\/g, "/");
  
  // Store original methods
  const original = {
    parseResponse:
      typeof agent._parseResponse === "function"
        ? agent._parseResponse.bind(agent)
        : null,
    normalizeWorkspaceRelativePath
  };

  // Older optimizer builds expected a private _parseStructuredActions hook that
  // no longer exists on AIAgent. If the current agent shape does not expose the
  // hooks we need, skip installing the parser override instead of crashing
  // extension activation before commands are registered.
  if (!original.parseResponse) {
    agent.performanceOptimizer = optimizer;
    agent.feedbackLoopOptimizer = feedbackOptimizer;
    return agent;
  }

  // Override with optimized versions
  agent._parseStructuredActionsOptimized = function(response) {
    // Use compiled regex patterns from optimizer
    const patterns = optimizer.getCompiledPatterns();
    
    const actions = [];
    const warnings = [];
    const consumedRanges = [];

    const markConsumedRange = (start, text) => {
      consumedRanges.push({ start, end: start + text.length });
    };

    const isWithinConsumedRange = (index) => {
      return consumedRanges.some(range => index >= range.start && index < range.end);
    };

    const normalizeActionPath = (rawPath) => {
      const trimmed = (rawPath || "").trim();
      return {
        path: optimizer.pathCache.normalize(
          trimmed,
          agent.workspaceFolder,
          original.normalizeWorkspaceRelativePath
        )
      };
    };

    // Use cached patterns for parsing
    let match;
    
    // PATCH actions
    patterns.patch.lastIndex = 0;
    while ((match = patterns.patch.exec(response)) !== null) {
      if (isWithinConsumedRange(match.index)) continue;
      const pathInfo = normalizeActionPath(match[1]);
      const normalizedPath = pathInfo.path;
      const searchContent = match[2] || "";
      const replaceContent = match[3] || "";

      if (!normalizedPath || normalizedPath.includes("\n")) continue;

      if (
        agent.currentEditableTargets &&
        !agent.currentEditableTargets.has(normalizedPath)
      ) {
        warnings.push(`Blocked edit outside allowed targets: ${normalizedPath}`);
        continue;
      }

      actions.push({
        type: "patch",
        path: normalizedPath,
        search: searchContent,
        replace: replaceContent
      });
      markConsumedRange(match.index, match[0]);
    }

    // FILE actions
    patterns.file.lastIndex = 0;
    while ((match = patterns.file.exec(response)) !== null) {
      if (isWithinConsumedRange(match.index)) continue;
      const pathInfo = normalizeActionPath(match[1]);
      const normalizedPath = pathInfo.path;
      const content = match[2] || "";

      if (!normalizedPath || normalizedPath.includes("\n")) continue;

      if (
        agent.currentEditableTargets &&
        !agent.currentEditableTargets.has(normalizedPath)
      ) {
        warnings.push(`Blocked edit outside allowed targets: ${normalizedPath}`);
        continue;
      }

      actions.push({
        type: "file",
        path: normalizedPath,
        language: "text",
        content
      });
      markConsumedRange(match.index, match[0]);
    }

    // MKDIR actions
    patterns.mkdir.lastIndex = 0;
    while ((match = patterns.mkdir.exec(response)) !== null) {
      if (isWithinConsumedRange(match.index)) continue;
      const pathInfo = normalizeActionPath(match[1]);
      const normalizedPath = pathInfo.path;

      if (!normalizedPath || normalizedPath.includes("\n")) continue;

      actions.push({
        type: "mkdir",
        path: normalizedPath
      });
      markConsumedRange(match.index, match[0]);
    }

    // CMD actions
    patterns.cmd.lastIndex = 0;
    while ((match = patterns.cmd.exec(response)) !== null) {
      if (isWithinConsumedRange(match.index)) continue;
      const command = (match[1] || "").trim();

      if (!command || command.includes("\n")) continue;

      actions.push({
        type: "cmd",
        command
      });
      markConsumedRange(match.index, match[0]);
    }

    return { actions, warnings };
  };

  agent._parseResponse = function(response) {
    const parsed = original.parseResponse(response);
    const text = String(response || "");
    const simpleActionTypes = new Set(["patch", "file", "mkdir", "cmd"]);
    const hasAdvancedStructuredTokens =
      /\b(?:APPLY_DIFF|INSERT_CONTENT|READ_FILES|UPDATE_TODO_LIST|ASK_FOLLOWUP_QUESTION|ATTEMPT_COMPLETION|SUBMIT_REVIEW_FINDINGS|ANALYZE_FILE_QUALITY|GITHUB_CONTEXT|READ|GREP|LOCATE_CODE|GRAPHIFY|LINT|VALIDATE|PREVIEW|PERFORMANCE|FETCH)\s*:/i.test(
        text
      );
    const parsedActions = Array.isArray(parsed?.actions) ? parsed.actions : [];
    const parsedIsSimpleOnly =
      parsedActions.length > 0 &&
      parsedActions.every((action) => simpleActionTypes.has(action?.type));

    if (!parsedIsSimpleOnly || hasAdvancedStructuredTokens) {
      return parsed;
    }

    const optimized = agent._parseStructuredActionsOptimized(text);
    if (!Array.isArray(optimized?.actions) || optimized.actions.length === 0) {
      return parsed;
    }

    return {
      ...parsed,
      actions: optimized.actions,
      warnings: Array.from(
        new Set([...(parsed.warnings || []), ...(optimized.warnings || [])])
      )
    };
  };

  // Add optimizer instances to agent
  agent.performanceOptimizer = optimizer;
  agent.feedbackLoopOptimizer = feedbackOptimizer;

  return agent;
}

/**
 * Create optimized version of chat panel methods
 */
function createOptimizedChatPanel(chatPanel) {
  const optimizer = new PerformanceOptimizer();
  const feedbackOptimizer = new FeedbackLoopOptimizer();

  // Optimized patch matching with smart recovery
  chatPanel._buildPatchedContentOptimized = async function(currentContent, searchContent, replaceContent) {
    if (!String(searchContent || "").length) {
      return {
        matched: false,
        reason: "empty_search"
      };
    }

    const result = await optimizer.patchMatcher.tryMatch(
      currentContent,
      searchContent,
      replaceContent
    );

    if (result.matched) {
      return {
        matched: true,
        content: result.content,
        strategy: result.strategy
      };
    }

    return {
      matched: false,
      reason:
        result.reason === "ambiguous"
          ? "ambiguous_search"
          : result.reason === "no_match"
            ? "search_not_found"
            : result.reason || "search_not_found",
      matchCount: result.matchCount
    };
  };

  // Fast-path execution for simple edits
  chatPanel._executeFastPath = async function(action, workspaceFolder, writeOptions) {
    const filePath = require("path").join(workspaceFolder, action.path);
    
    // Read file with caching
    const currentContent = await optimizer.fileCache.get(
      filePath,
      async (path) => {
        const fs = require("fs").promises;
        return await fs.readFile(path, "utf8");
      }
    );

    // Try smart patch matching
    const result = await chatPanel._buildPatchedContentOptimized(
      currentContent,
      action.search,
      action.replace
    );

    if (result.matched) {
      // Apply changes
      const applyResult = await chatPanel.agent.applyChanges(
        action.path,
        result.content,
        false,
        writeOptions
      );

      if (applyResult.success) {
        optimizer.fileCache.invalidate(filePath);
      }

      return {
        ...applyResult,
        strategy: result.strategy,
        fastPath: true
      };
    }

    return {
      success: false,
      reason: result.reason,
      fastPath: false
    };
  };

  // Optimized gate decision
  chatPanel._shouldSkipGate = function(actions, context = {}) {
    const gateDecision = optimizer.editGate.shouldRunGate(actions, context);
    return gateDecision;
  };

  // Parallel action execution
  chatPanel._executeActionsParallel = async function(actions, workspaceFolder, writeOptions) {
    const results = await optimizer.parallelExecutor.executeParallel(
      actions,
      async (action) => {
        // Execute individual action
        if (action.type === "patch") {
          // Check for fast-path eligibility
          const fastPathCheck = optimizer.fastPathDetector.isFastPathEligible([action]);
          
          if (fastPathCheck.eligible) {
            return await chatPanel._executeFastPath(action, workspaceFolder, writeOptions);
          }
        }

        // Fall back to original execution
        return await chatPanel._executeActionOriginal(action, workspaceFolder, writeOptions);
      }
    );

    return results;
  };

  // Streaming progress handler
  chatPanel._createStreamingHandler = function(onProgress) {
    let completed = 0;
    let total = 0;

    return {
      start: (actionCount) => {
        total = actionCount;
        completed = 0;
        if (onProgress) {
          onProgress({
            type: "start",
            total
          });
        }
      },
      progress: (action, result) => {
        completed++;
        if (onProgress) {
          onProgress({
            type: "progress",
            completed,
            total,
            action,
            result,
            percentage: Math.round((completed / total) * 100)
          });
        }
      },
      complete: (results) => {
        if (onProgress) {
          onProgress({
            type: "complete",
            results,
            total: completed
          });
        }
      }
    };
  };

  // Optimized inspection loop
  chatPanel._shouldRunInspectionRound = function(actions, round, context = {}) {
    if (!feedbackOptimizer) return { shouldInspect: true };
    
    const decision = feedbackOptimizer.inspectionOptimizer.shouldInspect(actions, {
      round,
      intent: context.intent
    });
    
    return decision;
  };

  // Optimized retry decision
  chatPanel._shouldRetryResponse = function(response, context = {}) {
    if (!feedbackOptimizer) return { shouldRetry: false };
    
    const decision = feedbackOptimizer.retryStrategy.shouldRetry(response, context);
    return decision;
  };

  // Optimized recovery strategy
  chatPanel._selectRecoveryStrategy = function(patchAction, currentContent, failureReason) {
    if (!feedbackOptimizer) return { strategy: "broader_context" };
    
    return feedbackOptimizer.recoveryOptimizer.selectRecoveryStrategy(
      patchAction,
      currentContent,
      failureReason
    );
  };

  // Add optimizer instances to chat panel
  chatPanel.performanceOptimizer = optimizer;
  chatPanel.feedbackLoopOptimizer = feedbackOptimizer;

  return chatPanel;
}

/**
 * Get performance statistics including feedback loop stats
 */
function getPerformanceStats(agentOrPanel) {
  const stats = {};
  
  if (agentOrPanel.performanceOptimizer) {
    stats.performance = agentOrPanel.performanceOptimizer.getAllStats();
  }
  
  if (agentOrPanel.feedbackLoopOptimizer) {
    stats.feedbackLoop = agentOrPanel.feedbackLoopOptimizer.getAllStats();
  }
  
  return Object.keys(stats).length > 0 ? stats : null;
}

/**
 * Clear all caches including feedback loop caches
 */
function clearOptimizationCaches(agentOrPanel) {
  if (agentOrPanel.performanceOptimizer) {
    agentOrPanel.performanceOptimizer.clearCaches();
  }
  
  if (agentOrPanel.feedbackLoopOptimizer) {
    agentOrPanel.feedbackLoopOptimizer.reset();
  }
}

module.exports = {
  createOptimizedAgent,
  createOptimizedChatPanel,
  getPerformanceStats,
  clearOptimizationCaches,
  PerformanceOptimizer,
  FeedbackLoopOptimizer
};

// Made with Bob
