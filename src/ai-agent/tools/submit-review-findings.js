/**
 * submit-review-findings.js
 * 
 * Tool for submitting code review findings that appear in the Bob Findings panel.
 * Supports multiple issue categories, types, and severity levels.
 */

const vscode = require("../../utils/vscode-shim");
const path = require("path");

/**
 * Valid issue categories
 */
const VALID_CATEGORIES = new Set([
  "maintainability",
  "security",
  "performance",
  "functionality",
  "style"
]);

/**
 * Valid issue types
 */
const VALID_TYPES = new Set([
  "naming-intent-review",
  "comment-quality-analysis",
  "magic-numbers-strings",
  "single-responsibility-violation",
  "modularity-function-length",
  "function-length",
  "style-consistency-check",
  "style-guide-enforcement",
  "dry-principle-violation",
  "log-level-usage-review",
  "company-standards-violation",
  "sensitive-data-logging",
  "input-sanitization-review",
  "gitignore-file-recommendations",
  "secure-dependency-check",
  "suggest-security-fixes",
  "inefficient-algorithm",
  "memory-leak",
  "resource-leak",
  "unnecessary-computation",
  "blocking-operation",
  "edge-case-handling",
  "error-handling-review",
  "issue-alignment-scoring",
  "race-condition-warning",
  "global-state-warning",
  "backward-compatibility-warnings",
  "inconsistent-formatting",
  "missing-documentation",
  "unclear-comments",
  "naming-convention"
]);

/**
 * Valid severity levels
 */
const VALID_SEVERITIES = new Set([
  "critical",
  "high",
  "medium",
  "low"
]);

/**
 * Valid issue scopes
 */
const VALID_SCOPES = new Set([
  "Single File",
  "Multiple Files"
]);

/**
 * Maximum number of issues per submission
 */
const MAX_ISSUES_PER_SUBMISSION = 50;

/**
 * Validate a single issue object
 */
function validateIssue(issue, index) {
  const errors = [];
  
  if (!issue || typeof issue !== "object") {
    errors.push(`Issue ${index}: must be an object`);
    return errors;
  }
  
  // Required fields
  if (!issue.category || !VALID_CATEGORIES.has(issue.category)) {
    errors.push(`Issue ${index}: invalid or missing category. Must be one of: ${Array.from(VALID_CATEGORIES).join(", ")}`);
  }
  
  if (!issue.type || !VALID_TYPES.has(issue.type)) {
    errors.push(`Issue ${index}: invalid or missing type. Must be one of: ${Array.from(VALID_TYPES).join(", ")}`);
  }
  
  if (!issue.severity || !VALID_SEVERITIES.has(issue.severity)) {
    errors.push(`Issue ${index}: invalid or missing severity. Must be one of: ${Array.from(VALID_SEVERITIES).join(", ")}`);
  }
  
  if (!issue.title || typeof issue.title !== "string" || issue.title.trim().length === 0) {
    errors.push(`Issue ${index}: title is required and must be a non-empty string`);
  }
  
  if (!issue.message || typeof issue.message !== "string" || issue.message.trim().length === 0) {
    errors.push(`Issue ${index}: message is required and must be a non-empty string`);
  }
  
  if (!issue.path || typeof issue.path !== "string" || issue.path.trim().length === 0) {
    errors.push(`Issue ${index}: path is required and must be a non-empty string`);
  }
  
  if (typeof issue.line !== "number" || issue.line < 1) {
    errors.push(`Issue ${index}: line must be a positive number`);
  }
  
  if (!issue.issueScope || !VALID_SCOPES.has(issue.issueScope)) {
    errors.push(`Issue ${index}: invalid or missing issueScope. Must be one of: ${Array.from(VALID_SCOPES).join(", ")}`);
  }
  
  // Optional fields validation
  if (issue.column !== undefined && (typeof issue.column !== "number" || issue.column < 1)) {
    errors.push(`Issue ${index}: column must be a positive number if provided`);
  }
  
  if (issue.endLine !== undefined && (typeof issue.endLine !== "number" || issue.endLine < issue.line)) {
    errors.push(`Issue ${index}: endLine must be >= line if provided`);
  }
  
  if (issue.endColumn !== undefined && typeof issue.endColumn !== "number") {
    errors.push(`Issue ${index}: endColumn must be a number if provided`);
  }
  
  if (issue.suggestion !== undefined && typeof issue.suggestion !== "string") {
    errors.push(`Issue ${index}: suggestion must be a string if provided`);
  }
  
  return errors;
}

/**
 * Validate issues array
 */
function validateIssues(issues) {
  if (!Array.isArray(issues)) {
    return {
      valid: false,
      errors: ["issues parameter must be an array"]
    };
  }
  
  if (issues.length === 0) {
    return {
      valid: false,
      errors: ["issues array cannot be empty"]
    };
  }
  
  if (issues.length > MAX_ISSUES_PER_SUBMISSION) {
    return {
      valid: false,
      errors: [`Cannot submit more than ${MAX_ISSUES_PER_SUBMISSION} issues at once. Got ${issues.length} issues.`]
    };
  }
  
  const allErrors = [];
  issues.forEach((issue, index) => {
    const issueErrors = validateIssue(issue, index + 1);
    allErrors.push(...issueErrors);
  });
  
  if (allErrors.length > 0) {
    return {
      valid: false,
      errors: allErrors
    };
  }
  
  return { valid: true };
}

/**
 * Create VSCode diagnostic from issue
 */
function createDiagnostic(issue, workspaceRoot) {
  const startLine = Math.max(0, issue.line - 1);
  const startCol = Math.max(0, (issue.column || 1) - 1);
  const endLine = issue.endLine ? Math.max(0, issue.endLine - 1) : startLine;
  const endCol = issue.endColumn ? Math.max(0, issue.endColumn - 1) : startCol + 1;
  
  const range = new vscode.Range(
    new vscode.Position(startLine, startCol),
    new vscode.Position(endLine, endCol)
  );
  
  // Map severity
  let severity;
  switch (issue.severity) {
    case "critical":
    case "high":
      severity = vscode.DiagnosticSeverity.Error;
      break;
    case "medium":
      severity = vscode.DiagnosticSeverity.Warning;
      break;
    case "low":
      severity = vscode.DiagnosticSeverity.Information;
      break;
    default:
      severity = vscode.DiagnosticSeverity.Warning;
  }
  
  const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
  diagnostic.source = "Bob Review";
  diagnostic.code = issue.type;
  
  // Add metadata
  diagnostic.relatedInformation = [];
  
  if (issue.suggestion) {
    diagnostic.relatedInformation.push(
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(
          vscode.Uri.file(path.resolve(workspaceRoot, issue.path)),
          range
        ),
        `Suggestion: ${issue.suggestion}`
      )
    );
  }
  
  // Add category and scope info
  diagnostic.relatedInformation.push(
    new vscode.DiagnosticRelatedInformation(
      new vscode.Location(
        vscode.Uri.file(path.resolve(workspaceRoot, issue.path)),
        range
      ),
      `Category: ${issue.category} | Scope: ${issue.issueScope}`
    )
  );
  
  return diagnostic;
}

/**
 * Submit review findings
 * 
 * @param {Array} issues - Array of issue objects
 * @param {string} workspaceRoot - Workspace root directory
 * @param {Object} executionContext - Execution context with diagnosticCollection
 * @returns {Object} Result with success status and summary
 */
async function submitReviewFindings(issues, workspaceRoot, executionContext = {}) {
  // Validate issues
  const validation = validateIssues(issues);
  if (!validation.valid) {
    throw new Error(`Invalid issues: ${validation.errors.join("; ")}`);
  }
  
  // Get or create diagnostic collection
  let diagnosticCollection = executionContext.reviewDiagnosticCollection;
  if (!diagnosticCollection) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection("bobReview");
    if (executionContext) {
      executionContext.reviewDiagnosticCollection = diagnosticCollection;
    }
  }
  
  // Group issues by file
  const issuesByFile = new Map();
  for (const issue of issues) {
    const filePath = path.resolve(workspaceRoot, issue.path);
    if (!issuesByFile.has(filePath)) {
      issuesByFile.set(filePath, []);
    }
    issuesByFile.get(filePath).push(issue);
  }
  
  // Create diagnostics for each file
  const diagnosticsByFile = new Map();
  for (const [filePath, fileIssues] of issuesByFile) {
    const diagnostics = fileIssues.map(issue => 
      createDiagnostic(issue, workspaceRoot)
    );
    diagnosticsByFile.set(filePath, diagnostics);
  }
  
  // Update only the affected files so unrelated review results remain visible.
  for (const [filePath, diagnostics] of diagnosticsByFile) {
    const uri = vscode.Uri.file(filePath);
    diagnosticCollection.set(uri, diagnostics);
  }
  
  // Build summary
  const severityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };
  
  const categoryCounts = {};
  
  for (const issue of issues) {
    severityCounts[issue.severity]++;
    categoryCounts[issue.category] = (categoryCounts[issue.category] || 0) + 1;
  }
  
  const summary = {
    totalIssues: issues.length,
    filesAffected: issuesByFile.size,
    bySeverity: severityCounts,
    byCategory: categoryCounts,
    timestamp: new Date().toISOString()
  };
  
  return {
    success: true,
    summary,
    message: `Submitted ${issues.length} review finding(s) across ${issuesByFile.size} file(s)`
  };
}

module.exports = {
  submitReviewFindings,
  validateIssues,
  validateIssue,
  VALID_CATEGORIES,
  VALID_TYPES,
  VALID_SEVERITIES,
  VALID_SCOPES,
  MAX_ISSUES_PER_SUBMISSION
};

// Made with Bob
