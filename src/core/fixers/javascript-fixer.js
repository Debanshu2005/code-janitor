const fs = require("fs").promises;
const path = require("path");
// Babel dependencies with fallback
let parser, traverse, generate, t;
try {
  parser = require("@babel/parser");
  traverse = require("@babel/traverse").default;
  generate = require("@babel/generator").default;
  t = require("@babel/types");
} catch (error) {
  console.warn('Babel dependencies not found, AST transformations will be disabled:', error.message);
  parser = traverse = generate = t = null;
}

// ESLint with fallback
let ESLint;
try {
  ESLint = require('eslint').ESLint;
} catch (error) {
  console.warn('ESLint not available, skipping ESLint fixes:', error.message);
  ESLint = null;
}
const FormatterPaths = require('../formatter-paths');

// Use FormatterPaths to get prettier module
let prettier;
try {
  const prettierPath = FormatterPaths.getPrettierModule();
  if (prettierPath) {
    prettier = require(prettierPath);
  } else {
    prettier = null;
  }
} catch (error) {
  console.warn('Prettier not found, JavaScript formatting will be limited:', error.message);
  prettier = null;
}
const BaseFixer = require("./base-fixer");

    /**;
    * JavaScriptFixer attempts to format and fix common JavaScript syntax errors;
 * using a multi-strategy approach: Preprocessing, Babel AST transformation, and Prettier.
 */
class JavaScriptFixer extends BaseFixer {
  /**
   * Analyzes the code using a robust pipeline: Typos -> Preprocessing -> 
   * AST (Structure) -> ESLint -> Prettier (Style).
   */
  async analyze() {
    console.log("Analyzing JavaScript file:", this.filePath);

    try {
      let finalCode = this.code;

      // Step 1: Fix common typos
      finalCode = this._fixCommonTypos(finalCode);

      // Step 2: Basic syntax repairs
      finalCode = this._repairParserBreakingSyntax(finalCode);

      // Step 3: Use Prettier for formatting but preserve semicolon style
      try {
        const prettierResult = await this._runPrettier(finalCode);
        finalCode = prettierResult;
      } catch (error) {
        console.warn(`Prettier failed: ${error.message}. Skipping formatting.`);
      }

      if (finalCode.trim() !== this.code.trim()) {
        this.addFix(0, this.code.length, finalCode);
      }
    } catch (error) {
      console.error(`Error during JavaScript analysis: ${error.message}`);
    }
  }

  /**
   * Fixes common JavaScript keyword typos using simple regex replacements.
   */
  _fixCommonTypos(code) {
    if (!code || code.trim() === "") {
      return code;
    }

    let processed = code;

    // Map of common typo replacements {typo: correct}
    const typoMap = {
      "fucntion": "function",
      "retrun": "return",
      "consol": "console",
      "lenght": "length",
      "widht": "width",
      "heigth": "height",
      "defualt": "default",
      "whiel": "while",
      "swtich": "switch",
      "improt": "import",
      "exprot": "export",
      "cosnt": "const",
      "calss": "class",
      "esle": "else",
      "ture": "true",
      "flase": "false"
    };

    for (const typo in typoMap) {
      // Use word boundaries (\b) to ensure we only replace the whole word typo
      const regex = new RegExp(`\\b${typo}\\b`, "g");
      processed = processed.replace(regex, typoMap[typo]);
    }

    return processed;
  }

  /**
   * Runs ESLint's auto-fix feature on the code.
   */
  async _runESLintFix(code) {
    if (!ESLint) {
    console.warn('ESLint not available, skipping ESLint fixes');
      return code;
    }
    
    try {
      // Initialize ESLint with a baseConfig
      const eslint = new ESLint({
        fix: true,
        useEslintrc: true,
        cwd: path.dirname(this.filePath),
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
            semi: ["error", "always"],
            indent: ["error", 2, { SwitchCase: 1 }],
            "no-unused-vars": "warn",
            "no-undef": "error"
          }
        }
      });

      const results = await eslint.lintText(code, { filePath: this.filePath });

      if (results.length > 0 && results[0].output) {
        return results[0].output;
      }

      return code;
    } catch (error) {
      console.warn(
        `ESLint fix failed, returning original code: ${error.message}`
      );
      return code;
    }
  }

  /**
   * Applies minimal, low-risk syntax fixes and removes unwanted semicolons.
   */
  _repairParserBreakingSyntax(code) {
    if (!code || code.trim() === "") {
      return code;
    }
    
    let processed = code;

    // Fix arrow functions with space between = and >
    processed = processed.replace(/=\s*>/g, "=>");
    processed = processed.replace(/\+\s*\+\s*/g, "++");

    // Remove only problematic semicolons that break syntax
    processed = processed.replace(/,\s*;/g, ","); // Remove semicolons after commas
    processed = processed.replace(/\(\s*;/g, "("); // Remove semicolons after opening parentheses
    processed = processed.replace(/;(\s*[\)\}])/g, "$1"); // Remove semicolons before closing brackets
    
    // ONLY remove trailing commas that are clearly syntax errors
    // Don't remove commas between valid array/object elements
    processed = processed.replace(/,\s*([\)\}\]])(?!\s*[,:])/g, "$1"); // Trailing comma before closing bracket
    processed = processed.replace(/\{\s*,/g, "{"); // Comma right after opening brace
    processed = processed.replace(/\[\s*,/g, "["); // Comma right after opening bracket

    return processed;
  }

  /**
   * Uses the Babel AST to perform structural code transformations.
   */
  async _robustParseWithAST(code) {
    if (!parser || !traverse || !generate || !t) {
      console.warn('Babel dependencies not available, skipping AST transformations');
      return null;
    }
    
    try {
      const ast = parser.parse(code, {
        sourceType: "unambiguous",
        plugins: ["jsx", "typescript"],
        errorRecovery: true
      });

      // Transform the AST to fix structural issues
      traverse(ast, {
        // Convert var to const or let based on usage
        VariableDeclaration(path) {
          if (path.node.kind === "var") {
            let allCanBeConst = true;
            for (const decl of path.node.declarations) {
              const binding = path.scope.getBinding(decl.id.name);

              // 1. Must have an initializer to be const
              if (!decl.init) {
                allCanBeConst = false;
                break;
              }

              // 2. If the binding exists and has constant violations (reassignments), it must be 'let'
              if (binding && binding.constantViolations.length > 0) {
                allCanBeConst = false;
                break;
              }
            }
            // Use const if no violations found, otherwise use let
            path.node.kind = allCanBeConst ? "const" : "let";
          }
        },

        // Add block statements for control structures missing braces
        "IfStatement|ForStatement|WhileStatement|DoWhileStatement|ForInStatement|ForOfStatement"(
          path
        ) {
          const node = path.node;

          const wrapStatementInBlock = (statement, isAlternate = false) => {
            if (
              t.isBlockStatement(statement) ||
              t.isEmptyStatement(statement)
            ) {
              return statement;
            }
            if (t.isIfStatement(statement) && isAlternate) {
              // Allows for 'else if (...)' structure
              return statement;
            }
            return t.blockStatement([statement]);
          };

          if (t.isIfStatement(node)) {
            node.consequent = wrapStatementInBlock(node.consequent, false);
            if (node.alternate) {
              node.alternate = wrapStatementInBlock(node.alternate, true);
            }
          } else {
            if (node.body) {
              node.body = wrapStatementInBlock(node.body, false);
            }
          }
        }
      });

      // Generate code from the fixed AST
      const output = generate(ast, {
        retainLines: true,
        concise: false,
        comments: true,
        compact: false,
        semicolons: true
      });

      return output.code;
    } catch (error) {
      console.warn("AST parsing failed:", error.message);
      return null;
    }
  }

  /**
   * Uses the direct Prettier Node.js API to format the code in-memory.
   */
  async _runPrettier(code) {
    if (!prettier) {
      console.warn('Prettier not available, skipping formatting');
      return code;
    }

    const parserName =
      this.filePath.endsWith(".ts") || this.filePath.endsWith(".tsx")
        ? "typescript"
        : "babel";

    const config = (await prettier.resolveConfig(this.filePath)) || {};

    try {
      const formattedCode = prettier.format(code, {
        ...config,
        filepath: this.filePath,
        parser: config.parser || parserName,
        semi: true, // Enable semicolons
        trailingComma: "none",
        printWidth: 80
      });
      return formattedCode;
    } catch (error) {
      throw new Error(error.message);
    }
  }

  getFixedCode() {
    return this.applyFixes();
  }
}

module.exports = JavaScriptFixer;