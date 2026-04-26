const { exec } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const BaseFixer = require("./base-fixer");
const FormatterPaths = require(path.join(__dirname, "../formatter-paths"));

class EmbeddedCFixer extends BaseFixer {
  async analyze() {
    console.log("Analyzing Embedded C file:", this.filePath);
    try {
      // Step 1: Fix all syntax issues first
      const code = await this._fixAllSyntaxIssues(this.code);

      // Step 2: Format with Uncrustify
      await this._formatWithUncrustify(code);
    } catch (error) {
      console.error(
        "Uncrustify failed, using fallback formatting:",
        error.message,
      );
      await this._fallbackFormatting();
    }
  }

  async _fixAllSyntaxIssues(originalCode) {
    console.log("Step 1: Fixing syntax issues...");
    let code = originalCode;

    // Apply fixes in sequence
    code = await this._applyMcuSpecificCorrections(code);
    code = await this._fixSemicolons(code);
    code = this._fixBraces(code);
    code = this._fixFunctionStructure(code);

    console.log("✅ Syntax issues fixed");
    return code;
  }

  async _applyMcuSpecificCorrections(code) {
    const mcuFamily = this._detectMcuFamily(code);
    console.log(`Detected MCU family: ${mcuFamily}`);

    // Fix common C syntax issues first
    code = this._fixCommonCSyntax(code);

    const patterns = this._getMcuPatterns(mcuFamily);
    for (const pattern of patterns) {
      code = code.replace(pattern.regex, pattern.replace);
    }

    return code;
  }

  _getMcuPatterns(mcuFamily) {
    const mcuPatterns = {
      stm32: [
        { regex: /(\w+)\s*->\s*(\w+)\s*=/g, replace: "$1->$2 = " },
        { regex: /RCC\s*->\s*(\w+)/g, replace: "RCC->$1" },
        { regex: /GPIO([A-Z])\s*->\s*(\w+)/g, replace: "GPIO$1->$2" },
        { regex: /HAL_(\w+)\s*\(/g, replace: "HAL_$1(" },
        { regex: /__HAL_(\w+)\s*\(/g, replace: "__HAL_$1(" },
        { regex: /NVIC_(\w+)\s*\(/g, replace: "NVIC_$1(" },
      ],
      avr: [
        { regex: /PORT([A-Z])\s*=/g, replace: "PORT$1 = " },
        { regex: /DDR([A-Z])\s*=/g, replace: "DDR$1 = " },
        { regex: /PIN([A-Z])\s*&/g, replace: "PIN$1 & " },
        { regex: /_BV\s*\(\s*(\d+)\s*\)/g, replace: "_BV($1)" },
        { regex: /sei\s*\(\s*\)/g, replace: "sei()" },
        { regex: /cli\s*\(\s*\)/g, replace: "cli()" },
      ],
      esp32: [
        { regex: /gpio_config_t/g, replace: "gpio_config_t" },
        { regex: /esp_err_t/g, replace: "esp_err_t" },
        { regex: /gpio_(\w+)\s*\(/g, replace: "gpio_$1(" },
        { regex: /esp_(\w+)\s*\(/g, replace: "esp_$1(" },
        { regex: /xTaskCreate\s*\(/g, replace: "xTaskCreate(" },
      ],
      arduino: [
        { regex: /digitalWrite\s*\(/g, replace: "digitalWrite(" },
        { regex: /digitalRead\s*\(/g, replace: "digitalRead(" },
        { regex: /analogRead\s*\(/g, replace: "analogRead(" },
        { regex: /analogWrite\s*\(/g, replace: "analogWrite(" },
        { regex: /pinMode\s*\(/g, replace: "pinMode(" },
        { regex: /delay\s*\(/g, replace: "delay(" },
        { regex: /delayMicroseconds\s*\(/g, replace: "delayMicroseconds(" },
      ],
      generic: [],
    };

    return mcuPatterns[mcuFamily] || mcuPatterns.generic;
  }

  _fixCommonCSyntax(code) {
    return code
      // Fix common typos
      .replace(/\bpritnf\b/g, "printf")
      .replace(/\bprintff\b/g, "printf")
      .replace(/\bscanff\b/g, "scanf")
      .replace(/\bscnaf\b/g, "scanf")
      .replace(/\bmian\b/g, "main")
      .replace(/\bamin\b/g, "main")
      .replace(/\bretrun\b/g, "return")
      .replace(/\bretrn\b/g, "return")
      .replace(/\bincude\b/g, "include")
      .replace(/\bincldue\b/g, "include")
      .replace(/\bstdio\.g\b/g, "stdio.h")
      .replace(/\bstdlib\.g\b/g, "stdlib.h")
      .replace(/\bstring\.g\b/g, "string.h")
      // Fix array declarations
      .replace(/(\w+)\s+(\w+)\[(\d+)\]\s*;/g, "$1 $2[$3];")
      // Fix pointer declarations
      .replace(/(\w+)\s*\*\s*(\w+)/g, "$1 *$2")
      // Fix function calls spacing
      .replace(/(\w+)\s*\(\s*/g, "$1(")
      // Fix assignment operators
      .replace(/=\s*=/g, "==")
      .replace(/!\s*=/g, "!=")
      // Fix logical operators
      .replace(/&\s*&/g, "&&")
      .replace(/\|\s*\|/g, "||")
      // Fix increment/decrement
      .replace(/\+\s*\+/g, "++")
      .replace(/-\s*-/g, "--")
      // Fix missing spaces around operators
      .replace(/([a-zA-Z0-9_])([+\-*/%=<>!&|])([a-zA-Z0-9_])/g, "$1 $2 $3")
      // Fix double spaces
      .replace(/\s{2,}/g, " ");
  }

  _detectMcuFamily(code) {
    // STM32 detection
    if (
      code.includes("HAL_") ||
      code.includes("__HAL_") ||
      (code.includes("GPIO") && code.includes("->")) ||
      code.includes("RCC->") ||
      code.includes("stm32") ||
      code.includes("NVIC_")
    )
      return "stm32";
    
    // Arduino detection (check before AVR as Arduino uses AVR)
    if (
      code.includes("digitalWrite") ||
      code.includes("digitalRead") ||
      code.includes("analogRead") ||
      code.includes("pinMode") ||
      code.includes("Arduino.h") ||
      code.includes("setup()") ||
      code.includes("loop()")
    )
      return "arduino";
    
    // AVR detection
    if (
      code.includes("DDR") ||
      code.includes("PORT") ||
      code.includes("PIN") ||
      code.includes("avr/io.h") ||
      code.includes("_BV(") ||
      code.includes("sei()") ||
      code.includes("cli()")
    )
      return "avr";
    
    // ESP32 detection
    if (
      code.includes("esp_") ||
      code.includes("gpio_config") ||
      code.includes("freertos/FreeRTOS.h") ||
      code.includes("esp_err_t") ||
      code.includes("xTaskCreate") ||
      code.includes("esp32")
    )
      return "esp32";
    
    return "generic";
  }

  async _fixSemicolons(code) {
    const lines = code.split("\n");
    const fixedLines = [];
    let inMultiLineComment = false;
    let inPreprocessor = false;
    const controlFlowKeywords = new Set([
      "if",
      "else",
      "for",
      "while",
      "do",
      "switch",
    ]);
    const statementKeywords = new Set(["return", "break", "continue", "goto"]);

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmed = line.trim();

      if (inMultiLineComment) {
        fixedLines.push(line);
        if (trimmed.includes("*/")) inMultiLineComment = false;
        continue;
      }
      if (trimmed.includes("/*")) {
        fixedLines.push(line);
        inMultiLineComment = true;
        if (trimmed.includes("*/")) inMultiLineComment = false;
        continue;
      }

      if (trimmed.startsWith("#")) {
        fixedLines.push(line);
        inPreprocessor = !trimmed.endsWith("\\");
        continue;
      }
      if (inPreprocessor) {
        fixedLines.push(line);
        inPreprocessor = trimmed.endsWith("\\");
        continue;
      }

      if (
        !trimmed ||
        trimmed.startsWith("//") ||
        trimmed.endsWith(";") ||
        trimmed.endsWith("{") ||
        trimmed.endsWith("}") ||
        trimmed.endsWith(",")
      ) {
        fixedLines.push(line);
        continue;
      }

      const firstWord = trimmed.split(/\s+/)[0];
      const isControlFlow = controlFlowKeywords.has(firstWord);
      const isStatement = statementKeywords.has(firstWord);

      if (!isControlFlow) {
        const needsSemicolon =
          isStatement ||
          trimmed.includes("=") ||
          /[a-zA-Z_]\w*\s*\([^)]*\)$/.test(trimmed) ||
          /^(int|void|char|float|double|bool|short|long|unsigned|signed|const|static|volatile|extern)\s+/.test(
            trimmed,
          );
        const isFunctionDef =
          /^[a-zA-Z_]\w*\s+[a-zA-Z_]\w*\s*\([^)]*\)\s*[^{]*$/.test(trimmed) &&
          !trimmed.endsWith(";");
        const isLoopOrConditional =
          trimmed.startsWith("for") ||
          trimmed.startsWith("while") ||
          trimmed.startsWith("if");
        if (needsSemicolon && !isFunctionDef && !isLoopOrConditional)
          line = line.replace(/\s*$/, ";");
      }

      fixedLines.push(line);
    }

    return fixedLines.join("\n");
  }

  _fixBraces(code) {
    const lines = code.split("\n");
    const fixedLines = [];
    let braceCount = 0,
      inComment = false,
      inPreprocessor = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        inComment ||
        trimmed.startsWith("//") ||
        inPreprocessor ||
        trimmed.startsWith("#")
      ) {
        fixedLines.push(line);
        if (trimmed.includes("/*")) inComment = true;
        if (trimmed.includes("*/")) inComment = false;
        if (trimmed.startsWith("#")) inPreprocessor = !trimmed.endsWith("\\");
        if (inPreprocessor) inPreprocessor = trimmed.endsWith("\\");
        continue;
      }

      if (trimmed.includes("/*")) {
        inComment = true;
        fixedLines.push(line);
        if (trimmed.includes("*/")) inComment = false;
        continue;
      }

      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      braceCount += openBraces - closeBraces;

      fixedLines.push(line);
    }

    if (braceCount > 0) {
      for (let i = 0; i < braceCount; i++) fixedLines.push("}");
    } else if (braceCount < 0) {
      console.warn(
        `Warning: ${Math.abs(braceCount)} extra closing braces detected`,
      );
    }

    return fixedLines.join("\n");
  }

  _fixFunctionStructure(code) {
    const lines = code.split("\n");
    const fixedLines = [];
    let inComment = false,
      inPreprocessor = false;
    const functionRegex =
      /^(int|void|char|float|double|bool|short|long|unsigned|signed|static|inline)\s+[a-zA-Z_]\w*\s*\([^)]*\)\s*[^{;]*$/;

    for (const line of lines) {
      const trimmed = line.trim();
      fixedLines.push(line);

      if (
        inComment ||
        trimmed.startsWith("//") ||
        inPreprocessor ||
        trimmed.startsWith("#")
      ) {
        if (trimmed.includes("/*")) inComment = true;
        if (trimmed.includes("*/")) inComment = false;
        if (trimmed.startsWith("#")) inPreprocessor = !trimmed.endsWith("\\");
        if (inPreprocessor) inPreprocessor = trimmed.endsWith("\\");
        continue;
      }

      if (
        functionRegex.test(trimmed) &&
        !trimmed.endsWith("{") &&
        !trimmed.endsWith(";")
      )
        fixedLines.push("{");
    }

    return fixedLines.join("\n");
  }

  async _formatWithUncrustify(fixedCode) {
    console.log("Step 2: Formatting with Uncrustify...");

    const tempDir = path.dirname(this.filePath);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.c`;
    const tempFilePath = path.join(tempDir, tempFileName);

    // Use the bundled Uncrustify from FormatterPaths
    const uncrustifyPath = FormatterPaths.getUncrustifyPath();
    const configPath = path.join(__dirname, "uncrustify.cfg");

    try {
      await fs.writeFile(tempFilePath, fixedCode, "utf8");
      const cmd = `"${uncrustifyPath}" -c "${configPath}" -f "${tempFilePath}" -o "${tempFilePath}" -l C`;

      return new Promise((resolve, reject) => {
        exec(cmd, async (err, stdout, stderr) => {
          let formattedCode;
          try {
            formattedCode = await fs.readFile(tempFilePath, "utf8");
          } catch (readErr) {
            await this._cleanupTempFile(tempFilePath);
            return reject(
              new Error(`Failed to read formatted file: ${readErr.message}`),
            );
          }

          await this._cleanupTempFile(tempFilePath);

          if (formattedCode.trim().length === 0)
            return reject(new Error("Uncrustify produced empty output"));

          const braceBalance = this._validateBraceBalance(formattedCode);
          if (!braceBalance.isBalanced)
            console.warn(`Brace imbalance detected: ${braceBalance.message}`);

          if (formattedCode !== this.code)
            this.addFix(0, this.code.length, formattedCode);

          if (err || stderr)
            console.warn("Uncrustify warnings:", stderr || err.message);

          console.log(
            "✅ Embedded C code formatted successfully with Uncrustify",
          );
          resolve();
        });
      });
    } catch (error) {
      await this._cleanupTempFile(tempFilePath).catch(() => {});
      throw error;
    }
  }

  _validateBraceBalance(code) {
    let braceCount = 0,
      inComment = false,
      inString = false,
      escapeNext = false;

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === "\"" && !inComment) {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "/" && i + 1 < code.length) {
        if (code[i + 1] === "/") {
          while (i < code.length && code[i] !== "\n") i++;
          continue;
        }
        if (code[i + 1] === "*") {
          inComment = true;
          i++;
          continue;
        }
      }
      if (
        inComment &&
        char === "*" &&
        i + 1 < code.length &&
        code[i + 1] === "/"
      ) {
        inComment = false;
        i++;
        continue;
      }
      if (inComment) continue;

      if (char === "{") braceCount++;
      if (char === "}") braceCount--;
    }

    return {
      isBalanced: braceCount === 0,
      message:
        braceCount > 0
          ? `${braceCount} missing closing brace(s)`
          : `${Math.abs(braceCount)} extra closing brace(s)`,
    };
  }

  async _cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Warning: Could not delete temp file ${filePath}: ${error.message}`);
      }
      // Don't throw - cleanup failures shouldn't break the main process
    }
  }

  async _fallbackFormatting() {
    console.log("Using fallback formatting...");
    const code = await this._fixAllSyntaxIssues(this.code);

    const lines = code.split("\n");
    const formattedLines = [];
    let indentLevel = 0,
      inComment = false,
      inPreprocessor = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("#")) {
        formattedLines.push(trimmed);
        inPreprocessor = !trimmed.endsWith("\\");
        continue;
      }
      if (inPreprocessor) {
        formattedLines.push(trimmed);
        inPreprocessor = trimmed.endsWith("\\");
        continue;
      }

      if (inComment) {
        formattedLines.push("    ".repeat(indentLevel) + trimmed);
        if (trimmed.includes("*/")) inComment = false;
        continue;
      }
      if (trimmed.includes("/*")) {
        formattedLines.push("    ".repeat(indentLevel) + trimmed);
        inComment = true;
        if (trimmed.includes("*/")) inComment = false;
        continue;
      }

      if (!trimmed) {
        formattedLines.push("");
        continue;
      }
      if (trimmed.startsWith("//")) {
        formattedLines.push("    ".repeat(indentLevel) + trimmed);
        continue;
      }

      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;

      formattedLines.push("    ".repeat(Math.max(0, indentLevel)) + trimmed);
      indentLevel += openBraces - closeBraces;
      indentLevel = Math.max(0, indentLevel);
    }

    const formattedCode = formattedLines.join("\n");
    if (formattedCode !== this.code)
      this.addFix(0, this.code.length, formattedCode);

    console.log("✅ Fallback formatting completed");
  }

  /**
   * Return the fully fixed/formatted code
   */
  getFixedCode() {
    return this.applyFixes();
  }
}

module.exports = EmbeddedCFixer;
