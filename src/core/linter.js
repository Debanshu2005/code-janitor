const fs = require("fs");
const path = require("path");

/**
 * Linter for JavaScript files with ESLint fallback
 */
class Linter {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async lint() {
    try {
      // Check if file exists
      if (!fs.existsSync(this.filePath)) {
        return {
          success: false,
          message: "File not found"
        };
      }

      // Try ESLint first, fallback to basic linting
      try {
        const { ESLint } = require("eslint");
        return await this.eslintLint();
      } catch (eslintError) {
        console.warn("ESLint not available, using basic linter:", eslintError.message);
        return this.basicLint();
      }
    } catch (error) {
      return {
        success: false,
        message: `Linting failed: ${error.message}`
      };
    }
  }

  async eslintLint() {
    try {
      const { ESLint } = require("eslint");
      const eslint = new ESLint({
        useEslintrc: false,
        baseConfig: {
          env: {
            browser: true,
            node: true,
            es6: true
          },
          parserOptions: {
            ecmaVersion: 2021,
            sourceType: "module"
          },
          rules: {
            "semi": ["error", "always"],
            "no-unused-vars": "warn",
            "no-undef": "error",
            "indent": ["error", 2],
            "quotes": ["error", "single"]
          }
        }
      });

      const results = await eslint.lintFiles([this.filePath]);
      const issues = [];
      
      if (results.length > 0) {
        const result = results[0];
        result.messages.forEach(msg => {
          issues.push({
            line: msg.line,
            column: msg.column,
            message: msg.message,
            severity: msg.severity,
            ruleId: msg.ruleId
          });
        });
      }
      
      return {
        success: true,
        issues: issues,
        message: issues.length > 0 ? `Found ${issues.length} issues` : "No issues found"
      };
    } catch (error) {
      console.warn("ESLint failed, falling back to basic linting:", error.message);
      throw error; // Let the caller handle the fallback
    }
  }

  basicLint() {
    const code = fs.readFileSync(this.filePath, "utf8");
    const issues = [];
    const lines = code.split("\n");
    
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const lineNumber = index + 1;
      
      if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
        // Missing semicolons
        if (/^(let|const|var|return)\s+.*[^;{}]$/.test(trimmed)) {
          issues.push({
            line: lineNumber,
            column: line.length,
            message: "Missing semicolon",
            severity: 1,
            ruleId: "semi"
          });
        }
        
        // Console statements
        if (/console\.(log|warn|error)/.test(trimmed)) {
          issues.push({
            line: lineNumber,
            column: trimmed.indexOf("console") + 1,
            message: "Unexpected console statement",
            severity: 1,
            ruleId: "no-console"
          });
        }
      }
    });
    
    return {
      success: true,
      issues: issues,
      message: issues.length > 0 ? `Found ${issues.length} issues` : "No issues found"
    };
  }
}

module.exports = Linter;