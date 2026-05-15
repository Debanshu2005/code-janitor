/**
 * review-quality-analyzer.js
 * 
 * Analyzes code quality and generates review findings.
 * Provides automated code review capabilities with configurable rules.
 */

const fs = require("fs").promises;
const path = require("path");

/**
 * Quality metrics for code analysis
 */
const QUALITY_METRICS = {
  // Complexity thresholds
  MAX_FUNCTION_LENGTH: 50,
  MAX_CYCLOMATIC_COMPLEXITY: 10,
  MAX_NESTING_DEPTH: 4,
  
  // Code smell thresholds
  MAX_PARAMETERS: 5,
  MAX_LINE_LENGTH: 120,
  MIN_COMMENT_RATIO: 0.1,
  
  // Naming conventions
  MIN_VARIABLE_NAME_LENGTH: 2,
  MAX_VARIABLE_NAME_LENGTH: 50
};

/**
 * Analyze code for magic numbers and strings
 */
function analyzeMagicValues(content, filePath) {
  const issues = [];
  const lines = content.split("\n");
  
  // Regex for magic numbers (excluding 0, 1, -1, common constants)
  const magicNumberRegex = /\b(?<![\w.])((?!0|1|-1|2|10|100|1000)\d{2,})\b(?![\w.])/g;
  
  // Regex for hardcoded strings (excluding imports, requires, common strings)
  const magicStringRegex = /["']([^"'\n]{15,})["']/g;
  
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    
    // Skip comments and imports
    if (line.trim().startsWith("//") || 
        line.trim().startsWith("*") ||
        line.includes("import ") ||
        line.includes("require(")) {
      return;
    }
    
    // Check for magic numbers
    let match;
    while ((match = magicNumberRegex.exec(line)) !== null) {
      issues.push({
        category: "maintainability",
        type: "magic-numbers-strings",
        severity: "medium",
        title: `Magic number: ${match[1]}`,
        message: `The magic number ${match[1]} should be extracted to a named constant for better maintainability.`,
        path: filePath,
        line: lineNum,
        column: match.index + 1,
        issueScope: "Single File",
        suggestion: `Extract ${match[1]} to a named constant like MAX_RETRIES or TIMEOUT_MS`
      });
    }
    
    // Check for magic strings
    magicStringRegex.lastIndex = 0;
    while ((match = magicStringRegex.exec(line)) !== null) {
      const str = match[1];
      // Skip URLs, file paths, and common patterns
      if (!str.includes("://") && !str.includes("\\") && !str.includes("/")) {
        issues.push({
          category: "maintainability",
          type: "magic-numbers-strings",
          severity: "low",
          title: `Magic string detected`,
          message: `The hardcoded string "${str.substring(0, 50)}..." should be extracted to a constant.`,
          path: filePath,
          line: lineNum,
          column: match.index + 1,
          issueScope: "Single File",
          suggestion: "Extract to a named constant or configuration"
        });
      }
    }
  });
  
  return issues;
}

/**
 * Analyze function length and complexity
 */
function analyzeFunctionComplexity(content, filePath) {
  const issues = [];
  const lines = content.split("\n");
  
  let inFunction = false;
  let functionStart = 0;
  let functionName = "";
  let braceCount = 0;
  let nestingDepth = 0;
  let maxNesting = 0;
  
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();
    
    // Detect function start
    const funcMatch = trimmed.match(/(?:function\s+(\w+)|(\w+)\s*[:=]\s*(?:async\s+)?function|(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?:=>|{))/);
    if (funcMatch && !inFunction) {
      inFunction = true;
      functionStart = lineNum;
      functionName = funcMatch[1] || funcMatch[2] || funcMatch[3] || "anonymous";
      braceCount = 0;
      nestingDepth = 0;
      maxNesting = 0;
    }
    
    if (inFunction) {
      // Track nesting depth
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      
      braceCount += openBraces - closeBraces;
      nestingDepth += openBraces;
      maxNesting = Math.max(maxNesting, nestingDepth);
      nestingDepth -= closeBraces;
      
      // Check if function ended
      if (braceCount <= 0 && inFunction) {
        const functionLength = lineNum - functionStart + 1;
        
        // Check function length
        if (functionLength > QUALITY_METRICS.MAX_FUNCTION_LENGTH) {
          issues.push({
            category: "maintainability",
            type: "function-length",
            severity: functionLength > QUALITY_METRICS.MAX_FUNCTION_LENGTH * 2 ? "high" : "medium",
            title: `Function '${functionName}' is too long`,
            message: `Function '${functionName}' has ${functionLength} lines, exceeding the recommended maximum of ${QUALITY_METRICS.MAX_FUNCTION_LENGTH} lines. Consider breaking it into smaller, focused functions.`,
            path: filePath,
            line: functionStart,
            endLine: lineNum,
            issueScope: "Single File",
            suggestion: "Break this function into smaller, single-responsibility functions"
          });
        }
        
        // Check nesting depth
        if (maxNesting > QUALITY_METRICS.MAX_NESTING_DEPTH) {
          issues.push({
            category: "maintainability",
            type: "modularity-function-length",
            severity: "medium",
            title: `Function '${functionName}' has deep nesting`,
            message: `Function '${functionName}' has a maximum nesting depth of ${maxNesting}, exceeding the recommended maximum of ${QUALITY_METRICS.MAX_NESTING_DEPTH}. This makes the code harder to understand and maintain.`,
            path: filePath,
            line: functionStart,
            endLine: lineNum,
            issueScope: "Single File",
            suggestion: "Reduce nesting by extracting nested logic into separate functions or using early returns"
          });
        }
        
        inFunction = false;
      }
    }
  });
  
  return issues;
}

/**
 * Analyze naming conventions
 */
function analyzeNaming(content, filePath) {
  const issues = [];
  const lines = content.split("\n");
  
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    
    // Check for single-letter variables (except common ones like i, j, k in loops)
    const singleLetterRegex = /\b(?:const|let|var)\s+([a-hm-z])\s*=/gi;
    let match;
    
    while ((match = singleLetterRegex.exec(line)) !== null) {
      issues.push({
        category: "maintainability",
        type: "naming-convention",
        severity: "low",
        title: `Single-letter variable name: ${match[1]}`,
        message: `Variable '${match[1]}' uses a single-letter name. Use descriptive names that convey intent.`,
        path: filePath,
        line: lineNum,
        column: match.index + 1,
        issueScope: "Single File",
        suggestion: "Use a descriptive name that explains the variable's purpose"
      });
    }
    
    // Check for unclear abbreviations
    const unclearAbbrevRegex = /\b(?:const|let|var)\s+([a-z]{1,3}[A-Z])/g;
    while ((match = unclearAbbrevRegex.exec(line)) !== null) {
      const varName = match[1];
      if (varName.length < 4 && !["id", "url", "api", "db"].includes(varName.toLowerCase())) {
        issues.push({
          category: "maintainability",
          type: "naming-intent-review",
          severity: "low",
          title: `Unclear variable name: ${varName}`,
          message: `Variable '${varName}' may be unclear. Consider using a more descriptive name.`,
          path: filePath,
          line: lineNum,
          column: match.index + 1,
          issueScope: "Single File"
        });
      }
    }
  });
  
  return issues;
}

/**
 * Analyze error handling
 */
function analyzeErrorHandling(content, filePath) {
  const issues = [];
  const lines = content.split("\n");
  
  let inTryCatch = false;
  let tryStart = 0;
  let hasCatch = false;
  
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();
    
    if (trimmed.startsWith("try")) {
      inTryCatch = true;
      tryStart = lineNum;
      hasCatch = false;
    }
    
    if (inTryCatch && trimmed.startsWith("catch")) {
      hasCatch = true;
      
      // Check for empty catch blocks
      const nextLine = lines[index + 1]?.trim() || "";
      if (nextLine === "}") {
        issues.push({
          category: "functionality",
          type: "error-handling-review",
          severity: "high",
          title: "Empty catch block",
          message: "Empty catch block silently swallows errors. Add proper error handling or logging.",
          path: filePath,
          line: lineNum,
          endLine: lineNum + 1,
          issueScope: "Single File",
          suggestion: "Add error logging or re-throw the error after handling"
        });
      }
      
      // Check for generic error handling
      if (line.includes("catch (e)") || line.includes("catch (err)")) {
        const catchBlock = lines.slice(index, index + 5).join("\n");
        if (!catchBlock.includes("console.") && !catchBlock.includes("log")) {
          issues.push({
            category: "functionality",
            type: "error-handling-review",
            severity: "medium",
            title: "Error not logged",
            message: "Caught error is not logged. Consider adding error logging for debugging.",
            path: filePath,
            line: lineNum,
            issueScope: "Single File",
            suggestion: "Add console.error() or proper logging"
          });
        }
      }
    }
    
    if (inTryCatch && trimmed === "}" && hasCatch) {
      inTryCatch = false;
    }
    
    // Check for unhandled promises
    if (line.includes("async ") && !line.includes("await") && !inTryCatch) {
      const nextFewLines = lines.slice(index, index + 10).join("\n");
      if (!nextFewLines.includes("try") && !nextFewLines.includes("catch")) {
        issues.push({
          category: "functionality",
          type: "error-handling-review",
          severity: "medium",
          title: "Async function without error handling",
          message: "Async function lacks try-catch error handling. Unhandled promise rejections can crash the application.",
          path: filePath,
          line: lineNum,
          issueScope: "Single File",
          suggestion: "Wrap async operations in try-catch blocks"
        });
      }
    }
  });
  
  return issues;
}

/**
 * Analyze security issues
 */
function analyzeSecurityIssues(content, filePath) {
  const issues = [];
  const lines = content.split("\n");
  
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const lower = line.toLowerCase();
    
    // Check for hardcoded credentials
    if (lower.includes("password") || lower.includes("apikey") || lower.includes("secret")) {
      if (line.includes("=") && (line.includes('"') || line.includes("'"))) {
        issues.push({
          category: "security",
          type: "sensitive-data-logging",
          severity: "critical",
          title: "Potential hardcoded credential",
          message: "Possible hardcoded credential detected. Credentials should be stored in environment variables or secure vaults.",
          path: filePath,
          line: lineNum,
          issueScope: "Single File",
          suggestion: "Use environment variables or a secure configuration system"
        });
      }
    }
    
    // Check for eval usage
    if (line.includes("eval(")) {
      issues.push({
        category: "security",
        type: "suggest-security-fixes",
        severity: "critical",
        title: "Use of eval() detected",
        message: "eval() can execute arbitrary code and is a major security risk. Avoid using eval().",
        path: filePath,
        line: lineNum,
        issueScope: "Single File",
        suggestion: "Use safer alternatives like JSON.parse() or Function constructor with proper validation"
      });
    }
    
    // Check for SQL injection risks
    if (line.includes("query(") || line.includes("execute(")) {
      if (line.includes("+") || line.includes("${")) {
        issues.push({
          category: "security",
          type: "input-sanitization-review",
          severity: "high",
          title: "Potential SQL injection risk",
          message: "String concatenation in database queries can lead to SQL injection. Use parameterized queries.",
          path: filePath,
          line: lineNum,
          issueScope: "Single File",
          suggestion: "Use parameterized queries or prepared statements"
        });
      }
    }
  });
  
  return issues;
}

/**
 * Analyze code quality for a file
 * 
 * @param {string} filePath - Path to the file to analyze
 * @param {string} workspaceRoot - Workspace root directory
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Analysis results with issues
 */
async function analyzeFile(filePath, workspaceRoot, options = {}) {
  const fullPath = path.resolve(workspaceRoot, filePath);
  
  try {
    const content = await fs.readFile(fullPath, "utf-8");
    const relativePath = path.relative(workspaceRoot, fullPath);
    
    const allIssues = [];
    
    // Run all analyzers
    if (options.analyzeMagicValues !== false) {
      allIssues.push(...analyzeMagicValues(content, relativePath));
    }
    
    if (options.analyzeFunctionComplexity !== false) {
      allIssues.push(...analyzeFunctionComplexity(content, relativePath));
    }
    
    if (options.analyzeNaming !== false) {
      allIssues.push(...analyzeNaming(content, relativePath));
    }
    
    if (options.analyzeErrorHandling !== false) {
      allIssues.push(...analyzeErrorHandling(content, relativePath));
    }
    
    if (options.analyzeSecurity !== false) {
      allIssues.push(...analyzeSecurityIssues(content, relativePath));
    }
    
    return {
      success: true,
      filePath: relativePath,
      issues: allIssues,
      summary: {
        total: allIssues.length,
        critical: allIssues.filter(i => i.severity === "critical").length,
        high: allIssues.filter(i => i.severity === "high").length,
        medium: allIssues.filter(i => i.severity === "medium").length,
        low: allIssues.filter(i => i.severity === "low").length
      }
    };
  } catch (error) {
    return {
      success: false,
      filePath,
      error: error.message
    };
  }
}

/**
 * Generate quality score based on issues
 */
function calculateQualityScore(issues, linesOfCode) {
  let score = 100;
  
  // Deduct points based on severity
  for (const issue of issues) {
    switch (issue.severity) {
      case "critical":
        score -= 10;
        break;
      case "high":
        score -= 5;
        break;
      case "medium":
        score -= 2;
        break;
      case "low":
        score -= 1;
        break;
    }
  }
  
  // Normalize by lines of code (issues per 100 lines)
  if (linesOfCode > 0) {
    const issuesPerHundredLines = (issues.length / linesOfCode) * 100;
    score -= issuesPerHundredLines * 0.5;
  }
  
  return Math.max(0, Math.min(100, score));
}

module.exports = {
  analyzeFile,
  analyzeMagicValues,
  analyzeFunctionComplexity,
  analyzeNaming,
  analyzeErrorHandling,
  analyzeSecurityIssues,
  calculateQualityScore,
  QUALITY_METRICS
};

// Made with Bob