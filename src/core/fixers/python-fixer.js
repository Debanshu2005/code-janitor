const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const BaseFixer = require("./base-fixer");

class PythonFixer extends BaseFixer {
  async analyze() {
    console.log("Analyzing Python file:", this.filePath);

    // Step 1: Apply manual critical fixes
    await this._fixCriticalSyntaxErrors();

    // Step 2: Use Black for proper formatting & indentation
    await this._formatWithBlack();
  }

  // ----------------- Manual fixes -----------------
  async _fixCriticalSyntaxErrors() {
    let code = this.code;

    // Fix multiple statements on same line
    code = this._fixMultipleStatementsOnSameLine(code);
    code = this._fixMissingColons(code);
    code = this._fixCriticalTypos(code);
    code = this._fixMixedTabsSpaces(code);
    code = this._fixPrintStatements(code);

    if (code !== this.code) {
      console.log("✅ Applied manual syntax fixes");
      this.addFix(0, this.code.length, code);
    }
  }

  _fixMultipleStatementsOnSameLine(code) {
    return code.replace(/(print\([^)]*\))\s+(print\([^)]*\))/g, "$1\n$2");
  }

  _fixCriticalTypos(code) {
    const typos = {
      prinnt: "print",
      imprt: "import",
      improt: "import",
      frmo: "from",
      retrun: "return",
      whiel: "while",
      calss: "class",
      excpet: "except",
      fianlly: "finally",
      Flase: "False",
      "Non e": "None",
      Ture: "True",
      defn: "def",
      retun: "return",
      imort: "import",
    };

    let fixed = code;
    for (const [typo, correct] of Object.entries(typos)) {
      fixed = fixed.replace(new RegExp(`\\b${typo}\\b`, "g"), correct);
    }
    return fixed;
  }

  _fixMixedTabsSpaces(code) {
    return code.replace(/\t/g, "    ");
  }

  _fixPrintStatements(code) {
    // Fix Python 2 style print statements
    return code.replace(
      /^(\s*)print\s+([^()\n]+)$/gm,
      (match, ws, content) => `${ws}print(${content.trim()})`,
    );
  }

  _fixMissingColons(code) {
    const patterns = [
      /\b(def\s+\w+\s*\([^)]*\))\s*$/gm,
      /\b(class\s+\w+)\s*$/gm,
      /\b(if\s+[^:\n]+)\s*$/gm,
      /\b(elif\s+[^:\n]+)\s*$/gm,
      /\b(else)\s*$/gm,
      /\b(for\s+[^:\n]+)\s*$/gm,
      /\b(while\s+[^:\n]+)\s*$/gm,
      /\b(try)\s*$/gm,
      /\b(except\s+[^:\n]*)\s*$/gm,
      /\b(finally)\s*$/gm,
      /\b(with\s+[^:\n]+)\s*$/gm,
      /\b(if\s+__name__\s*==\s*["']__main__["'])\s*$/gm,
    ];

    let fixed = code;
    for (const pattern of patterns) {
      fixed = fixed.replace(pattern, (match, g1) =>
        g1 && !g1.trim().endsWith(":") ? g1.trim() + ":" : match,
      );
    }
    return fixed;
  }

  // ----------------- Black formatting -----------------
  // Add this method to your PythonFixer class
  async testBlack() {
    console.log("🔧 Testing Black installation...");

    const testCommands = [
      { name: "black --version", cmd: "black", args: ["--version"] },
      {
        name: "python -m black --version",
        cmd: "python",
        args: ["-m", "black", "--version"],
      },
      { name: "black --help", cmd: "black", args: ["--help"] },
    ];

    for (const { name, cmd, args } of testCommands) {
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn(cmd, args, { shell: true });

          let output = "";
          proc.stdout.on("data", (data) => (output += data.toString()));
          proc.stderr.on("data", (data) => (output += data.toString()));

          proc.on("close", (code) => {
            if (code === 0) {
              console.log(`✅ ${name}: ${output.trim()}`);
              resolve();
            } else {
              reject(new Error(`Exit code ${code}: ${output}`));
            }
          });

          proc.on("error", reject);
        });
      } catch (error) {
        console.log(`❌ ${name} failed: ${error.message}`);
      }
    }
  }
  // ----------------- Black formatting -----------------
  async _formatWithBlack() {
    const currentCode = this.fixes.length > 0 ? this.applyFixes() : this.code;

    console.log("🔍 Current code before Black:");
    console.log(currentCode);
    console.log("---");

    const tempFile = path.join(
      __dirname,
      `temp_python_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.py`,
    );

    try {
      await fs.writeFile(tempFile, currentCode);
      console.log("📝 Temporary file created:", tempFile);

      const formattedCode = await this._tryBlackCommands(tempFile);

      if (formattedCode && formattedCode !== currentCode) {
        console.log("✅ Black formatting successful!");
        console.log("📝 Formatted code:");
        console.log(formattedCode);
        console.log("---");

        // CLEAR any existing fixes and add the Black-formatted code
        this.fixes = []; // Clear previous fixes
        this.addFix(0, currentCode.length, formattedCode);
      } else if (formattedCode) {
        console.log("ℹ️ Black: Code was already properly formatted");
      } else {
        console.warn(
          "⚠️ Black formatting failed, using enhanced fallback formatting",
        );
        this._applyEnhancedFallbackFormatting(currentCode);
      }
    } catch (error) {
      console.warn("❌ Black formatting error:", error.message);
      this._applyEnhancedFallbackFormatting(currentCode);
    } finally {
      await this._cleanupTempFile(tempFile);
    }
  }
  async _tryBlackCommands(tempFile) {
    const commands = [
      { name: "black direct", cmd: "black", args: ["--quiet", tempFile] },
      {
        name: "python -m black",
        cmd: "python",
        args: ["-m", "black", "--quiet", tempFile],
      },
      {
        name: "py -m black",
        cmd: "py",
        args: ["-m", "black", "--quiet", tempFile],
      },
    ];

    for (const { name, cmd, args } of commands) {
      try {
        console.log(`🔄 Trying: ${name} (${cmd} ${args.join(" ")})`);
        const result = await this._spawnCommand(cmd, args, tempFile);

        if (result) {
          const fileContent = await fs.readFile(tempFile, "utf8");
          console.log(`✅ Success with ${name}!`);
          return fileContent;
        }
      } catch (error) {
        console.log(`❌ ${name} failed:`, error.message);
      }
    }

    return null;
  }

  _spawnCommand(cmd, args, tempFile) {
    return new Promise((resolve, reject) => {
      console.log(`🚀 Executing: ${cmd} ${args.join(" ")}`);

      const proc = spawn(cmd, args, {
        stdio: ["pipe", "pipe", "pipe"], // Capture all stdio
        shell: true,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
        console.log(`Black stdout: ${data.toString().trim()}`);
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
        console.log(`Black stderr: ${data.toString().trim()}`);
      });

      proc.on("close", (code) => {
        console.log(`Black process exited with code: ${code}`);

        if (code === 0) {
          resolve(true);
        } else {
          // Provide more detailed error information
          const errorMsg =
            stderr || stdout || `Process exited with code ${code}`;
          console.log(`❌ Black failed with: ${errorMsg}`);
          reject(new Error(`Exit code ${code}: ${errorMsg}`));
        }
      });

      proc.on("error", (err) => {
        console.log(`❌ Spawn error for ${cmd}:`, err.message);
        reject(err);
      });

      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error("Black process timeout"));
      }, 10000); // 10 second timeout

      proc.on("close", () => clearTimeout(timeout));
    });
  }
  _applyEnhancedFallbackFormatting(currentCode) {
    console.log("🛠️ Applying enhanced fallback formatting...");

    let fixedCode = currentCode;

    // Fix multiple statements on same line
    fixedCode = fixedCode.replace(
      /(print\([^)]*\))\s+(print\([^)]*\))/g,
      "$1\n$2",
    );

    // Standardize indentation
    const lines = fixedCode.split("\n");
    const formattedLines = lines.map((line) => {
      const indentMatch = line.match(/^(\s*)/);
      const content = line.trimStart();
      const currentIndent = indentMatch ? indentMatch[1].length : 0;

      // Convert to standard 4-space indentation
      const indentLevel = Math.max(0, Math.round(currentIndent / 4));
      return " ".repeat(indentLevel * 4) + content;
    });

    fixedCode = formattedLines.join("\n");

    // Ensure proper blank lines
    fixedCode = fixedCode.replace(/\n{3,}/g, "\n\n");

    if (fixedCode !== currentCode) {
      this.addFix(0, currentCode.length, fixedCode);
      console.log("✅ Applied enhanced fallback formatting");
    }
  }

  async _cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
      console.log("🧹 Cleaned up temp file");
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  getFixedCode() {
    return this.applyFixes();
  }
}

module.exports = PythonFixer;
