const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const BaseFixer = require("./base-fixer");
const FormatterPaths = require("../formatter-paths");

function spawnCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { input = "", timeout = 20_000, verbose = false } = options;
    const child = spawn(command, args, { timeout });

    let stdout = "";
    let stderr = "";

    if (verbose) {
      console.log(`[Spawn] ${command} ${args.join(" ")}`);
    }

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });

    if (child.stdin) {
      child.stdin.end(input);
    }
  });
}

class PythonFixer extends BaseFixer {
  constructor(code, filePath, options = {}) {
    super(code, filePath);
    this.options = options;
    this.pythonExecutable = this._getBundledPythonPath();
    this.ollamaClient = null;
  }

  _getOllamaClient() {
    if (!this.ollamaClient) {
      const OllamaClient = require("../ai/ollama-client");
      this.ollamaClient = new OllamaClient();
    }
    return this.ollamaClient;
  }

  _getBundledPythonPath() {
    const platform = os.platform();
    const venvPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "formatters",
      "python-formatters",
      "venv"
    );

    const bundledPython =
      platform === "win32"
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python");

    if (fs.existsSync(bundledPython)) {
      return bundledPython;
    }

    return platform === "win32" ? "python" : "python3";
  }

  async analyze(options = {}) {
    const originalCode = this.code || "";
    const isRealTime = options.realTime || false;

    if (!originalCode.trim()) {
      return this._buildResult(originalCode, originalCode, {
        message: "Empty file.",
        skipAI: true
      });
    }

    try {
      const originalIsValid = await this._isValidPython(originalCode);

      if (isRealTime) {
        if (originalIsValid) {
          return this._buildResult(originalCode, originalCode, {
            message: "Valid Python, skipping real-time fix.",
            skipAI: true
          });
        }

        const quickCandidate = this._applySafeInlineFixes(originalCode);
        const quickIsValid = await this._isValidPython(quickCandidate);
        return this._buildResult(originalCode, quickIsValid ? quickCandidate : originalCode, {
          message: quickIsValid
            ? "Applied safe inline Python fixes."
            : "Could not safely repair Python in real time.",
          skipAI: !quickIsValid,
          shouldTryAI: !quickIsValid
        });
      }

      // For manual fixes: if code is valid, only format if indentation is actually wrong
      if (originalIsValid) {
        const hasIndentationIssues = this._hasIndentationIssues(originalCode);
        
        if (!hasIndentationIssues) {
          // Code is valid and properly indented - don't touch it!
          return this._buildResult(originalCode, originalCode, {
            message: "Valid Python with correct indentation, no changes needed.",
            skipAI: true
          });
        }
        
        const formatted = await this._formatValidPython(originalCode);
        return this._buildResult(originalCode, formatted, {
          message:
            formatted === originalCode
              ? "Valid Python, no changes needed."
              : "Formatted valid Python safely.",
          skipAI: true
        });
      }

      const ruleBasedCandidate = await this._repairInvalidPython(originalCode);
      const candidateIsValid = await this._isValidPython(ruleBasedCandidate);

      if (candidateIsValid) {
        const formattedCandidate = await this._formatValidPython(ruleBasedCandidate);
        return this._buildResult(originalCode, formattedCandidate, {
          message: "Repaired invalid Python with rule-based fixes.",
          skipAI: true
        });
      }

      // Try AI fixing if rule-based failed
      const aiFixed = await this._fixWithAI(originalCode);
      if (aiFixed && aiFixed !== originalCode) {
        const aiIsValid = await this._isValidPython(aiFixed);
        if (aiIsValid) {
          const formatted = await this._formatValidPython(aiFixed);
          return this._buildResult(originalCode, formatted, {
            message: "Repaired invalid Python using AI.",
            skipAI: true
          });
        }
      }

      return this._buildResult(originalCode, originalCode, {
        message: "Could not repair Python code automatically.",
        skipAI: true
      });
    } catch (error) {
      console.error(`Python Fixer Error: ${error.message}`);
      return this._buildResult(originalCode, originalCode, {
        message: `Python fixer failed: ${error.message}`,
        skipAI: false,
        shouldTryAI: true
      });
    }
  }

  _hasIndentationIssues(code) {
    const lines = code.split("\n");
    const indentStack = [0];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith("#")) continue;
      
      const leadingSpaces = line.match(/^\s*/)[0];
      const indentLevel = leadingSpaces.length;
      
      // Tabs are always wrong
      if (leadingSpaces.includes("\t")) return true;
      
      // Non-multiple of 4 is wrong
      if (indentLevel % 4 !== 0) return true;
      
      // Check if current indent matches expected context
      const currentExpected = indentStack[indentStack.length - 1];
      
      // Block-ending keywords should align with block start
      if (/^(elif|else|except|finally)\b/.test(trimmed)) {
        if (indentStack.length > 1) {
          const blockStart = indentStack[indentStack.length - 2];
          if (indentLevel !== blockStart) return true;
        }
      } else if (trimmed.endsWith(":")) {
        // New block: should be at current level, next line should indent
        if (indentLevel < currentExpected) {
          // Dedent to valid level
          while (indentStack.length > 1 && indentLevel < indentStack[indentStack.length - 1]) {
            indentStack.pop();
          }
        }
        indentStack.push(indentLevel + 4);
      } else {
        // Regular statement: should match current expected level
        if (indentLevel !== currentExpected) {
          // Check if it's a valid dedent
          let validDedent = false;
          for (let j = indentStack.length - 1; j >= 0; j--) {
            if (indentLevel === indentStack[j]) {
              validDedent = true;
              indentStack.length = j + 1;
              break;
            }
          }
          if (!validDedent) return true;
        }
      }
    }
    
    return false;
  }

  _buildResult(originalCode, fixedCode, extra = {}) {
    if (fixedCode !== originalCode) {
      this.clearFixes();
      this.addFix(0, originalCode.length, fixedCode);
    } else {
      this.clearFixes();
    }

    return {
      success: true,
      fixedCode,
      appliedFixes: fixedCode === originalCode ? 0 : 1,
      skipAI: extra.skipAI ?? fixedCode === originalCode,
      shouldTryAI: extra.shouldTryAI ?? false,
      message: extra.message || "Python analysis complete."
    };
  }

  async _isValidPython(code) {
    try {
      const result = await spawnCommand(
        this.pythonExecutable,
        ["-c", "import ast,sys; ast.parse(sys.stdin.read())"],
        {
          input: code,
          timeout: 10_000,
          verbose: this.options.verbose
        }
      );

      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async _formatValidPython(code) {
    const autopep8Path = FormatterPaths.getAutopep8Path();

    // Safety check: if autopep8 is not available, return original code unchanged
    if (!autopep8Path || !fs.existsSync(autopep8Path)) {
      if (this.options.verbose) {
        console.warn("autopep8 not found, skipping formatting");
      }
      return code;
    }

    try {
      const result = await spawnCommand(autopep8Path, ["-"], {
        input: code,
        timeout: 15_000,
        verbose: this.options.verbose
      });

      if (result.exitCode === 0 && result.stdout.trim()) {
        return result.stdout.replace(/\r\n/g, "\n").trimEnd();
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`autopep8 formatting failed: ${error.message}`);
      }
    }

    return code;
  }

  async _repairInvalidPython(code) {
    const attempts = [];
    const pushAttempt = (value) => {
      if (value && !attempts.includes(value)) {
        attempts.push(value);
      }
    };

    pushAttempt(this._applySafeInlineFixes(code));
    pushAttempt(this._convertLikelyJavaScriptArtifacts(code));
    pushAttempt(
      this._applySafeInlineFixes(this._convertLikelyJavaScriptArtifacts(code))
    );

    for (const attempt of attempts) {
      if (attempt === code) {
        continue;
      }

      if (await this._isValidPython(attempt)) {
        return attempt;
      }
    }

    return code;
  }

  _applySafeInlineFixes(code) {
    let fixed = code;
    fixed = this._fixMissingColons(fixed);
    fixed = this._fixLegacyPrintStatements(fixed);
    fixed = this._fixLiteralValues(fixed);
    fixed = this._normalizeElseLikeBlocks(fixed);
    return fixed;
  }

  _fixMissingColons(code) {
    return code
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          return line;
        }

        if (
          /^(if|elif|else|def|class|for|while|try|except|finally|with)\b/.test(
            trimmed
          ) &&
          !trimmed.endsWith(":") &&
          !trimmed.includes("#")
        ) {
          return `${line}:`;
        }

        return line;
      })
      .join("\n");
  }

  _fixLegacyPrintStatements(code) {
    return code.replace(/^(\s*)print\s+([^(\n].*)$/gm, "$1print($2)");
  }

  _fixLiteralValues(code) {
    return code
      .replace(/\btrue\b/g, "True")
      .replace(/\bfalse\b/g, "False")
      .replace(/\bnull\b/g, "None")
      .replace(/\bundefined\b/g, "None");
  }

  _normalizeElseLikeBlocks(code) {
    return code
      .replace(/^(\s*)else\s*\{\s*$/gm, "$1else:")
      .replace(/^(\s*)finally\s*\{\s*$/gm, "$1finally:")
      .replace(/^(\s*)catch\s*\(([^)]*)\)\s*\{\s*$/gm, "$1except $2:")
      .replace(/^(\s*)}\s*$/gm, "");
  }

  _convertLikelyJavaScriptArtifacts(code) {
    const lines = code.split("\n");
    const converted = [];

    for (const line of lines) {
      let current = line;
      const trimmed = current.trim();

      if (!trimmed) {
        converted.push(current);
        continue;
      }

      current = current.replace(/^(\s*)(var|let|const)\s+/g, "$1");
      current = current.replace(/^(\s*)function\s+([A-Za-z_]\w*)\s*\(/g, "$1def $2(");
      current = current.replace(/===/g, "==").replace(/!==/g, "!=");
      current = current.replace(/\bnew\s+/g, "");

      if (/=>/.test(current) && !/lambda/.test(current)) {
        converted.push(line);
        continue;
      }

      if (trimmed.endsWith("{")) {
        current = current.replace(/\s*\{\s*$/, ":");
      }

      if (trimmed === "}" || trimmed === "};") {
        continue;
      }

      converted.push(current);
    }

    return converted.join("\n");
  }

  async _fixWithAI(code) {
    if (!this.options.ai) {
      return null;
    }

    try {
      const client = this._getOllamaClient();
      const isAvailable = await client.isAvailable();
      
      if (this.options.verbose) {
        console.log(`AI availability check: ${isAvailable}`);
      }
      
      if (!isAvailable) {
        if (this.options.verbose) {
          console.log("AI not available for Python fixing");
        }
        return null;
      }

      if (this.options.verbose) {
        console.log("Using AI to fix Python code...");
        console.log("Code to fix:", code.slice(0, 200));
      }

      const force = !(await this._passesExternalSyntaxCheck(code));
      const aiResult = await client.validateAndFix(code, code, "python", { force });
      
      if (this.options.verbose) {
        console.log("AI result:", {
          shouldUseAI: aiResult.shouldUseAI,
          reason: aiResult.reason,
          hasFixedCode: !!aiResult.fixedCode,
          fixedCodeLength: aiResult.fixedCode?.length || 0
        });
      }
      
      if (aiResult && aiResult.shouldUseAI && aiResult.fixedCode) {
        if (this.options.verbose) {
          console.log(`AI fix reason: ${aiResult.reason}`);
          console.log("Fixed code:", aiResult.fixedCode.slice(0, 200));
        }
        return aiResult.fixedCode;
      }

      return null;
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`AI fixing failed: ${error.message}`);
        console.warn("Error stack:", error.stack);
      }
      return null;
    }
  }

  async _passesExternalSyntaxCheck(code) {
    const tmpDir = os.tmpdir();
    const tmpName = `code-janitor-${Date.now()}-${Math.random().toString(16).slice(2)}.py`;
    const tmpPath = path.join(tmpDir, tmpName);

    try {
      fs.writeFileSync(tmpPath, code, "utf8");
      const result = await spawnCommand(
        this.pythonExecutable,
        ["-m", "py_compile", tmpPath],
        { timeout: 10_000, verbose: this.options.verbose }
      );
      return result.exitCode === 0;
    } catch {
      return false;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  getFixedCode() {
    return this.applyFixes();
  }
}

module.exports = PythonFixer;
