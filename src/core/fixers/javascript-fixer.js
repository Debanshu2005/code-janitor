const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const BaseFixer = require('./base-fixer');
const FormatterPaths = require(path.join(__dirname, '../formatter-paths'));

class JavaScriptFixer extends BaseFixer {
  async analyze() {
    console.log('Analyzing JavaScript file:', this.filePath);
    
    try {
      const ast = parser.parse(this.code, {
        sourceType: 'module',
        plugins: ['jsx'],
        errorRecovery: true,
      });

      // Step 1: Perform custom fixes on the AST
      const updatedCode = await this._fixVariables(ast);

      // Step 2: Pass the modified code to Prettier for full formatting
      await this._formatWithPrettier(updatedCode);
    } catch (error) {
      console.warn(`Could not parse ${this.filePath}: ${error.message}`);
      // Fallback to basic formatting if parsing fails
      await this._fallbackFormatting();
    }
  }

  async _fixVariables(ast) {
    let currentCode = this.code;
    const fixes = [];

    // Helper to add fixes
    const addVariableFix = (start, end, replacement) => {
      fixes.push({ start, end, replacement });
    };

    // Convert `var` → `let`
    traverse(ast, {
      VariableDeclaration(path) {
        if (path.node.kind === 'var') {
          addVariableFix(path.node.start, path.node.start + 3, 'let');
        }
      },
    });

    // Convert `let` → `const` (only if never reassigned)
    traverse(ast, {
      VariableDeclaration(path) {
        if (path.node.kind === 'let') {
          const declaration = path.node.declarations[0];
          if (declaration && declaration.id) {
            const variableName = declaration.id.name;
            const binding = path.scope.getBinding(variableName);

            if (binding && binding.constantViolations.length === 0) {
              const isExported = path.findParent((p) =>
                p.isExportNamedDeclaration()
              );
              if (!isExported) {
                addVariableFix(path.node.start, path.node.start + 3, 'const');
              }
            }
          }
        }
      },
    });

    // Apply fixes sequentially
    fixes.sort((a, b) => a.start - b.start);
    let offset = 0;
    for (const fix of fixes) {
      const start = fix.start + offset;
      const end = fix.end + offset;
      currentCode =
        currentCode.substring(0, start) +
        fix.replacement +
        currentCode.substring(end);
      offset += fix.replacement.length - (fix.end - fix.start);
    }

    return currentCode;
  }

  async _formatWithPrettier(codeToFormat) {
    const tempDir = path.dirname(this.filePath);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.js`;
    const tempFilePath = path.join(tempDir, tempFileName);

    const prettierPath = FormatterPaths.getPrettierPath();

    try {
      await fs.writeFile(tempFilePath, codeToFormat);

      return new Promise((resolve, reject) => {
        exec(`"${prettierPath}" --write "${tempFilePath}"`, async (error, stdout, stderr) => {
          let formattedCode;
          try {
            formattedCode = await fs.readFile(tempFilePath, 'utf8');
          } catch (readError) {
            await this._cleanupTempFile(tempFilePath);
            return reject(new Error(`Failed to read formatted file: ${readError.message}`));
          }

          await this._cleanupTempFile(tempFilePath);

          if (error) {
            console.warn(`Prettier formatting had issues: ${stderr || error.message}`);
            if (codeToFormat !== this.code) {
              this.addFix(0, this.code.length, codeToFormat);
            }
            return resolve();
          }

          if (formattedCode !== this.code) {
            this.addFix(0, this.code.length, formattedCode);
          }

          console.log('✅ JavaScript code formatted successfully with Prettier');
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

  async _fallbackFormatting() {
    console.log('Using fallback JavaScript formatting...');
    let code = await this._basicSyntaxFixes(this.code);
    const formattedCode = this._basicFormatting(code);

    if (formattedCode !== this.code) {
      this.addFix(0, this.code.length, formattedCode);
    }

    console.log('✅ Fallback JavaScript formatting completed');
  }

  async _basicSyntaxFixes(code) {
    let fixedCode = code;
    fixedCode = fixedCode.replace(/\bvar\b/g, 'let');

    const lines = fixedCode.split('\n');
    const fixedLines = [];

    for (let line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') ||
          trimmed.endsWith(';') || trimmed.endsWith('{') || trimmed.endsWith('}') ||
          trimmed.endsWith(',') || trimmed.startsWith('import ') || trimmed.startsWith('export ')) {
        fixedLines.push(line);
        continue;
      }

      if (/^[a-zA-Z_$][\w$]*\s*=[^=]/.test(trimmed) || 
          /^console\.\w+\(.*\)$/.test(trimmed) ||
          /^[a-zA-Z_$][\w$]*\(.*\)$/.test(trimmed)) {
        line = line.replace(/\s*$/, ';');
      }

      fixedLines.push(line);
    }

    return fixedLines.join('\n');
  }

  _basicFormatting(code) {
    const lines = code.split('\n');
    const formattedLines = [];
    let indentLevel = 0;
    let inComment = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (inComment) {
        formattedLines.push('  '.repeat(indentLevel) + trimmed);
        if (trimmed.includes('*/')) inComment = false;
        continue;
      }
      if (trimmed.includes('/*')) {
        formattedLines.push('  '.repeat(indentLevel) + trimmed);
        inComment = true;
        if (trimmed.includes('*/')) inComment = false;
        continue;
      }

      if (!trimmed) {
        formattedLines.push('');
        continue;
      }

      if (trimmed.startsWith('//')) {
        formattedLines.push('  '.repeat(indentLevel) + trimmed);
        continue;
      }

      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      const openBrackets = (line.match(/\(/g) || []).length;
      const closeBrackets = (line.match(/\)/g) || []).length;

      const indent = '  '.repeat(Math.max(0, indentLevel));
      formattedLines.push(indent + trimmed);

      indentLevel += (openBraces + openBrackets) - (closeBraces + closeBrackets);
      indentLevel = Math.max(0, indentLevel);
    }

    return formattedLines.join('\n');
  }

  /**
   * Return the fully fixed/ formatted code
   */
  getFixedCode() {
    return this.applyFixes();
  }
}

module.exports = JavaScriptFixer;
