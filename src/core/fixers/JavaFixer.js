const { exec } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const BaseFixer = require("./base-fixer");
const FormatterPaths = require(path.join(__dirname, "../formatter-paths"));

class JavaFixer extends BaseFixer {
  async analyze() {
    console.log("Analyzing Java file:", this.filePath);

    try {
      const code = await this._fixSyntaxAndTypos();
      await this._formatWithGoogleJavaFormat(code);
    } catch (err) {
      console.error("Google Java Format failed, using fallback:", err.message);
      await this._fallbackFormatting();
    }
  }

  async _fixSyntaxAndTypos() {
    const code = await this._fixBasicSyntaxAndBraces();
    return this._fixCommonTypos(code);
  }

  async _fixBasicSyntaxAndBraces() {
    const lines = this.code.split("\n");
    const fixedLines = [];
    const braceStack = [];
    let inMultiComment = false;

    for (const rawLine of lines) {
      let line = rawLine.trim();
      if (!line) {
        fixedLines.push("");
        continue;
      }

      if (inMultiComment) {
        fixedLines.push(this._indent(braceStack.length) + line);
        if (line.includes("*/")) inMultiComment = false;
        continue;
      }
      if (line.includes("/*") && !line.includes("*/")) {
        fixedLines.push(this._indent(braceStack.length) + line);
        inMultiComment = true;
        continue;
      }

      if (line.startsWith("//")) {
        fixedLines.push(this._indent(braceStack.length) + line);
        continue;
      }

      // Fix misplaced semicolons in braces and method calls
      line = line.replace(/\{\s*;/g, "{");
      line = line.replace(/;\s*\)/g, ")");
      line = line.replace(/\(\s*;/g, "(");
      line = line.replace(/;\s*;/g, ";"); // Remove duplicate semicolons

      const closeCount = (line.match(/}/g) || []).length;
      for (let i = 0; i < closeCount && braceStack.length; i++)
        braceStack.pop();

      const indent = this._indent(braceStack.length);

      if (line.startsWith("import ") || line.startsWith("package ")) {
        line = line.replace(/,([^;]+)/g, ".$1");
        line = line.replace(/;+$/, "") + ";";
      } else {
        const firstWord = line.split(/\s+/)[0];
        if (this._shouldAddSemicolon(line, firstWord)) line += ";";

        const controlMatch = line.match(
          /^(if|else if|else|for|while|do|switch|try|catch|finally)\b(.*)/
        );
        // Better check for control structures vs method declarations
        if (controlMatch) {
          const keyword = controlMatch[1],
            rest = controlMatch[2].trim();

          // More accurate detection - control structures typically don't have return types
          const hasReturnType = /^[\w<>\[\]]+\s+\w+\s*\(/.test(rest);
          const isLikelyMethod =
            rest.includes("(") && !rest.trim().endsWith(") {");

          if (
            !hasReturnType &&
            !isLikelyMethod &&
            !line.endsWith("{") &&
            !line.endsWith(";")
          ) {
            line = rest ? `${keyword} ${rest} {` : `${keyword} {`;
            braceStack.push("{");
          }
        }
      }

      fixedLines.push(indent + line);

      const openCount = (line.match(/{/g) || []).length;
      for (let i = 0; i < openCount; i++) braceStack.push("{");
    }

    while (braceStack.length) {
      fixedLines.push(this._indent(Math.max(0, braceStack.length - 1)) + "}");
      braceStack.pop();
    }

    return fixedLines.join("\n");
  }

  _indent(level) {
    return "    ".repeat(level);
  }

  _shouldAddSemicolon(trimmed, firstWord) {
    const keywords = [
      "if",
      "else",
      "for",
      "while",
      "do",
      "switch",
      "case",
      "default",
      "try",
      "catch",
      "finally",
      "class",
      "interface",
      "enum",
      "import",
      "package",
      "extends",
      "implements",
      "throws",
      "synchronized"
    ];

    // Already has terminator
    if (
      trimmed.endsWith(";") ||
      trimmed.endsWith("{") ||
      trimmed.endsWith("}") ||
      trimmed.endsWith(":")
    )
      return false;

    // Annotations, comments, or preprocessor directives
    if (
      trimmed.startsWith("@") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*")
    )
      return false;

    // Class/interface/enum declarations
    if (
      /^\s*(public|private|protected|abstract|final|strictfp)?\s*(class|interface|enum|@interface)\s+\w+/.test(
        trimmed
      )
    )
      return false;

    // Method declarations (including generics and throws)
    if (
      /^\s*(public|private|protected)?\s*(static\s+)?(final\s+)?(synchronized\s+)?(abstract\s+)?(<[^>]+>\s+)?[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*(throws\s+[\w<>,.\s]+)?\s*\{?\s*$/.test(
        trimmed
      )
    )
      return false;

    // Constructor declarations
    if (
      /^\s*(public|private|protected)\s+\w+\s*\([^)]*\)\s*(throws\s+[\w<>,.\s]+)?\s*\{?\s*$/.test(
        trimmed
      )
    )
      return false;

    // Control flow keywords
    if (keywords.includes(firstWord)) return false;

    // Lambda expressions
    if (trimmed.includes("->")) return false;

    // Multi-line statements (ending with operators)
    if (/[+\-*/&|^%<>=!]\s*$/.test(trimmed)) return false;

    // Array initializations
    if (trimmed.includes("{") && trimmed.includes("}")) return false;

    // Lines that already have semicolons in wrong places
    if (/\{\s*;/.test(trimmed)) return false;

    return true;
  }

  _fixCommonTypos(code) {
    return (
      code
        // Fix misplaced semicolons first
        .replace(/\{\s*;/g, "{")
        .replace(/;\s*\)/g, ")")
        .replace(/\(\s*;/g, "(")
        .replace(/;\s*;/g, ";") // Remove duplicate semicolons
        // Print statement typos
        .replace(/\bpritnln\b/g, "println")
        .replace(/\bpritnf\b/g, "printf")
        .replace(/\bprintbln\b/g, "println")
        .replace(/\bpritn\b/g, "print")
        .replace(/\bsyso\b/g, "System.out")
        .replace(/\bsout\b/g, "System.out")
        // Access modifier typos
        .replace(/\bpubic\b/g, "public")
        .replace(/\bpubilc\b/g, "public")
        .replace(/\bprvate\b/g, "private")
        .replace(/\bpriavte\b/g, "private")
        .replace(/\bproected\b/g, "protected")
        .replace(/\bproteted\b/g, "protected")
        // Type typos
        .replace(/\bStirng\b/g, "String")
        .replace(/\bStringg\b/g, "String")
        .replace(/\bStrng\b/g, "String")
        .replace(/\bInteget\b/g, "Integer")
        .replace(/\bIntger\b/g, "Integer")
        .replace(/\bDoube\b/g, "Double")
        .replace(/\bDoubl\b/g, "Double")
        .replace(/\bFlot\b/g, "Float")
        .replace(/\bCharr\b/g, "Char")
        .replace(/\bBoolea\b/g, "Boolean")
        .replace(/\bBoolena\b/g, "Boolean")
        // Keyword typos
        .replace(/\bstatc\b/g, "static")
        .replace(/\bstaitc\b/g, "static")
        .replace(/\bvois\b/g, "void")
        .replace(/\bviod\b/g, "void")
        .replace(/\bmian\b/g, "main")
        .replace(/\bmain\b/g, "main")
        .replace(/\bretrun\b/g, "return")
        .replace(/\bretrn\b/g, "return")
        .replace(/\bimoprt\b/g, "import")
        .replace(/\bimprot\b/g, "import")
        // Common method typos
        .replace(/\blentgh\b/g, "length")
        .replace(/\blenght\b/g, "length")
        .replace(/\bequlas\b/g, "equals")
        .replace(/\bequals\b/g, "equals")
        // Fix missing 'new' keyword
        .replace(
          /\b(\w+)\s+(\w+)\s*=\s*(ArrayList|HashMap|HashSet|LinkedList|Vector)\s*\(/g,
          "$1 $2 = new $3("
        )
        // Fix C-style array declarations
        .replace(
          /\b(int|String|double|float|char|boolean)\s+(\w+)\[(\d*)\]/g,
          "$1[] $2"
        )
        // Fix missing semicolons in common patterns
        .replace(/(System\.out\.print(?:ln)?\([^)]*\))(?!)/g, "$1;")
        .replace(/(\w+\s*=\s*[^;\n]+)(?<!)$/gm, "$1;")
    );
  }

  async _formatWithGoogleJavaFormat(codeToFormat) {
    const tempDir = path.dirname(this.filePath);
    const tempFile = path.join(
      tempDir,
      `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.java`
    );
    const jarPath = FormatterPaths.getJavaFormatterPath();

    try {
      await fs.writeFile(tempFile, codeToFormat);
      return new Promise((resolve, reject) => {
        exec(
          `java -jar "${jarPath}" --aosp --replace "${tempFile}"`,
          async (err) => {
            let formatted;
            try {
              formatted = await fs.readFile(tempFile, "utf8");
            } catch (e) {
              await this._cleanupTempFile(tempFile);
              return reject(e);
            }
            await this._cleanupTempFile(tempFile);
            if (err) {
              console.warn(err.message);
              await this._fallbackFormatting();
              return resolve();
            }
            if (formatted !== this.code)
              this.addFix(0, this.code.length, formatted);
            console.log(
              "✅ Java code formatted successfully with Google Java Format"
            );
            resolve();
          }
        );
      });
    } catch (err) {
      await this._cleanupTempFile(tempFile);
      throw err;
    }
  }

  async _cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch {}
  }

  async _fallbackFormatting() {
    console.log("Using fallback Java formatting...");
    const code = await this._fixSyntaxAndTypos();
    const fixedLines = [];
    const braceStack = [];
    let inComment = false;

    for (const rawLine of code.split("\n")) {
      let line = rawLine.trim();
      if (!line) {
        fixedLines.push("");
        continue;
      }

      if (inComment) {
        fixedLines.push(this._indent(braceStack.length) + line);
        if (line.includes("*/")) inComment = false;
        continue;
      }
      if (line.includes("/*")) inComment = true;

      const closeCount = (line.match(/}/g) || []).length;
      for (let i = 0; i < closeCount && braceStack.length; i++)
        braceStack.pop();

      const indent = this._indent(braceStack.length);
      const controlMatch = line.match(
        /^(if|else if|else|for|while|do|switch|try|catch|finally)\b(.*)/
      );
      if (controlMatch) {
        const keyword = controlMatch[1],
          rest = controlMatch[2].trim();
        if (!line.endsWith("{") && !line.endsWith(";")) {
          line = rest ? `${keyword} ${rest} {` : `${keyword} {`;
          braceStack.push("{");
        }
      }

      const firstWord = line.split(/\s+/)[0];
      if (this._shouldAddSemicolon(line, firstWord)) line += ";";

      fixedLines.push(indent + line);

      const openCount = (line.match(/{/g) || []).length;
      for (let i = 0; i < openCount; i++) braceStack.push("{");
    }

    while (braceStack.length) {
      fixedLines.push(this._indent(Math.max(0, braceStack.length - 1)) + "}");
      braceStack.pop();
    }

    const formatted = fixedLines.join("\n");
    if (formatted !== this.code) this.addFix(0, this.code.length, formatted);
    console.log("✅ Fallback Java formatting completed");
  }

  getFixedCode() {
    return this.applyFixes();
  }
}

module.exports = JavaFixer;
