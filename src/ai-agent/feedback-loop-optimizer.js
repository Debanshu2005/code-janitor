/**
 * Feedback Loop Optimizer
 * Optimizes the AI agent's retry, recovery, and inspection loops
 */

/**
 * Smart Retry Strategy Manager
 * Reduces unnecessary retries and improves success rates
 */
class SmartRetryStrategy {
  constructor() {
    this.retryHistory = new Map(); // Track retry patterns
    this.successPatterns = new Map(); // Learn from successful retries
    this.maxRetries = 3;
    this.retryCount = 0;
    this.failureCount = 0;
  }

  /**
   * Determine if retry is necessary and what strategy to use
   */
  shouldRetry(response, context = {}) {
    const { actions, warnings, text } = response;
    const { intent, attempt = 0 } = context;

    // Don't retry if max attempts reached
    if (attempt >= this.maxRetries) {
      return { shouldRetry: false, reason: 'max_attempts' };
    }

    // Check if response has incomplete structured edits
    const hasIncompleteWarning = warnings?.some(w => 
      /incomplete|retrying may recover/i.test(w)
    );

    // Check if response is prose when actions expected
    const isProse = intent === 'edit' && 
      (!actions || actions.length === 0) &&
      text && text.length > 100;

    // Check if actions are malformed
    const hasMalformedActions = actions?.some(a => 
      !a.type || 
      (a.type === 'patch' && (!a.search || !a.replace)) ||
      (a.type === 'file' && !a.content)
    );

    // Determine retry strategy
    if (hasIncompleteWarning) {
      this.retryCount++;
      return {
        shouldRetry: true,
        reason: 'incomplete_edits',
        strategy: 'structured_format',
        confidence: 0.7
      };
    }

    if (isProse) {
      this.retryCount++;
      return {
        shouldRetry: true,
        reason: 'prose_response',
        strategy: 'strict_format',
        confidence: 0.8
      };
    }

    if (hasMalformedActions) {
      this.retryCount++;
      return {
        shouldRetry: true,
        reason: 'malformed_actions',
        strategy: 'file_only',
        confidence: 0.6
      };
    }

    return { shouldRetry: false, reason: 'success' };
  }

  /**
   * Build optimized retry prompt based on strategy
   */
  buildRetryPrompt(originalPrompt, response, strategy) {
    const basePrompt = originalPrompt;

    switch (strategy) {
      case 'structured_format':
        return `${basePrompt}\n\n${this._buildStructuredFormatPrompt(response)}`;
      
      case 'strict_format':
        return `${basePrompt}\n\n${this._buildStrictFormatPrompt()}`;
      
      case 'file_only':
        return `${basePrompt}\n\n${this._buildFileOnlyPrompt(response)}`;
      
      default:
        return basePrompt;
    }
  }

  _buildStructuredFormatPrompt(response) {
    return `The previous response had incomplete structured edits. Please provide complete, executable actions:

REQUIRED FORMAT:
- Use PATCH: for targeted edits with complete SEARCH/REPLACE blocks
- Use FILE: for new files or complete rewrites
- Ensure all code blocks are properly closed with \`\`\`
- Include the full content, no placeholders or truncation

Previous attempt had: ${response.actions?.length || 0} actions
Please provide complete, executable actions now.`;
  }

  _buildStrictFormatPrompt() {
    return `Please respond with ONLY structured actions, no prose explanation:

PATCH: path/to/file.ext
SEARCH:
\`\`\`language
exact content to find
\`\`\`
REPLACE:
\`\`\`language
replacement content
\`\`\`

Or:

FILE: path/to/file.ext
\`\`\`language
complete file content
\`\`\`

Start your response with the first action immediately.`;
  }

  _buildFileOnlyPrompt(response) {
    return `The previous response had issues with PATCH actions. Please use FILE: actions instead:

FILE: path/to/file.ext
\`\`\`language
complete file content here
\`\`\`

Provide the COMPLETE file content, preserving all unrelated code.
No placeholders, no truncation, no "rest of code unchanged" comments.`;
  }

  /**
   * Record retry outcome for learning
   */
  recordOutcome(strategy, success, context = {}) {
    const key = `${strategy}:${context.intent || 'unknown'}`;
    
    if (!this.retryHistory.has(key)) {
      this.retryHistory.set(key, { attempts: 0, successes: 0 });
    }

    const stats = this.retryHistory.get(key);
    stats.attempts++;
    if (success) {
      stats.successes++;
      this.successPatterns.set(key, {
        strategy,
        context,
        timestamp: Date.now()
      });
    } else {
      this.failureCount++;
    }
  }

  /**
   * Get retry statistics
   */
  getStats() {
    const totalAttempts = Array.from(this.retryHistory.values())
      .reduce((sum, stats) => sum + stats.attempts, 0);
    const totalSuccesses = Array.from(this.retryHistory.values())
      .reduce((sum, stats) => sum + stats.successes, 0);

    return {
      totalRetries: this.retryCount,
      totalFailures: this.failureCount,
      successRate: totalAttempts > 0 
        ? ((totalSuccesses / totalAttempts) * 100).toFixed(2) + '%'
        : '0%',
      strategies: Object.fromEntries(this.retryHistory)
    };
  }

  reset() {
    this.retryCount = 0;
    this.failureCount = 0;
  }
}

/**
 * Inspection Loop Optimizer
 * Reduces unnecessary inspection rounds
 */
class InspectionLoopOptimizer {
  constructor() {
    this.maxRounds = 2; // Configurable
    this.inspectionCache = new Map();
    this.inspectionCount = 0;
  }

  /**
   * Determine if inspection is needed
   */
  shouldInspect(actions, context = {}) {
    const { round = 0, intent } = context;

    // Don't inspect if max rounds reached
    if (round >= this.maxRounds) {
      return { shouldInspect: false, reason: 'max_rounds' };
    }

    // Check if actions are inspection-only
    const isInspectionOnly = this._isInspectionOnly(actions);

    if (!isInspectionOnly) {
      return { shouldInspect: false, reason: 'has_edits' };
    }

    // Check if we have cached results for similar inspection
    const cacheKey = this._buildCacheKey(actions);
    if (this.inspectionCache.has(cacheKey)) {
      const cached = this.inspectionCache.get(cacheKey);
      const age = Date.now() - cached.timestamp;
      
      // Use cache if less than 30 seconds old
      if (age < 30000) {
        return {
          shouldInspect: false,
          reason: 'cached',
          cachedResult: cached.result
        };
      }
    }

    this.inspectionCount++;
    return {
      shouldInspect: true,
      reason: 'needs_context',
      round: round + 1
    };
  }

  _isInspectionOnly(actions) {
    if (!actions || actions.length === 0) return false;

    const inspectionTypes = new Set(['read', 'grep', 'cmd', 'preview_inspect']);
    return actions.every(a => inspectionTypes.has(a.type));
  }

  _buildCacheKey(actions) {
    return actions
      .map(a => `${a.type}:${a.path || a.command || ''}`)
      .sort()
      .join('|');
  }

  /**
   * Cache inspection result
   */
  cacheResult(actions, result) {
    const key = this._buildCacheKey(actions);
    this.inspectionCache.set(key, {
      result,
      timestamp: Date.now()
    });

    // Limit cache size
    if (this.inspectionCache.size > 50) {
      const firstKey = this.inspectionCache.keys().next().value;
      this.inspectionCache.delete(firstKey);
    }
  }

  /**
   * Get inspection statistics
   */
  getStats() {
    return {
      totalInspections: this.inspectionCount,
      cacheSize: this.inspectionCache.size,
      cacheHits: Array.from(this.inspectionCache.values())
        .filter(v => Date.now() - v.timestamp < 30000).length
    };
  }

  clearCache() {
    this.inspectionCache.clear();
  }
}

/**
 * Recovery Loop Optimizer
 * Improves patch recovery success rate
 */
class RecoveryLoopOptimizer {
  constructor() {
    this.recoveryAttempts = 0;
    this.recoverySuccesses = 0;
    this.recoveryStrategies = new Map();
  }

  /**
   * Determine optimal recovery strategy
   */
  selectRecoveryStrategy(patchAction, currentContent, failureReason) {
    // Strategy 1: Broader context (if search block is small)
    const searchLines = (patchAction.search || '').split('\n').length;
    if (searchLines < 5 && failureReason !== 'ambiguous') {
      return {
        strategy: 'broader_context',
        priority: 1,
        description: 'Expand search block to include more surrounding lines'
      };
    }

    // Strategy 2: Fuzzy matching (if exact match failed)
    if (failureReason === 'no_match') {
      return {
        strategy: 'fuzzy_match',
        priority: 2,
        description: 'Try fuzzy matching with whitespace normalization'
      };
    }

    // Strategy 3: File rewrite (if ambiguous or large change)
    if (failureReason === 'ambiguous' || searchLines > 50) {
      return {
        strategy: 'file_rewrite',
        priority: 3,
        description: 'Fall back to complete file rewrite'
      };
    }

    // Default: broader context
    return {
      strategy: 'broader_context',
      priority: 1,
      description: 'Default recovery with broader context'
    };
  }

  /**
   * Build recovery prompt based on strategy
   */
  buildRecoveryPrompt(strategy, patchAction, currentContent, originalRequest) {
    switch (strategy.strategy) {
      case 'broader_context':
        return this._buildBroaderContextPrompt(patchAction, currentContent, originalRequest);
      
      case 'fuzzy_match':
        return this._buildFuzzyMatchPrompt(patchAction, currentContent, originalRequest);
      
      case 'file_rewrite':
        return this._buildFileRewritePrompt(patchAction, currentContent, originalRequest);
      
      default:
        return this._buildBroaderContextPrompt(patchAction, currentContent, originalRequest);
    }
  }

  _buildBroaderContextPrompt(action, content, request) {
    return `The PATCH action for ${action.path} did not match. The file currently contains:

\`\`\`
${content.slice(0, 2000)}
${content.length > 2000 ? '\n... (file continues)' : ''}
\`\`\`

Original request: ${request}

Please provide a new PATCH action with a LARGER, MORE UNIQUE search block (3-12 surrounding lines) that will match exactly once in the file above.

PATCH: ${action.path}
SEARCH:
\`\`\`
[Include 3-12 lines of surrounding context to make this unique]
\`\`\`
REPLACE:
\`\`\`
[Your replacement with the same surrounding context]
\`\`\``;
  }

  _buildFuzzyMatchPrompt(action, content, request) {
    return `The PATCH action for ${action.path} did not find an exact match. Try a FILE: action instead with the complete file content:

Current file:
\`\`\`
${content}
\`\`\`

Original request: ${request}

FILE: ${action.path}
\`\`\`
[Complete file content with your changes applied]
\`\`\`

IMPORTANT: Include the ENTIRE file, not just the changed section.`;
  }

  _buildFileRewritePrompt(action, content, request) {
    return `Recovery required for ${action.path}. Provide a complete FILE: action:

FILE: ${action.path}
\`\`\`
[Complete file content here - preserve all unrelated code]
\`\`\`

Original request: ${request}

The file currently has ${content.split('\n').length} lines. Your FILE: action must include ALL of them with your changes applied.`;
  }

  /**
   * Record recovery outcome
   */
  recordRecovery(strategy, success) {
    this.recoveryAttempts++;
    if (success) {
      this.recoverySuccesses++;
    }

    const key = strategy.strategy;
    if (!this.recoveryStrategies.has(key)) {
      this.recoveryStrategies.set(key, { attempts: 0, successes: 0 });
    }

    const stats = this.recoveryStrategies.get(key);
    stats.attempts++;
    if (success) {
      stats.successes++;
    }
  }

  /**
   * Get recovery statistics
   */
  getStats() {
    return {
      totalAttempts: this.recoveryAttempts,
      totalSuccesses: this.recoverySuccesses,
      successRate: this.recoveryAttempts > 0
        ? ((this.recoverySuccesses / this.recoveryAttempts) * 100).toFixed(2) + '%'
        : '0%',
      strategies: Object.fromEntries(this.recoveryStrategies)
    };
  }
}

/**
 * Main Feedback Loop Optimizer
 */
class FeedbackLoopOptimizer {
  constructor() {
    this.retryStrategy = new SmartRetryStrategy();
    this.inspectionOptimizer = new InspectionLoopOptimizer();
    this.recoveryOptimizer = new RecoveryLoopOptimizer();
  }

  /**
   * Get all statistics
   */
  getAllStats() {
    return {
      retry: this.retryStrategy.getStats(),
      inspection: this.inspectionOptimizer.getStats(),
      recovery: this.recoveryOptimizer.getStats()
    };
  }

  /**
   * Reset all optimizers
   */
  reset() {
    this.retryStrategy.reset();
    this.inspectionOptimizer.clearCache();
  }
}

module.exports = {
  FeedbackLoopOptimizer,
  SmartRetryStrategy,
  InspectionLoopOptimizer,
  RecoveryLoopOptimizer
};

// Made with Bob
