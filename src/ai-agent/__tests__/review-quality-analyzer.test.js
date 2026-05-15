/**
 * review-quality-analyzer.test.js
 * 
 * Tests for the review quality analyzer module
 */

const {
  analyzeMagicValues,
  analyzeFunctionComplexity,
  analyzeNaming,
  analyzeErrorHandling,
  analyzeSecurityIssues,
  calculateQualityScore,
  QUALITY_METRICS
} = require("../review-quality-analyzer");

describe("review-quality-analyzer", () => {
  describe("analyzeMagicValues", () => {
    test("detects magic numbers", () => {
      const content = `
function calculate() {
  const timeout = 5000;
  const maxRetries = 42;
  return timeout * maxRetries;
}
`;
      const issues = analyzeMagicValues(content, "test.js");
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.message.includes("5000"))).toBe(true);
      expect(issues.some(i => i.message.includes("42"))).toBe(true);
    });
    
    test("ignores common constants", () => {
      const content = `
function process(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === 1 || arr[i] === -1) {
      return 2;
    }
  }
  return 0;
}
`;
      const issues = analyzeMagicValues(content, "test.js");
      
      // Should not flag 0, 1, -1, 2
      expect(issues.length).toBe(0);
    });
    
    test("detects magic strings", () => {
      const content = `
const message = "This is a very long hardcoded string that should be extracted";
console.log(message);
`;
      const issues = analyzeMagicValues(content, "test.js");
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].type).toBe("magic-numbers-strings");
    });
    
    test("ignores URLs and paths", () => {
      const content = `
const url = "https://example.com/api/endpoint";
const path = "C:\\\\Users\\\\test\\\\file.txt";
`;
      const issues = analyzeMagicValues(content, "test.js");
      
      expect(issues.length).toBe(0);
    });
  });
  
  describe("analyzeFunctionComplexity", () => {
    test("detects long functions", () => {
      const lines = ["function longFunction() {"];
      for (let i = 0; i < 60; i++) {
        lines.push(`  console.log(${i});`);
      }
      lines.push("}");
      const content = lines.join("\n");
      
      const issues = analyzeFunctionComplexity(content, "test.js");
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].type).toBe("function-length");
      expect(issues[0].severity).toBe("high");
    });
    
    test("detects deep nesting", () => {
      const content = `
function deeplyNested() {
  if (true) {
    if (true) {
      if (true) {
        if (true) {
          if (true) {
            console.log("too deep");
          }
        }
      }
    }
  }
}
`;
      const issues = analyzeFunctionComplexity(content, "test.js");
      
      expect(issues.some(i => i.message.includes("nesting"))).toBe(true);
    });
    
    test("handles arrow functions", () => {
      const content = `
const myFunc = () => {
  console.log("test");
};
`;
      const issues = analyzeFunctionComplexity(content, "test.js");
      
      // Short function, no issues
      expect(issues.length).toBe(0);
    });
  });
  
  describe("analyzeNaming", () => {
    test("detects single-letter variables", () => {
      const content = `
const x = 10;
const y = 20;
`;
      const issues = analyzeNaming(content, "test.js");
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.message.includes("'x'"))).toBe(true);
      expect(issues.some(i => i.message.includes("'y'"))).toBe(true);
    });
    
    test("allows single-letter loop variables", () => {
      const content = `
for (let i = 0; i < 10; i++) {
  for (let j = 0; j < 10; j++) {
    console.log(i, j);
  }
}
`;
      const issues = analyzeNaming(content, "test.js");
      
      // i and j are acceptable in loops
      expect(issues.length).toBe(0);
    });
    
    test("detects unclear abbreviations", () => {
      const content = `
const usrNm = "John";
const tmpVal = 42;
`;
      const issues = analyzeNaming(content, "test.js");
      
      expect(issues.length).toBeGreaterThan(0);
    });
    
    test("allows common abbreviations", () => {
      const content = `
const id = 123;
const url = "https://example.com";
const api = new API();
`;
      const issues = analyzeNaming(content, "test.js");
      
      expect(issues.length).toBe(0);
    });
  });
  
  describe("analyzeErrorHandling", () => {
    test("detects empty catch blocks", () => {
      const content = `
try {
  riskyOperation();
} catch (e) {
}
`;
      const issues = analyzeErrorHandling(content, "test.js");
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].title).toContain("Empty catch block");
      expect(issues[0].severity).toBe("high");
    });
    
    test("detects unlogged errors", () => {
      const content = `
try {
  riskyOperation();
} catch (err) {
  // Do nothing
}
`;
      const issues = analyzeErrorHandling(content, "test.js");
      
      expect(issues.some(i => i.message.includes("not logged"))).toBe(true);
    });
    
    test("accepts proper error handling", () => {
      const content = `
try {
  riskyOperation();
} catch (err) {
  console.error("Operation failed:", err);
  throw err;
}
`;
      const issues = analyzeErrorHandling(content, "test.js");
      
      // Should not flag this as it has logging
      expect(issues.filter(i => i.message.includes("not logged")).length).toBe(0);
    });
    
    test("detects async functions without error handling", () => {
      const content = `
async function fetchData() {
  const response = await fetch(url);
  return response.json();
}
`;
      const issues = analyzeErrorHandling(content, "test.js");
      
      expect(issues.some(i => i.message.includes("Async function"))).toBe(true);
    });
  });
  
  describe("analyzeSecurityIssues", () => {
    test("detects hardcoded credentials", () => {
      const content = `
const apiKey = "sk-1234567890abcdef";
const password = "mySecretPassword123";
`;
      const issues = analyzeSecurityIssues(content, "test.js");
      
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].severity).toBe("critical");
      expect(issues[0].category).toBe("security");
    });
    
    test("detects eval usage", () => {
      const content = `
const code = "console.log('hello')";
eval(code);
`;
      const issues = analyzeSecurityIssues(content, "test.js");
      
      expect(issues.some(i => i.message.includes("eval()"))).toBe(true);
      expect(issues.find(i => i.message.includes("eval()")).severity).toBe("critical");
    });
    
    test("detects SQL injection risks", () => {
      const content = `
const query = "SELECT * FROM users WHERE id = " + userId;
db.execute(query);
`;
      const issues = analyzeSecurityIssues(content, "test.js");
      
      expect(issues.some(i => i.message.includes("SQL injection"))).toBe(true);
      expect(issues.find(i => i.message.includes("SQL injection")).severity).toBe("high");
    });
    
    test("detects template literal SQL injection", () => {
      const content = `
const query = \`SELECT * FROM users WHERE name = '\${userName}'\`;
db.query(query);
`;
      const issues = analyzeSecurityIssues(content, "test.js");
      
      expect(issues.some(i => i.message.includes("SQL injection"))).toBe(true);
    });
  });
  
  describe("calculateQualityScore", () => {
    test("returns 100 for no issues", () => {
      const score = calculateQualityScore([], 100);
      expect(score).toBe(100);
    });
    
    test("deducts points for critical issues", () => {
      const issues = [
        { severity: "critical" },
        { severity: "critical" }
      ];
      const score = calculateQualityScore(issues, 100);
      expect(score).toBeLessThan(100);
      expect(score).toBeLessThanOrEqual(80); // 2 * 10 points
    });
    
    test("deducts points for high issues", () => {
      const issues = [
        { severity: "high" },
        { severity: "high" }
      ];
      const score = calculateQualityScore(issues, 100);
      expect(score).toBeLessThan(100);
      expect(score).toBeLessThanOrEqual(90); // 2 * 5 points
    });
    
    test("deducts points for medium issues", () => {
      const issues = [
        { severity: "medium" },
        { severity: "medium" }
      ];
      const score = calculateQualityScore(issues, 100);
      expect(score).toBeLessThan(100);
      expect(score).toBeLessThanOrEqual(96); // 2 * 2 points
    });
    
    test("deducts points for low issues", () => {
      const issues = [
        { severity: "low" },
        { severity: "low" }
      ];
      const score = calculateQualityScore(issues, 100);
      expect(score).toBeLessThan(100);
      expect(score).toBeLessThanOrEqual(98); // 2 * 1 point
    });
    
    test("normalizes by lines of code", () => {
      const issues = [{ severity: "medium" }];
      const score1 = calculateQualityScore(issues, 100);
      const score2 = calculateQualityScore(issues, 1000);
      
      // More lines of code should result in higher score for same issues
      expect(score2).toBeGreaterThan(score1);
    });
    
    test("never returns negative score", () => {
      const issues = Array(100).fill({ severity: "critical" });
      const score = calculateQualityScore(issues, 10);
      expect(score).toBeGreaterThanOrEqual(0);
    });
    
    test("never returns score above 100", () => {
      const issues = [];
      const score = calculateQualityScore(issues, 1000);
      expect(score).toBeLessThanOrEqual(100);
    });
  });
  
  describe("QUALITY_METRICS", () => {
    test("has reasonable thresholds", () => {
      expect(QUALITY_METRICS.MAX_FUNCTION_LENGTH).toBeGreaterThan(0);
      expect(QUALITY_METRICS.MAX_CYCLOMATIC_COMPLEXITY).toBeGreaterThan(0);
      expect(QUALITY_METRICS.MAX_NESTING_DEPTH).toBeGreaterThan(0);
      expect(QUALITY_METRICS.MAX_PARAMETERS).toBeGreaterThan(0);
      expect(QUALITY_METRICS.MAX_LINE_LENGTH).toBeGreaterThan(0);
      expect(QUALITY_METRICS.MIN_COMMENT_RATIO).toBeGreaterThan(0);
      expect(QUALITY_METRICS.MIN_COMMENT_RATIO).toBeLessThan(1);
    });
  });
});

// Made with Bob