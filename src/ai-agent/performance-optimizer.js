/**
 * Performance Optimizer for Workspace Editing
 * Provides caching, parallel execution, and smart recovery
 */

/**
 * LRU Cache for file content with TTL
 */
class FileContentCache {
  constructor(maxSize = 50, ttlMs = 300000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.hits = 0;
    this.misses = 0;
  }

  async get(filePath, readFn) {
    const cached = this.cache.get(filePath);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      this.hits++;
      return cached.content;
    }

    this.misses++;
    const content = await readFn(filePath);
    this.set(filePath, content);
    return content;
  }

  set(filePath, content) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(filePath, { content, timestamp: Date.now() });
  }

  invalidate(filePath) {
    this.cache.delete(filePath);
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + "%" : "0%",
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }
}

/**
 * Path normalization cache
 */
class PathCache {
  constructor(maxSize = 200) {
    this.normalized = new Map();
    this.maxSize = maxSize;
  }

  normalize(filePath, workspaceRoot, normalizeFn) {
    const key = `${filePath}:${workspaceRoot}`;
    if (this.normalized.has(key)) {
      return this.normalized.get(key);
    }

    const result = normalizeFn(filePath, workspaceRoot);
    
    if (this.normalized.size >= this.maxSize) {
      const firstKey = this.normalized.keys().next().value;
      this.normalized.delete(firstKey);
    }
    
    this.normalized.set(key, result);
    return result;
  }

  clear() {
    this.normalized.clear();
  }
}

/**
 * Compiled regex pattern cache
 */
const COMPILED_PATTERNS = Object.freeze({
  patch: /PATCH:\s*([^\r\n`]+)\r?\nSEARCH:\s*\r?\n```[\w]*\r?\n?([\s\S]*?)```\s*\r?\nREPLACE:\s*\r?\n```[\w]*\r?\n?([\s\S]*?)```/g,
  file: /FILE:\s*([^\r\n`]+)\r?\n```[\w]*\r?\n?([\s\S]*?)```/g,
  mkdir: /MKDIR:\s*([^\r\n`]+)/g,
  cmd: /CMD:\s*([^\r\n]+)/g,
  read: /READ:\s*([^\r\n`]+)/g,
  grep: /GREP:\s*([^\r\n`]+)\s+in\s+([^\r\n]+)/gi
});

const FILE_WRITE_ACTION_TYPES = new Set([
  "patch",
  "file",
  "apply_diff",
  "insert_content"
]);

function getActionLineFootprint(action) {
  if (!action || typeof action !== "object") {
    return 0;
  }

  if (action.type === "patch") {
    return String(action.search || "").split("\n").length;
  }

  if (action.type === "file") {
    return String(action.content || "").split("\n").length;
  }

  if (action.type === "apply_diff") {
    return String(action.diff || "").split("\n").length;
  }

  if (action.type === "insert_content") {
    return String(action.content || "").split("\n").length;
  }

  return 0;
}

/**
 * Action dependency graph builder and parallel executor
 */
class ParallelActionExecutor {
  constructor() {
    this.executionStats = {
      sequential: 0,
      parallel: 0,
      totalTime: 0,
      parallelTime: 0
    };
  }

  /**
   * Build dependency graph for actions
   */
  buildDependencyGraph(actions) {
    const fileWrites = new Map();
    const independent = [];
    const mkdirs = [];
    const commands = [];

    for (const action of actions) {
      if (FILE_WRITE_ACTION_TYPES.has(action.type)) {
        if (!fileWrites.has(action.path)) {
          fileWrites.set(action.path, []);
        }
        fileWrites.get(action.path).push(action);
      } else if (action.type === "mkdir") {
        mkdirs.push(action);
      } else if (action.type === "cmd") {
        commands.push(action);
      } else {
        independent.push(action);
      }
    }

    return { fileWrites, independent, mkdirs, commands };
  }

  /**
   * Sort mkdir actions by depth (parent dirs first)
   */
  sortMkdirByDepth(mkdirActions) {
    return mkdirActions.sort((a, b) => {
      const depthA = a.path.split(/[/\\]/).length;
      const depthB = b.path.split(/[/\\]/).length;
      return depthA - depthB;
    });
  }

  /**
   * Execute actions in parallel where possible
   */
  async executeParallel(actions, executeFn) {
    const startTime = Date.now();
    const { fileWrites, independent, mkdirs, commands } = this.buildDependencyGraph(actions);

    const results = [];

    // Phase 1: Execute mkdir operations (must be sequential by depth)
    if (mkdirs.length > 0) {
      const sortedMkdirs = this.sortMkdirByDepth(mkdirs);
      for (const mkdir of sortedMkdirs) {
        const result = await executeFn(mkdir);
        results.push(result);
      }
    }

    // Phase 2: Execute file writes in parallel (one group per file)
    if (fileWrites.size > 0) {
      const fileGroups = Array.from(fileWrites.values());
      const parallelResults = await Promise.allSettled(
        fileGroups.map(async (group) => {
          // Within a file, execute sequentially
          const groupResults = [];
          for (const action of group) {
            const result = await executeFn(action);
            groupResults.push(result);
          }
          return groupResults;
        })
      );

      for (const result of parallelResults) {
        if (result.status === "fulfilled") {
          results.push(...result.value);
        } else {
          results.push({ success: false, error: result.reason });
        }
      }
    }

    // Phase 3: Execute independent actions in parallel
    if (independent.length > 0) {
      const independentResults = await Promise.allSettled(
        independent.map(action => executeFn(action))
      );

      for (const result of independentResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({ success: false, error: result.reason });
        }
      }
    }

    // Phase 4: Execute commands (can be parallel if independent)
    if (commands.length > 0) {
      const commandResults = await Promise.allSettled(
        commands.map(cmd => executeFn(cmd))
      );

      for (const result of commandResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({ success: false, error: result.reason });
        }
      }
    }

    const endTime = Date.now();
    this.executionStats.parallel++;
    this.executionStats.parallelTime += (endTime - startTime);

    return results;
  }

  getStats() {
    const avgSequential = this.executionStats.sequential > 0 
      ? this.executionStats.totalTime / this.executionStats.sequential 
      : 0;
    const avgParallel = this.executionStats.parallel > 0 
      ? this.executionStats.parallelTime / this.executionStats.parallel 
      : 0;

    return {
      sequential: this.executionStats.sequential,
      parallel: this.executionStats.parallel,
      avgSequentialTime: avgSequential.toFixed(2) + "ms",
      avgParallelTime: avgParallel.toFixed(2) + "ms",
      speedup: avgSequential > 0 ? (avgSequential / avgParallel).toFixed(2) + "x" : "N/A"
    };
  }
}

/**
 * Smart patch matcher with fuzzy matching
 */
class SmartPatchMatcher {
  constructor() {
    this.failurePatterns = new Map();
  }

  /**
   * Try multiple matching strategies
   */
  async tryMatch(content, search, replace) {
    // Strategy 1: Exact match
    const exact = this._tryExactMatch(content, search, replace);
    if (exact.matched || exact.reason === "ambiguous") return exact;

    // Strategy 2: Normalized line endings
    const normalized = this._tryNormalizedMatch(content, search, replace);
    if (normalized.matched || normalized.reason === "ambiguous") return normalized;

    // Strategy 3: Whitespace normalization
    const whitespace = this._tryWhitespaceMatch(content, search, replace);
    if (whitespace.matched || whitespace.reason === "ambiguous") return whitespace;

    // Strategy 4: Fuzzy match (if confidence > 85%)
    const fuzzy = this._tryFuzzyMatch(content, search, replace);
    if (fuzzy.matched && fuzzy.confidence > 0.85) return fuzzy;

    return { matched: false, reason: "no_match" };
  }

  _tryExactMatch(content, search, replace) {
    if (content.includes(search)) {
      const count = this._countOccurrences(content, search);
      if (count !== 1) {
        return { matched: false, reason: "ambiguous", matchCount: count };
      }
      return {
        matched: true,
        content: this._literalSplice(content, search, replace),
        strategy: "exact"
      };
    }
    return { matched: false };
  }

  _tryNormalizedMatch(content, search, replace) {
    const normalizeLineEndings = (text) => text.replace(/\r\n/g, "\n");
    const contentUnix = normalizeLineEndings(content);
    const searchUnix = normalizeLineEndings(search);
    const replaceUnix = normalizeLineEndings(replace);
    const prefersCrlf = content.includes("\r\n");

    if (contentUnix.includes(searchUnix)) {
      const count = this._countOccurrences(contentUnix, searchUnix);
      if (count !== 1) {
        return { matched: false, reason: "ambiguous", matchCount: count };
      }
      let result = this._literalSplice(contentUnix, searchUnix, replaceUnix);
      if (prefersCrlf) {
        result = result.replace(/\n/g, "\r\n");
      }
      return { matched: true, content: result, strategy: "normalized" };
    }
    return { matched: false };
  }

  _tryWhitespaceMatch(content, search, replace) {
    const normalize = (s) => s.replace(/\s+/g, " ").trim();
    const normalizedContent = normalize(content);
    const normalizedSearch = normalize(search);

    if (!normalizedSearch || !normalizedContent.includes(normalizedSearch)) {
      return { matched: false };
    }

    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patternSource = escapedSearch.replace(/\s+/g, "\\s+");
    const whitespaceAwarePattern = new RegExp(patternSource);
    const whitespaceAwareMatches =
      content.match(new RegExp(patternSource, "g")) || [];

    if (whitespaceAwareMatches.length !== 1) {
      return {
        matched: false,
        reason: "ambiguous",
        matchCount: whitespaceAwareMatches.length
      };
    }

    const nextContent = content.replace(whitespaceAwarePattern, () => replace);
    if (nextContent === content) {
      return { matched: false };
    }

    return {
      matched: true,
      content: nextContent,
      strategy: "whitespace"
    };
  }

  _tryFuzzyMatch(content, search, replace) {
    // Simple fuzzy matching using sliding window
    const searchLines = search.split("\n");
    const contentLines = content.split("\n");
    
    let bestMatch = { similarity: 0, startLine: -1 };
    
    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      const window = contentLines.slice(i, i + searchLines.length);
      const similarity = this._calculateSimilarity(searchLines, window);
      
      if (similarity > bestMatch.similarity) {
        bestMatch = { similarity, startLine: i };
      }
    }

    if (bestMatch.similarity > 0.85) {
      const before = contentLines.slice(0, bestMatch.startLine).join("\n");
      const after = contentLines.slice(bestMatch.startLine + searchLines.length).join("\n");
      return {
        matched: true,
        content: before + (before ? "\n" : "") + replace + (after ? "\n" : "") + after,
        strategy: "fuzzy",
        confidence: bestMatch.similarity
      };
    }

    return { matched: false };
  }

  _calculateSimilarity(lines1, lines2) {
    if (lines1.length !== lines2.length) return 0;
    
    let matches = 0;
    let total = 0;
    
    for (let i = 0; i < lines1.length; i++) {
      const line1 = lines1[i].trim();
      const line2 = lines2[i].trim();
      
      if (line1 === line2) {
        matches += line1.length;
      } else {
        // Character-level similarity
        const maxLen = Math.max(line1.length, line2.length);
        const distance = this._levenshteinDistance(line1, line2);
        matches += Math.max(0, maxLen - distance);
      }
      total += Math.max(line1.length, line2.length);
    }
    
    return total > 0 ? matches / total : 0;
  }

  _levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  _countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let index = 0;
    while ((index = haystack.indexOf(needle, index)) !== -1) {
      count++;
      index += Math.max(needle.length, 1);
    }
    return count;
  }

  _literalSplice(haystack, needle, replacement) {
    const idx = haystack.indexOf(needle);
    return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
  }
}

/**
 * Fast-path detector for simple edits
 */
class FastPathDetector {
  constructor() {
    this.fastPathCount = 0;
    this.slowPathCount = 0;
  }

  /**
   * Check if edit is eligible for fast-path execution
   */
  isFastPathEligible(actions) {
    // Fast-path criteria:
    // 1. Single action only
    // 2. PATCH type (not FILE rewrite)
    // 3. Small change (< 50 lines in search block)
    // 4. Single file target
    // 5. No complex dependencies

    if (!actions || actions.length !== 1) {
      this.slowPathCount++;
      return { eligible: false, reason: "multiple_actions" };
    }

    const action = actions[0];

    if (action.type !== "patch") {
      this.slowPathCount++;
      return { eligible: false, reason: "not_patch" };
    }

    const searchLines = (action.search || "").split("\n").length;
    if (searchLines > 50) {
      this.slowPathCount++;
      return { eligible: false, reason: "large_change" };
    }

    // Check if it's a simple, safe edit
    const isSafeEdit = this._isSafeEdit(action);
    if (!isSafeEdit) {
      this.slowPathCount++;
      return { eligible: false, reason: "unsafe_edit" };
    }

    this.fastPathCount++;
    return { eligible: true, action };
  }

  _isSafeEdit(action) {
    // Safe edits are:
    // - Adding/removing imports
    // - Fixing typos
    // - Adding comments
    // - Simple variable renames
    // - Small function modifications

    const search = (action.search || "").toLowerCase();
    const replace = (action.replace || "").toLowerCase();

    // Check for import changes (usually safe)
    if (search.includes("import") || replace.includes("import")) {
      return true;
    }

    // Check for comment changes (safe)
    if (search.includes("//") || search.includes("/*") || 
        replace.includes("//") || replace.includes("/*")) {
      return true;
    }

    // Check for small changes (< 10 lines difference)
    const searchLineCount = search.split("\n").length;
    const replaceLineCount = replace.split("\n").length;
    if (Math.abs(searchLineCount - replaceLineCount) < 10) {
      return true;
    }

    return false;
  }

  getStats() {
    const total = this.fastPathCount + this.slowPathCount;
    return {
      fastPath: this.fastPathCount,
      slowPath: this.slowPathCount,
      fastPathRate: total > 0 ? (this.fastPathCount / total * 100).toFixed(2) + "%" : "0%"
    };
  }
}

/**
 * Confidence-based gate optimizer
 */
class SmartEditGate {
  constructor() {
    this.gateSkipped = 0;
    this.gateExecuted = 0;
  }

  /**
   * Determine if gate should run based on confidence
   */
  shouldRunGate(actions, context = {}) {
    const confidence = this.calculateConfidence(actions, context);
    const risk = this.assessRisk(actions);

    // Always gate high-risk operations
    if (risk === "high") {
      this.gateExecuted++;
      return { skip: false, reason: "high_risk", confidence, risk };
    }

    // Skip gate for high-confidence, low-risk edits
    if (confidence > 0.9 && risk === "low") {
      this.gateSkipped++;
      return { skip: true, reason: "high_confidence_low_risk", confidence, risk };
    }

    // Skip gate for medium-confidence, low-risk edits
    if (confidence > 0.75 && risk === "low") {
      this.gateSkipped++;
      return { skip: true, reason: "medium_confidence_low_risk", confidence, risk };
    }

    this.gateExecuted++;
    return { skip: false, reason: "default", confidence, risk };
  }

  calculateConfidence(actions, context = {}) {
    let score = 1.0;

    // Reduce confidence for multiple actions
    if (actions.length > 3) score *= 0.8;
    if (actions.length > 5) score *= 0.7;

    // Reduce confidence for large changes
    const totalLines = actions.reduce((sum, action) => {
      return sum + getActionLineFootprint(action);
    }, 0);

    if (totalLines > 100) score *= 0.7;
    if (totalLines > 200) score *= 0.6;

    // Increase confidence for single-file, small patches
    if (actions.length === 1 && totalLines < 20) {
      score = Math.min(score * 1.2, 1.0);
    }

    // Increase confidence if similar edits succeeded recently
    if (context.recentSuccessRate > 0.9) {
      score = Math.min(score * 1.1, 1.0);
    }

    return Math.max(0, Math.min(score, 1.0));
  }

  assessRisk(actions) {
    // High risk indicators
    const hasMultipleFiles = new Set(actions.map(a => a.path)).size > 3;
    const hasLargeChanges = actions.some(a => 
      getActionLineFootprint(a) > 100
    );
    const hasCriticalFiles = actions.some(a => 
      /package\.json|tsconfig\.json|webpack\.config/i.test(a.path || "")
    );

    if (hasLargeChanges || hasCriticalFiles) {
      return "high";
    }

    if (hasMultipleFiles) {
      return "medium";
    }

    return "low";
  }

  getStats() {
    const total = this.gateSkipped + this.gateExecuted;
    return {
      skipped: this.gateSkipped,
      executed: this.gateExecuted,
      skipRate: total > 0 ? (this.gateSkipped / total * 100).toFixed(2) + "%" : "0%"
    };
  }
}

/**
 * Main performance optimizer
 */
class PerformanceOptimizer {
  constructor() {
    this.fileCache = new FileContentCache();
    this.pathCache = new PathCache();
    this.parallelExecutor = new ParallelActionExecutor();
    this.patchMatcher = new SmartPatchMatcher();
    this.fastPathDetector = new FastPathDetector();
    this.editGate = new SmartEditGate();
  }

  getCompiledPatterns() {
    return COMPILED_PATTERNS;
  }

  getAllStats() {
    return {
      fileCache: this.fileCache.getStats(),
      parallelExecution: this.parallelExecutor.getStats(),
      fastPath: this.fastPathDetector.getStats(),
      editGate: this.editGate.getStats()
    };
  }

  clearCaches() {
    this.fileCache.clear();
    this.pathCache.clear();
  }
}

module.exports = {
  PerformanceOptimizer,
  FileContentCache,
  PathCache,
  ParallelActionExecutor,
  SmartPatchMatcher,
  FastPathDetector,
  SmartEditGate,
  COMPILED_PATTERNS
};

// Made with Bob
