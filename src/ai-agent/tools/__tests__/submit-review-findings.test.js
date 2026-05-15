/**
 * submit-review-findings.test.js
 * 
 * Tests for the submit_review_findings tool
 */

const {
  submitReviewFindings,
  validateIssues,
  validateIssue,
  VALID_CATEGORIES,
  VALID_TYPES,
  VALID_SEVERITIES,
  VALID_SCOPES,
  MAX_ISSUES_PER_SUBMISSION
} = require("../submit-review-findings");

describe("submit-review-findings", () => {
  describe("validateIssue", () => {
    test("validates a complete valid issue", () => {
      const issue = {
        category: "maintainability",
        type: "magic-numbers-strings",
        severity: "medium",
        title: "Magic number detected",
        message: "The number 42 should be a constant",
        path: "src/app.js",
        line: 10,
        issueScope: "Single File"
      };
      
      const errors = validateIssue(issue, 1);
      expect(errors).toEqual([]);
    });
    
    test("rejects issue with invalid category", () => {
      const issue = {
        category: "invalid-category",
        type: "magic-numbers-strings",
        severity: "medium",
        title: "Test",
        message: "Test message",
        path: "src/app.js",
        line: 10,
        issueScope: "Single File"
      };
      
      const errors = validateIssue(issue, 1);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("invalid or missing category");
    });
    
    test("rejects issue with invalid severity", () => {
      const issue = {
        category: "maintainability",
        type: "magic-numbers-strings",
        severity: "super-critical",
        title: "Test",
        message: "Test message",
        path: "src/app.js",
        line: 10,
        issueScope: "Single File"
      };
      
      const errors = validateIssue(issue, 1);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("invalid or missing severity");
    });
    
    test("rejects issue with missing required fields", () => {
      const issue = {
        category: "maintainability",
        type: "magic-numbers-strings",
        severity: "medium"
        // Missing title, message, path, line, issueScope
      };
      
      const errors = validateIssue(issue, 1);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes("title"))).toBe(true);
      expect(errors.some(e => e.includes("message"))).toBe(true);
      expect(errors.some(e => e.includes("path"))).toBe(true);
      expect(errors.some(e => e.includes("line"))).toBe(true);
    });
    
    test("validates optional fields when provided", () => {
      const issue = {
        category: "security",
        type: "sensitive-data-logging",
        severity: "critical",
        title: "Hardcoded credential",
        message: "API key in source code",
        path: "src/config.js",
        line: 5,
        column: 10,
        endLine: 5,
        endColumn: 30,
        suggestion: "Use environment variables",
        issueScope: "Single File"
      };
      
      const errors = validateIssue(issue, 1);
      expect(errors).toEqual([]);
    });
    
    test("rejects invalid endLine", () => {
      const issue = {
        category: "maintainability",
        type: "function-length",
        severity: "high",
        title: "Function too long",
        message: "Function exceeds 50 lines",
        path: "src/utils.js",
        line: 100,
        endLine: 50, // Invalid: less than line
        issueScope: "Single File"
      };
      
      const errors = validateIssue(issue, 1);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("endLine must be >= line");
    });
  });
  
  describe("validateIssues", () => {
    test("validates array of valid issues", () => {
      const issues = [
        {
          category: "maintainability",
          type: "magic-numbers-strings",
          severity: "medium",
          title: "Magic number",
          message: "Extract to constant",
          path: "src/app.js",
          line: 10,
          issueScope: "Single File"
        },
        {
          category: "security",
          type: "sensitive-data-logging",
          severity: "critical",
          title: "Hardcoded key",
          message: "API key in code",
          path: "src/config.js",
          line: 5,
          issueScope: "Single File"
        }
      ];
      
      const result = validateIssues(issues);
      expect(result.valid).toBe(true);
    });
    
    test("rejects non-array input", () => {
      const result = validateIssues("not an array");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("must be an array");
    });
    
    test("rejects empty array", () => {
      const result = validateIssues([]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("cannot be empty");
    });
    
    test("rejects too many issues", () => {
      const issues = Array(MAX_ISSUES_PER_SUBMISSION + 1).fill({
        category: "maintainability",
        type: "magic-numbers-strings",
        severity: "low",
        title: "Test",
        message: "Test",
        path: "test.js",
        line: 1,
        issueScope: "Single File"
      });
      
      const result = validateIssues(issues);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Cannot submit more than");
    });
    
    test("collects all validation errors", () => {
      const issues = [
        {
          category: "invalid",
          type: "magic-numbers-strings",
          severity: "medium",
          title: "Test",
          message: "Test",
          path: "test.js",
          line: 1,
          issueScope: "Single File"
        },
        {
          category: "maintainability",
          type: "invalid-type",
          severity: "medium",
          title: "Test",
          message: "Test",
          path: "test.js",
          line: 1,
          issueScope: "Single File"
        }
      ];
      
      const result = validateIssues(issues);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
  
  describe("submitReviewFindings", () => {
    test("returns success with valid issues", async () => {
      const issues = [
        {
          category: "maintainability",
          type: "magic-numbers-strings",
          severity: "medium",
          title: "Magic number",
          message: "Extract to constant",
          path: "src/app.js",
          line: 10,
          issueScope: "Single File"
        }
      ];
      
      const mockDiagnosticCollection = {
        clear: jest.fn(),
        set: jest.fn()
      };
      
      const result = await submitReviewFindings(
        issues,
        "/test/workspace",
        { reviewDiagnosticCollection: mockDiagnosticCollection }
      );
      
      expect(result.success).toBe(true);
      expect(result.summary.totalIssues).toBe(1);
      expect(result.summary.filesAffected).toBe(1);
      expect(result.summary.bySeverity.medium).toBe(1);
      expect(mockDiagnosticCollection.set).toHaveBeenCalled();
    });
    
    test("throws error for invalid issues", async () => {
      const issues = [
        {
          category: "invalid",
          // Missing required fields
        }
      ];
      
      await expect(
        submitReviewFindings(issues, "/test/workspace", {})
      ).rejects.toThrow("Invalid issues");
    });
    
    test("groups issues by file", async () => {
      const issues = [
        {
          category: "maintainability",
          type: "magic-numbers-strings",
          severity: "medium",
          title: "Issue 1",
          message: "Message 1",
          path: "src/app.js",
          line: 10,
          issueScope: "Single File"
        },
        {
          category: "security",
          type: "sensitive-data-logging",
          severity: "critical",
          title: "Issue 2",
          message: "Message 2",
          path: "src/app.js",
          line: 20,
          issueScope: "Single File"
        },
        {
          category: "performance",
          type: "inefficient-algorithm",
          severity: "high",
          title: "Issue 3",
          message: "Message 3",
          path: "src/utils.js",
          line: 5,
          issueScope: "Single File"
        }
      ];
      
      const mockDiagnosticCollection = {
        clear: jest.fn(),
        set: jest.fn()
      };
      
      const result = await submitReviewFindings(
        issues,
        "/test/workspace",
        { reviewDiagnosticCollection: mockDiagnosticCollection }
      );
      
      expect(result.success).toBe(true);
      expect(result.summary.totalIssues).toBe(3);
      expect(result.summary.filesAffected).toBe(2);
      expect(mockDiagnosticCollection.set).toHaveBeenCalledTimes(2);
    });
    
    test("calculates severity counts correctly", async () => {
      const issues = [
        {
          category: "security",
          type: "sensitive-data-logging",
          severity: "critical",
          title: "Critical issue",
          message: "Critical",
          path: "src/app.js",
          line: 1,
          issueScope: "Single File"
        },
        {
          category: "security",
          type: "input-sanitization-review",
          severity: "high",
          title: "High issue",
          message: "High",
          path: "src/app.js",
          line: 2,
          issueScope: "Single File"
        },
        {
          category: "maintainability",
          type: "magic-numbers-strings",
          severity: "medium",
          title: "Medium issue",
          message: "Medium",
          path: "src/app.js",
          line: 3,
          issueScope: "Single File"
        },
        {
          category: "style",
          type: "naming-convention",
          severity: "low",
          title: "Low issue",
          message: "Low",
          path: "src/app.js",
          line: 4,
          issueScope: "Single File"
        }
      ];
      
      const mockDiagnosticCollection = {
        clear: jest.fn(),
        set: jest.fn()
      };
      
      const result = await submitReviewFindings(
        issues,
        "/test/workspace",
        { reviewDiagnosticCollection: mockDiagnosticCollection }
      );
      
      expect(result.summary.bySeverity.critical).toBe(1);
      expect(result.summary.bySeverity.high).toBe(1);
      expect(result.summary.bySeverity.medium).toBe(1);
      expect(result.summary.bySeverity.low).toBe(1);
    });
  });
  
  describe("constants", () => {
    test("VALID_CATEGORIES contains expected values", () => {
      expect(VALID_CATEGORIES.has("maintainability")).toBe(true);
      expect(VALID_CATEGORIES.has("security")).toBe(true);
      expect(VALID_CATEGORIES.has("performance")).toBe(true);
      expect(VALID_CATEGORIES.has("functionality")).toBe(true);
      expect(VALID_CATEGORIES.has("style")).toBe(true);
    });
    
    test("VALID_SEVERITIES contains expected values", () => {
      expect(VALID_SEVERITIES.has("critical")).toBe(true);
      expect(VALID_SEVERITIES.has("high")).toBe(true);
      expect(VALID_SEVERITIES.has("medium")).toBe(true);
      expect(VALID_SEVERITIES.has("low")).toBe(true);
    });
    
    test("VALID_SCOPES contains expected values", () => {
      expect(VALID_SCOPES.has("Single File")).toBe(true);
      expect(VALID_SCOPES.has("Multiple Files")).toBe(true);
    });
    
    test("MAX_ISSUES_PER_SUBMISSION is reasonable", () => {
      expect(MAX_ISSUES_PER_SUBMISSION).toBeGreaterThan(0);
      expect(MAX_ISSUES_PER_SUBMISSION).toBeLessThanOrEqual(100);
    });
  });
});

// Made with Bob
