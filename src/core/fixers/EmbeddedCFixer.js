const { exec } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const BaseFixer = require("./base-fixer");
const FormatterPaths = require(path.join(__dirname, '../formatter-paths'));

class EmbeddedCFixer extends BaseFixer {
  async analyze() {
    console.log("Analyzing Embedded C file:", this.filePath);
    try {
      // Step 1: Fix all syntax issues first
      let code = await this._fixAllSyntaxIssues(this.code);
      
      // Step 2: Format with Uncrustify
      await this._formatWithUncrustify(code);
    } catch (error) {
      console.error("Uncrustify failed, using fallback formatting:", error.message);
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

    const mcuPatterns = {
      stm32: [
        { regex: /(\w+)\s*->\s*(\w+)\s*=/g, replace: "$1->$2 = " },
        { regex: /RCC\s*->\s*(\w+)/g, replace: "RCC->$1" },
        { regex: /GPIO([A-Z])\s*->\s*(\w+)/g, replace: "GPIO$1->$2" },
      ],
      avr: [
        { regex: /PORT([A-Z])\s*=/g, replace: "PORT$1 = " },
        { regex: /DDR([A-Z])\s*=/g, replace: "DDR$1 = " },
      ],
      esp32: [
        { regex: /gpio_config_t/g, replace: "gpio_config_t" },
        { regex: /esp_err_t/g, replace: "esp_err_t" },
      ],
      generic: []
    };

    const patterns = mcuPatterns[mcuFamily] || mcuPatterns.generic;
    for (const pattern of patterns) {
      code = code.replace(pattern.regex, pattern.replace);
    }

    return code;
  }

  _detectMcuFamily(code) {
    if (code.includes("HAL_") || (code.includes("GPIO") && code.includes("->")) || code.includes("RCC->")) return "stm32";
    if (code.includes("DDR") || code.includes("PORT") || code.includes("PIN") || code.includes("avr/io.h")) return "avr";
    if (code.includes("esp_") || code.includes("gpio_config") || code.includes("freertos/FreeRTOS.h")) return "esp32";
    return "generic";
  }

  async _fixSemicolons(code) {
    const lines = code.split("\n");
    const fixedLines = [];
    let inMultiLineComment = false;
    let inPreprocessor = false;
    const controlFlowKeywords = new Set(["if", "else", "for", "while", "do", "switch"]);
    const statementKeywords = new Set(["return", "break", "continue", "goto"]);

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmed = line.trim();

      if (inMultiLineComment) { fixedLines.push(line); if (trimmed.includes("*/")) inMultiLineComment = false; continue; }
      if (trimmed.includes("/*")) { fixedLines.push(line); inMultiLineComment = true; if (trimmed.includes("*/")) inMultiLineComment = false; continue; }

      if (trimmed.startsWith("#")) { fixedLines.push(line); inPreprocessor = !trimmed.endsWith("\\"); continue; }
      if (inPreprocessor) { fixedLines.push(line); inPreprocessor = trimmed.endsWith("\\"); continue; }

      if (!trimmed || trimmed.startsWith("//") || trimmed.endsWith(";") || trimmed.endsWith("{") || trimmed.endsWith("}") || trimmed.endsWith(",")) { fixedLines.push(line); continue; }

      const firstWord = trimmed.split(/\s+/)[0];
      const isControlFlow = controlFlowKeywords.has(firstWord);
      const isStatement = statementKeywords.has(firstWord);

      if (!isControlFlow) {
        const needsSemicolon = isStatement || trimmed.includes("=") || /[a-zA-Z_]\w*\s*\([^)]*\)$/.test(trimmed) || /^(int|void|char|float|double|bool|short|long|unsigned|signed|const|static|volatile|extern)\s+/.test(trimmed);
        const isFunctionDef = /^[a-zA-Z_]\w*\s+[a-zA-Z_]\w*\s*\([^)]*\)\s*[^{]*$/.test(trimmed) && !trimmed.endsWith(";");
        const isLoopOrConditional = trimmed.startsWith("for") || trimmed.startsWith("while") || trimmed.startsWith("if");
        if (needsSemicolon && !isFunctionDef && !isLoopOrConditional) line = line.replace(/\s*$/, ";");
      }

      fixedLines.push(line);
    }

    return fixedLines.join("\n");
  }

  _fixBraces(code) {
    const lines = code.split('\n');
    const fixedLines = [];
    let braceCount = 0, inComment = false, inPreprocessor = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (inComment || trimmed.startsWith("//") || inPreprocessor || trimmed.startsWith("#")) {
        fixedLines.push(line);
        if (trimmed.includes("/*")) inComment = true;
        if (trimmed.includes("*/")) inComment = false;
        if (trimmed.startsWith("#")) inPreprocessor = !trimmed.endsWith("\\");
        if (inPreprocessor) inPreprocessor = trimmed.endsWith("\\");
        continue;
      }

      if (trimmed.includes("/*")) { inComment = true; fixedLines.push(line); if (trimmed.includes("*/")) inComment = false; continue; }

      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      braceCount += openBraces - closeBraces;

      fixedLines.push(line);
    }

    if (braceCount > 0) { for (let i = 0; i < braceCount; i++) fixedLines.push('}'); }
    else if (braceCount < 0) { console.warn(`Warning: ${Math.abs(braceCount)} extra closing braces detected`); }

    return fixedLines.join('\n');
  }

  _fixFunctionStructure(code) {
    const lines = code.split('\n');
    const fixedLines = [];
    let inComment = false, inPreprocessor = false;
    const functionRegex = /^(int|void|char|float|double|bool|short|long|unsigned|signed|static|inline)\s+[a-zA-Z_]\w*\s*\([^)]*\)\s*[^{;]*$/;

    for (const line of lines) {
      const trimmed = line.trim();
      fixedLines.push(line);

      if (inComment || trimmed.startsWith("//") || inPreprocessor || trimmed.startsWith("#")) {
        if (trimmed.includes("/*")) inComment = true;
        if (trimmed.includes("*/")) inComment = false;
        if (trimmed.startsWith("#")) inPreprocessor = !trimmed.endsWith("\\");
        if (inPreprocessor) inPreprocessor = trimmed.endsWith("\\");
        continue;
      }

      if (functionRegex.test(trimmed) && !trimmed.endsWith('{') && !trimmed.endsWith(';')) fixedLines.push('{');
    }

    return fixedLines.join('\n');
  }

  async _formatWithUncrustify(fixedCode) {
    console.log("Step 2: Formatting with Uncrustify...");
    
    const tempDir = path.dirname(this.filePath);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.c`;
    const tempFilePath = path.join(tempDir, tempFileName);
    const uncrustifyPath = FormatterPaths.getUncrustifyPath();
    const configPath = path.join(__dirname, "uncrustify.cfg");

    try {
      await fs.writeFile(tempFilePath, fixedCode, "utf8");
      const cmd = `"${uncrustifyPath}" -c "${configPath}" -f "${tempFilePath}" -o "${tempFilePath}" -l C`;

      return new Promise((resolve, reject) => {
        exec(cmd, async (err, stdout, stderr) => {
          let formattedCode;
          try { formattedCode = await fs.readFile(tempFilePath, "utf8"); }
          catch (readErr) { await this._cleanupTempFile(tempFilePath); return reject(new Error(`Failed to read formatted file: ${readErr.message}`)); }

          await this._cleanupTempFile(tempFilePath);

          if (formattedCode.trim().length === 0) return reject(new Error("Uncrustify produced empty output"));

          const braceBalance = this._validateBraceBalance(formattedCode);
          if (!braceBalance.isBalanced) console.warn(`Brace imbalance detected: ${braceBalance.message}`);

          if (formattedCode !== this.code) this.addFix(0, this.code.length, formattedCode);

          if (err || stderr) console.warn("Uncrustify warnings:", stderr || err.message);

          console.log("✅ Embedded C code formatted successfully with Uncrustify");
          resolve();
        });
      });
    } catch (error) {
      await this._cleanupTempFile(tempFilePath).catch(() => {});
      throw error;
    }
  }

  _validateBraceBalance(code) {
    let braceCount = 0, inComment = false, inString = false, escapeNext = false;

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (char === '\\') { escapeNext = true; continue; }
      if (char === '"' && !inComment) { inString = !inString; continue; }
      if (inString) continue;

      if (char === '/' && i + 1 < code.length) {
        if (code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
        if (code[i + 1] === '*') { inComment = true; i++; continue; }
      }
      if (inComment && char === '*' && i + 1 < code.length && code[i + 1] === '/') { inComment = false; i++; continue; }
      if (inComment) continue;

      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
    }

    return { isBalanced: braceCount === 0, message: braceCount > 0 ? `${braceCount} missing closing brace(s)` : `${Math.abs(braceCount)} extra closing brace(s)` };
  }

  async _cleanupTempFile(filePath) {
    try { await fs.unlink(filePath); } 
    catch (error) { if (error.code !== 'ENOENT') console.warn("Warning: Could not delete temp file:", filePath); }
  }

  async _fallbackFormatting() {
    console.log("Using fallback formatting...");
    let code = await this._fixAllSyntaxIssues(this.code);

    const lines = code.split('\n');
    const formattedLines = [];
    let indentLevel = 0, inComment = false, inPreprocessor = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('#')) { formattedLines.push(trimmed); inPreprocessor = !trimmed.endsWith('\\'); continue; }
      if (inPreprocessor) { formattedLines.push(trimmed); inPreprocessor = trimmed.endsWith('\\'); continue; }

      if (inComment) { formattedLines.push('    '.repeat(indentLevel) + trimmed); if (trimmed.includes('*/')) inComment = false; continue; }
      if (trimmed.includes('/*')) { formattedLines.push('    '.repeat(indentLevel) + trimmed); inComment = true; if (trimmed.includes('*/')) inComment = false; continue; }

      if (!trimmed) { formattedLines.push(''); continue; }
      if (trimmed.startsWith('//')) { formattedLines.push('    '.repeat(indentLevel) + trimmed); continue; }

      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;

      formattedLines.push('    '.repeat(Math.max(0, indentLevel)) + trimmed);
      indentLevel += openBraces - closeBraces;
      indentLevel = Math.max(0, indentLevel);
    }

    const formattedCode = formattedLines.join('\n');
    if (formattedCode !== this.code) this.addFix(0, this.code.length, formattedCode);

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
