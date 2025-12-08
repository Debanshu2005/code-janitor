const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const BaseFixer = require("./base-fixer");

class PythonFixer extends BaseFixer {
  /**
   * Main analysis pipeline for Python code.
   */
  async analyze() {
    console.log("Analyzing Python, file:", this.filePath);

    // Efficiently get the current state and track it internally
    let currentCode = this.code;
    const updateCode = (newCode) => {
      if (newCode !== currentCode) {
        this.fixes = [];
        this.addFix(0, this.code.length, newCode);
        currentCode = newCode;
        return true;
      }
      return false;
    };

    // Step 1: Preliminary cleanup
    currentCode = this._prePrettierCleanup(currentCode);

    // Step 2: Fix critical syntax errors(This, is, an, async, block, of, manual, fixes)
    await this._fixCriticalSyntaxErrors();
    currentCode = this.applyFixes(); // Must apply fixes after the async call

    // Step 3: Apply missing colons fix
    const codeWithColons = this._fixMissingColons(currentCode);
    updateCode(codeWithColons);

    // Step 4: Sanitize lines (removes JS keywords, fixes operators, etc.)
    const codeSanitized = this._preSanitizeLines(currentCode);
    updateCode(codeSanitized);

    // Step 5: Repair indentation (basic block-aware cleanup for Black to parse)
    const codeIndented = this._preRepairIndentation(currentCode);
    updateCode(codeIndented);

    // Step 6: Final formatting with Black
    await this._formatWithBlack();

    console.log("✅ Python analysis complete, for:", this.filePath);
  }

  // ----------------- Manual fixes -----------------

  async _fixCriticalSyntaxErrors() {
    let code = this.fixes.length > 0 ? this.applyFixes() : this.code;

    // Fixes applied sequentially to the current code state
    code = this._fixMultipleStatementsOnSameLine(code);
    code = this._fixCriticalTypos(code);
    code = this._fixMixedTabsSpaces(code);
    code = this._fixPrintStatements(code);
    code = this._fixJsToPythonKeywords(code);

    if (code !== (this.fixes.length > 0 ? this.applyFixes() : this.code)) {
      console.log("✅ Applied manual syntax fixes");
      this.fixes = [];
      this.addFix(0, this.code.length, code);
    }
  }

  _preSanitizeLines(code) {
    let lines = code.split("\n");
    const cleaned = [];
    let lastAssignedVar = null;
    let didInjectPlaceholder = false;
    const placeholderVar = "__fixer_temp_val";

    console.log("🔍 Before, sanitization:");

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let trimmed = line.trim();

      if (!trimmed) {
        cleaned.push("");
        continue;
      }

      const originalTrimmed = trimmed;

      // Track variable assignments for context
      const assignmentMatch = trimmed.match(
        /^([A-Za-z_][\w]*)\s*(\+\=|\-\=|\*\=|\/\=|\%\=|\=)/
      );
      if (assignmentMatch) {
        lastAssignedVar = assignmentMatch[1];
      }

      // Fix broken compound operators (a + = 1 -> a += 1)
      const brokenCompoundMatch = trimmed.match(
        /^([A-Za-z_][\w]*)\s*(\+|\-|\*|\/|\%)\s*\=\s*(\S.*)$/
      );
      if (brokenCompoundMatch) {
        const [_, variable, op, value] = brokenCompoundMatch;
        trimmed = `${variable} ${op}= ${value}`;
        console.log(
          `🛠️ Fixed broken compound, operator: "${originalTrimmed}" -> "${trimmed}"`
        );
      }

      // Lone operator (+= 5 -> __fixer_temp_val += 5)
      const loneOpMatch = trimmed.match(
        /^(\+\=|\-\=|\*\=|\/\=|\%\=)\s*(\S.*)$/
      );
      if (loneOpMatch) {
        const [, op, value] = loneOpMatch;
        trimmed = `${placeholderVar} ${op} ${value.split("#")[0].trim()}`;
        didInjectPlaceholder = true;
        lastAssignedVar = placeholderVar;
        console.log(
          `⚠️ Using placeholder for lone, operator: "${originalTrimmed}" -> "${trimmed}"`
        );
      }

      // Fix print statements (Python 2 -> 3) - kept here for full sanitization
      const printMatch = trimmed.match(/^print\s+(.+)$/);
      if (printMatch && !trimmed.startsWith("print(")) {
        let content = printMatch[1].trim();
        let comment = "";
        const ci = content.indexOf("#");
        if (ci !== -1) {
          comment = content.slice(ci);
          content = content.slice(0, ci).trim();
        }
        content = content.replace(/,\s*$/, "");
        const args = content.split(/\s*,\s*/).join(", ");
        trimmed = `print(${args})${comment ? " " + comment : ""}`;
        console.log(
          `🛠️ Fixed print, statement: "${originalTrimmed}" -> "${trimmed}"`
        );
      }

      // Remove JS keywords
      if (/(^|\s)(var|let|const)\s+/.test(trimmed)) {
        const original = trimmed;
        trimmed = trimmed.replace(/(^|\s)(var|let|const)\s+/, "$1");
        console.log(`🛠️ Removed JS, keyword: "${original}" -> "${trimmed}"`);
      }

      // Remove invalid characters
      const cleanTrimmed = trimmed.replace(/[^\x20-\x7E\t]/g, "");
      if (cleanTrimmed !== trimmed) {
        trimmed = cleanTrimmed;
      }

      // Normalize spaces
      trimmed = trimmed.replace(/\s+/g, " ").trim();

      // Preserve existing leading whitespace for _preRepairIndentation to fix
      const leadingWhitespace = line.match(/^(\s*)/)[1];
      line = leadingWhitespace + trimmed;

      cleaned.push(line);
    }

    // Inject placeholder initialization if needed(no, blank, line, above, it)
    if (didInjectPlaceholder) {
      // Remove leading blank lines if present to place the initialization at the top
      while (cleaned[0] && cleaned[0].trim() === "") {
        cleaned.shift();
      }
      cleaned.unshift(`${placeholderVar} = 0`);

      // FIX for blank line after placeholder injection
      if (cleaned.length > 1 && cleaned[1].trim() === "") {
        cleaned.splice(1, 1);
      }

      console.log(
        `🛠️ Injected placeholder, initialization: ${placeholderVar} = 0`
      );
    }

    // Collapse excessive blank lines
    const cleanedCode = cleaned.join("\n").replace(/\n{3}/g, "\n\n").trimEnd();

    if (cleanedCode !== code) {
      console.log("🧹 Sanitized lines");
      return cleanedCode;
    }
    return code;
  }
  // ... (omitting remaining helper functions for brevity as they are unchanged)

  _fixJsToPythonKeywords(code) {
    let fixed = code;
    // Add colon to function definitions, replace 'function' with 'def'
    fixed = fixed.replace(
      /^\s*function\s+(\w+)\s*\(([^)]*)\)\s*/gm,
      (m, name, args) => {
        // ensure we add a trailing colon and newline separation if missing
        return `def ${name}(${args}):`;
      }
    );
    // Replace console.log with print
    fixed = fixed.replace(/(\s*)console\.log\s*\(([^)]*)\)\s*/g, "$1print($2)");
    return fixed;
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
      imort: "import"
    };

    let fixed = code;
    for (const [typo, correct] of Object.entries(typos)) {
      fixed = fixed.replace(new RegExp(`\\b${typo}\\b`, "g"), correct);
    }
    return fixed;
  }

  _fixMixedTabsSpaces(code) {
    return code.replace(/\t/g, "    ");
  }

  _fixPrintStatements(code) {
    return code.replace(/^\s*print\s+(.+)$/gm, (match, content) => {
      // Get leading whitespace to preserve it
      const leadingWs = match.match(/^(\s*)/)[1];
      content = content.trim();

      // if content is already parenthesized, leave it as-is
      if (/^\(.+\)$/g.test(content)) {
        // return the original match to preserve leading whitespace
        return match;
      }

      let comment = "";
      const commentIndex = content.indexOf("#");
      if (commentIndex !== -1) {
        comment = content.slice(commentIndex);
        content = content.slice(0, commentIndex).trim();
      }

      content = content.replace(/,\s*$/, "").trim();

      const args = content
        .split(/\s*,\s*/)
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0)
        .join(", ");

      const fixed = `print(${args})`;
      return leadingWs + (comment ? `${fixed} ${comment}` : fixed);
    });
  }

  _preRepairIndentation(code) {
    const lines = code.split("\n");
    const repaired = [];
    const INDENT_SIZE = 4;

    let indentLevel = 0; // expected indent level for the *next* line's content
    let prevLineBlockStarter = false; // Tracks if previous line was a block opener (:)

    console.log("🛠️ Starting Indentation Pre-Repair...");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        repaired.push("");
        // Maintain block starter state over blank lines
        continue;
      }

      const currentIndent = line.length - line.trimStart().length;
      let expectedLevel = indentLevel; // Start with the expected level

      const isDedentToken =
        trimmed.endsWith(":") &&
        /^(elif |else:|except |finally:)/.test(trimmed);
      const isBlockStarter =
        trimmed.endsWith(":") &&
        /^(def |class |if |for |while |try:|with |async )/.test(trimmed);
      const isImport = /^(import |from )/.test(trimmed);
      const isNewMajorBlock = /^(if |for |while |with |def |class )/.test(
        trimmed
      );

      // 🛑 FIX: Aggressive Scope Exit Reset
      // If a major block starts and it's not following a block opener, assume the previous scope ended.
      if (isNewMajorBlock && indentLevel > 0 && !prevLineBlockStarter) {
        console.log(
          `⚠️ Forcing scope exit before new block, starter: "${trimmed}"`
        );
        expectedLevel = 1; // It's inside a def/class, so it should be level 1, not 0
        indentLevel = 1;
      }
      // Re-set expectedLevel to 0 if it's an import at a non-zero indent level
      if (isImport && currentIndent >= INDENT_SIZE) {
        expectedLevel = 0;
      }

      // --- 1. Determine the correct expectedLevel for the CURRENT line's content ---
      if (isDedentToken) {
        // Dedent tokens (elif, else, etc.) should be one level back
        expectedLevel = Math.max(indentLevel - 1, 0);
      } else if (isImport) {
        // Imports should always be at the top level
        expectedLevel = 0;
      }
      // HEURISTIC: If we are currently in a block AND the current line is physically unindented(0, spaces)
      // AND the previous line was NOT a block opener, we assume scope exit.
      else if (
        indentLevel > 0 &&
        currentIndent === 0 &&
        !prevLineBlockStarter
      ) {
        expectedLevel = 0;
      }

      // Safety reset for major block starters (def/class) if they are unindented
      if (
        (trimmed.startsWith("def ") || trimmed.startsWith("class ")) &&
        currentIndent < INDENT_SIZE
      ) {
        expectedLevel = 0;
      }

      const expectedSpaces = expectedLevel * INDENT_SIZE;

      // --- 2. Apply, fix: Force indentation if it doesn't match expected level ---
      // We are, aggressive: If expectedLevel > 0 OR if the physical indent is significantly off, we force it.
      const shouldForceFix =
        expectedLevel > 0 || Math.abs(currentIndent - expectedSpaces) > 2;

      if (shouldForceFix) {
        repaired.push(" ".repeat(expectedSpaces) + trimmed);
        console.log(
          `🛠️ Fixed, indentation: ${currentIndent} -> ${expectedSpaces} spaces, for: "${trimmed}"`
        );
      } else {
        // If expected level is 0 and current is 0(or, close), just push trimmed
        repaired.push(line.substring(0, currentIndent) + trimmed);
      }

      // --- 3. Update indentLevel for the *next* line and set block starter flag ---
      prevLineBlockStarter = isBlockStarter || isDedentToken;

      if (prevLineBlockStarter) {
        // If this line started a block or is a dedent token, the next line's content is one level deeper
        indentLevel = expectedLevel + 1;
      } else if (expectedLevel === 0) {
        // If we just processed a level 0 statement, the next line should be reset to 0.
        indentLevel = 0;
      }
      // Otherwise (regular statement inside an existing block, expectedLevel > 0), indentLevel is maintained.
    }

    const repairedCode = repaired.join("\n");
    if (repairedCode !== code) {
      console.log("🛠️ Indentation pre-repair applied to make code parsable");
      return repairedCode;
    }
    return code;
  }

  _prePrettierCleanup(code) {
    const lines = code.split("\n");
    const cleanedLines = [];

    for (let line of lines) {
      line = line.replace(/\s+$/g, "");
      line = line.replace(/[^\x20-\x7E\t]+$/g, "");
      cleanedLines.push(line);
    }

    let prevBlank = false;
    const finalLines = [];
    for (const line of cleanedLines) {
      if (line.trim() === "") {
        if (!prevBlank) {
          finalLines.push("");
        }
        prevBlank = true;
      } else {
        finalLines.push(line);
        prevBlank = false;
      }
    }

    const cleanedCode = finalLines.join("\n").trimEnd();
    if (cleanedCode !== code) {
      console.log("✨ Pre-prettier cleanup applied");
      return cleanedCode;
    }
    return code;
  }
  // ... (omitting remaining methods for brevity as they are unchanged)

  _fixMissingColons(code) {
    const patterns = [
      {
        pattern: /\b(def\s+\w+\s*\([^)]*\))\s*$/gm,
        description: "function definition"
      },
      { pattern: /\b(class\s+\w+)\s*$/gm, description: "class definition" },
      { pattern: /\b(if\s+[^:\n]+)\s*$/gm, description: "if statement" },
      { pattern: /\b(elif\s+[^:\n]+)\s*$/gm, description: "elif statement" },
      { pattern: /^(\s*else)\s*$/gm, description: "else statement" },
      { pattern: /\b(for\s+[^:\n]+)\s*$/gm, description: "for loop" },
      { pattern: /\b(while\s+[^:\n]+)\s*$/gm, description: "while loop" },
      { pattern: /^(\s*try)\s*$/gm, description: "try block" },
      { pattern: /\b(except\s+[^:\n]*)\s*$/gm, description: "except block" },
      { pattern: /^(\s*finally)\s*$/gm, description: "finally block" },
      { pattern: /\b(with\s+[^:\n]+)\s*$/gm, description: "with statement" },
      {
        pattern: /\b(if\s+__name__\s*==\s*["']__main__["'])\s*$/gm,
        description: "main guard"
      },
      {
        pattern: /\b(async\s+def\s+\w+\s*\([^)]*\))\s*$/gm,
        description: "async function"
      },
      {
        pattern: /\b(async\s+for\s+[^:\n]+)\s*$/gm,
        description: "async for loop"
      },
      {
        pattern: /\b(async\s+with\s+[^:\n]+)\s*$/gm,
        description: "async with statement"
      }
    ];

    let fixed = code;
    const changes = [];

    for (const { pattern, description } of patterns) {
      fixed = fixed.replace(pattern, (match, g1) => {
        if (g1 && !g1.trim().endsWith(":")) {
          const original = match.trim();
          const corrected = g1.trim() + ":";
          changes.push(`${description}: "${original}" -> "${corrected}"`);
          const ws = match.match(/^(\s*)/)[1];
          return ws + corrected;
        }
        return match;
      });
    }

    if (changes.length > 0) {
      console.log("🔧 Fixed missing, colons:");
      changes.forEach((change) => console.log(`  ✅ ${change}`));
    }

    return fixed;
  }

  async _formatWithBlack() {
    const currentCode = this.fixes.length > 0 ? this.applyFixes() : this.code;

    console.log("🔍 Current code before, Black:");
    console.log(currentCode);
    console.log("---");

    const tempFile = path.join(
      __dirname,
      `temp_python_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.py`
    );

    try {
      // ensure utf8 write so Black won't choke on encoding
      await fs.writeFile(tempFile, currentCode, "utf8");
      console.log("📝 Temporary file, created:", tempFile);

      const formattedCode = await this._tryBlackCommands(tempFile);

      if (formattedCode && formattedCode !== currentCode) {
        console.log("✅ Black formatting successful!");
        this.fixes = [];
        this.addFix(0, this.code.length, formattedCode);
      } else if (formattedCode) {
        console.log("ℹ️ Black: Code was already properly formatted");
      } else {
        console.warn(
          "⚠️ Black formatting failed, using enhanced fallback formatting"
        );
        this._applyEnhancedFallbackFormatting(currentCode);
      }
    } catch (error) {
      console.warn(
        "❌ Black formatting, error:",
        error && error.message ? error.message : error
      );
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
        args: ["-m", "black", "--quiet", tempFile]
      },
      {
        name: "py -m black",
        cmd: "py",
        args: ["-m", "black", "--quiet", tempFile]
      }
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
        console.log(
          `❌ ${name} failed:`,
          error && error.message ? error.message : error
        );
      }
    }

    return null;
  }

  _spawnCommand(cmd, args, tempFile) {
    return new Promise((resolve, reject) => {
      console.log(`🚀 Executing: ${cmd} ${args.join(" ")}`);

      const proc = spawn(cmd, args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      let finished = false;

      proc.on("close", (code) => {
        if (finished) {
          return;
        }
        finished = true;
        console.log(`Black process exited with, code: ${code}`);

        if (code === 0) {
          resolve(true);
        } else {
          const errorMsg =
            stderr || stdout || `Process exited with code ${code}`;
          console.log(`❌ Black failed, with: ${errorMsg}`);
          reject(new Error(`Exit code ${code}: ${errorMsg}`));
        }
      });

      proc.on("error", (err) => {
        if (finished) {
          return;
        }
        finished = true;
        console.log(`❌ Spawn error for ${cmd}:`, err.message);
        reject(err);
      });

      const timeout = setTimeout(() => {
        if (!finished) {
          proc.kill();
          finished = true;
          reject(new Error("Black process timeout"));
        }
      }, 10000);

      // ensure we clear timeout and avoid memory leaks
      proc.on("close", () => clearTimeout(timeout));
    });
  }

  _applyEnhancedFallbackFormatting(currentCode) {
    console.log(
      "🛠️ Applying enhanced fallback formatting with block awareness..."
    );

    // Enhanced fallback formatting with better top-level detection
    const lines = currentCode.split("\n");
    const formattedLines = [];
    let indentLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        formattedLines.push("");
        continue;
      }

      const isDedentToken =
        trimmed.endsWith(":") &&
        /^(elif |else:|except |finally:)/.test(trimmed);
      const isBlockStarter =
        trimmed.endsWith(":") &&
        /^(def |class |if |for |while |try:|with |async )/.test(trimmed);
      const isImport = /^(import |from )/.test(trimmed);

      // Handle dedent, tokens: move back one level for the block start itself
      if (isDedentToken) {
        indentLevel = Math.max(indentLevel - 1, 0);
      }

      // If we encounter a top-level statement (import/def/class) that is *not* indented,
      // reset the indent level to 0.
      if (
        isImport ||
        trimmed.startsWith("def ") ||
        trimmed.startsWith("class ")
      ) {
        formattedLines.push(trimmed);
        indentLevel = isImport ? 0 : 1;
      } else {
        // Apply current indent level
        formattedLines.push(" ".repeat(indentLevel * 4) + trimmed);
      }

      // If the line started a block, increment indent level for next lines
      if (isBlockStarter || isDedentToken) {
        indentLevel++;
      }
    }

    let fixedCode = formattedLines.join("\n");

    // Clean up extra blank lines
    fixedCode = fixedCode.replace(/\n{3}/g, "\n\n");

    if (fixedCode !== currentCode) {
      this.addFix(0, this.code.length, fixedCode);
      console.log("✅ Applied block-aware fallback formatting");
    } else {
      console.log("ℹ️ No changes applied in fallback formatting");
    }
  }

  async _cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
      console.log("🧹 Cleaned up temp file");
    } catch (error) {
      // ignore missing file errors, but log others
      if (error && error.code !== "ENOENT") {
        console.warn("Could not clean up temp, file:", error.message || error);
      }
    }
  }

  getFixedCode() {
    return this.applyFixes();
  }
}

module.exports = PythonFixer;
