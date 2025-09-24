const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const BaseFixer = require('./base-fixer');
const FormatterPaths = require(path.join(__dirname, '../formatter-paths'));

class PythonFixer extends BaseFixer {
  async analyze() {
    console.log('Analyzing Python file:', this.filePath);
    await this._fixSyntaxAndFormatWithBlack();
  }

  async _fixSyntaxAndFormatWithBlack() {
    let currentCode = this.code;
    const lines = currentCode.split('\n');
    let fixedLines = [];
    const indentSize = 4;
    const levelStack = [0];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      let line = lines[lineNum];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        fixedLines.push(line);
        continue;
      }

      let fixedLine = trimmed;
      const blockKeywords = [
        'if', 'elif', 'else',
        'for', 'while', 'try',
        'except', 'finally', 'with',
        'def', 'class'
      ];
      const keyword = trimmed.split(/\s+/)[0];

      // Step 1: Handle dedents
      if (['elif', 'else', 'except', 'finally'].includes(keyword)) {
        if (levelStack.length > 1) {
          levelStack.pop();
        }
      }

      const expectedIndentLevel = levelStack[levelStack.length - 1];

      // Step 2: Fix syntax (add colons, etc.)
      if (/^def\s+[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
        fixedLine = `${trimmed}():`;
      } else if (/^class\s+[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
        fixedLine = `${trimmed}:`;
      } else if (blockKeywords.includes(keyword) && !trimmed.endsWith(':') && !trimmed.endsWith('\\')) {
        fixedLine = `${trimmed}:`;
      }

      // Step 3: Apply indent
      const expectedIndent = expectedIndentLevel * indentSize;
      fixedLines.push(' '.repeat(expectedIndent) + fixedLine);

      // Step 4: Push new block level
      if (fixedLine.endsWith(':')) {
        levelStack.push(expectedIndentLevel + 1);
      }
    }

    currentCode = fixedLines.join('\n');
    if (!currentCode.endsWith('\n')) {
      currentCode += '\n';
    }

    // Temp file for black
    const tempDir = path.dirname(this.filePath);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.py`;
    const tempFilePath = path.join(tempDir, tempFileName);

    try {
      await fs.writeFile(tempFilePath, currentCode);

      const blackPath = FormatterPaths.getBlackPath();

      return new Promise((resolve, reject) => {
        exec(`"${blackPath}" "${tempFilePath}"`, async (error, stdout, stderr) => {
          let formattedCode;
          try {
            formattedCode = await fs.readFile(tempFilePath, 'utf8');
          } catch (readError) {
            await this._cleanupTempFile(tempFilePath);
            return reject(new Error(`Failed to read formatted file: ${readError.message}`));
          }

          // Always clean up
          await this._cleanupTempFile(tempFilePath);

          if (error) {
            console.warn(`Black formatting had issues: ${stderr || error.message}`);
            if (currentCode !== this.code) {
              this.addFix(0, this.code.length, currentCode);
            }
            return resolve();
          }

          if (formattedCode !== this.code) {
            this.addFix(0, this.code.length, formattedCode);
          }

          console.log('✅ Python code formatted successfully with Black');
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
      if (error.code !== 'ENOENT') {
        console.warn('Warning: Could not delete temp file:', filePath);
      }
    }
  }

  /**
   * Return the fully fixed/ formatted code
   */
  getFixedCode() {
    return this.applyFixes();
  }
}

module.exports = PythonFixer;
