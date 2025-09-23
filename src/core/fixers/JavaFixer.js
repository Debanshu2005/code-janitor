const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const BaseFixer = require('./base-fixer');
const FormatterPaths = require('./formatter-paths'); // Add this import

class JavaFixer extends BaseFixer {
  async analyze() {
    console.log('Analyzing Java file:', this.filePath);

    try {
      // Step 1: Fix syntax and braces
      const codeWithFixedSyntax = await this._fixBasicSyntaxAndBraces();

      // Step 2: Format with Google Java Format
      await this._formatWithGoogleJavaFormat(codeWithFixedSyntax);

    } catch (error) {
      console.error('Google Java Format failed, using fallback:', error.message);
      await this._fallbackFormatting();
    }
  }

  async _fixBasicSyntaxAndBraces() {
    const lines = this.code.split('\n');
    const fixedLines = [];
    const braceStack = [];
    let inMultiLineComment = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let trimmed = line.trim();

      // Handle comments
      if (inMultiLineComment) {
        fixedLines.push(line);
        if (trimmed.includes('*/')) inMultiLineComment = false;
        continue;
      }
      if (trimmed.includes('/*') && !trimmed.includes('*/')) {
        inMultiLineComment = true;
        fixedLines.push(line);
        continue;
      }
      if (!trimmed || trimmed.startsWith('//')) {
        fixedLines.push(line);
        continue;
      }

      // Track braces
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;

      for (let j = 0; j < openBraces; j++) braceStack.push('{');
      for (let j = 0; j < closeBraces; j++) if (braceStack.length) braceStack.pop();

      const firstWord = trimmed.split(/\s+/)[0];

      // Package/import → always one semicolon
      if (trimmed.startsWith('import ') || trimmed.startsWith('package ')) {
        line = trimmed.replace(/;+$/, '') + ';';
      }
      // Regular statements
      else if (this._shouldAddSemicolon(trimmed, firstWord)) {
        line = trimmed + ';';
      }

      // Deduplicate ;; and cleanup
      line = line.replace(/;{2,}/g, ';').trimEnd();

      fixedLines.push(line);
    }

    // Balance braces
    if (braceStack.length > 0) {
      const missingBraces = '\n' + '}'.repeat(braceStack.length);
      console.log(`Added ${braceStack.length} missing closing brace(s)`);
      fixedLines.push(missingBraces);
    }

    return fixedLines.join('\n');
  }

  _shouldAddSemicolon(trimmed, firstWord) {
    const blockKeywords = [
      'public', 'private', 'protected',
      'class', 'interface', 'enum',
      'if', 'else', 'for', 'while', 'do',
      'switch', 'case', 'default',
      'try', 'catch', 'finally',
      'return', 'break', 'continue'
    ];

    // Already valid endings
    if (
      trimmed.endsWith(';') ||
      trimmed.endsWith('{') ||
      trimmed.endsWith('}') ||
      trimmed.endsWith(':')
    ) return false;

    if (trimmed.startsWith('@')) return false;
    if (blockKeywords.includes(firstWord)) return false;

    // Method declaration vs method call
    if (trimmed.endsWith(')')) {
      const declStarters = ['public', 'private', 'protected', 'static', 'final', 'synchronized'];
      if (declStarters.some(k => trimmed.startsWith(k))) {
        return false; // method declaration
      }
      return true; // method call → needs ;
    }

    return true;
  }

  async _formatWithGoogleJavaFormat(codeToFormat) {
    const tempDir = path.dirname(this.filePath);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.java`;
    const tempFilePath = path.join(tempDir, tempFileName);

    // Use the bundled Google Java Format path
    const jarPath = FormatterPaths.getJavaFormatterPath();

    try {
      await fs.writeFile(tempFilePath, codeToFormat);

      return new Promise((resolve, reject) => {
        exec(`java -jar "${jarPath}" --aosp --replace "${tempFilePath}"`, async (error, stdout, stderr) => {
          let formattedCode;
          try {
            formattedCode = await fs.readFile(tempFilePath, 'utf8');
          } catch (readError) {
            await this._cleanupTempFile(tempFilePath);
            return reject(new Error(`Failed to read formatted file: ${readError.message}`));
          }

          // Clean up temp file regardless of success
          await this._cleanupTempFile(tempFilePath);

          if (error) {
            console.warn(`Google Java Format had issues: ${stderr || error.message}`);
            // Even if formatting fails, use the pre-fixed code
            if (codeToFormat !== this.code) {
              this.addFix(0, this.code.length, codeToFormat);
            }
            return resolve();
          }

          if (formattedCode !== this.code) {
            this.addFix(0, this.code.length, formattedCode);
          }
          
          console.log('✅ Java code formatted successfully with Google Java Format');
          resolve();
        });
      });
    } catch (error) {
      await this._cleanupTempFile(tempFilePath);
      throw error;
    }
  }

  async _cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore errors if file doesn't exist
      if (error.code !== 'ENOENT') {
        console.warn('Warning: Could not delete temp file:', filePath);
      }
    }
  }

  async _fallbackFormatting() {
    console.log('Using fallback Java formatting...');
    
    // First apply syntax fixes
    let code = await this._fixBasicSyntaxAndBraces();
    
    // Then apply basic formatting
    const lines = code.split('\n');
    const fixedLines = [];
    const braceStack = [];
    let inComment = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let trimmed = line.trim();

      // Handle comments
      if (inComment) {
        fixedLines.push('    '.repeat(braceStack.length) + trimmed);
        if (trimmed.includes('*/')) inComment = false;
        continue;
      }
      if (trimmed.includes('/*')) {
        fixedLines.push('    '.repeat(braceStack.length) + trimmed);
        inComment = true;
        if (trimmed.includes('*/')) inComment = false;
        continue;
      }
      if (!trimmed || trimmed.startsWith('//')) {
        fixedLines.push('    '.repeat(braceStack.length) + trimmed);
        continue;
      }

      // Handle closing brace before indent
      const closeBraces = (trimmed.match(/}/g) || []).length;
      for (let j = 0; j < closeBraces && braceStack.length > 0; j++) {
        braceStack.pop();
      }

      const indentLevel = braceStack.length;
      const expectedIndent = '    '.repeat(indentLevel);

      // Single-line control structures → wrap in braces
      const controlMatch = trimmed.match(/^(if|else|for|while)\b(.*)/);
      if (controlMatch) {
        const keyword = controlMatch[1];
        const rest = controlMatch[2].trim();
        if (rest && !rest.startsWith('{')) {
          trimmed = `${keyword} ${rest} {`;
          fixedLines.push(expectedIndent + trimmed);
          braceStack.push('{');
          continue;
        }
      }

      const firstWord = trimmed.split(/\s+/)[0];
      if (this._shouldAddSemicolon(trimmed, firstWord) && !trimmed.endsWith(';')) {
        trimmed = trimmed + ';';
      }

      fixedLines.push(expectedIndent + trimmed);

      // Update brace tracking
      const openBraces = (trimmed.match(/{/g) || []).length;
      for (let j = 0; j < openBraces; j++) braceStack.push('{');
    }

    // Close any unclosed braces
    if (braceStack.length > 0) {
      const missing = braceStack.length;
      console.log(`Added ${missing} missing closing brace(s) in fallback`);
      for (let i = 0; i < missing; i++) {
        const indent = '    '.repeat(Math.max(0, missing - i - 1));
        fixedLines.push(indent + '}');
      }
    }

    const formattedCode = fixedLines.join('\n');
    if (formattedCode !== this.code) {
      this.addFix(0, this.code.length, formattedCode);
    }
    
    console.log('✅ Fallback Java formatting completed');
  }
}

module.exports = JavaFixer;