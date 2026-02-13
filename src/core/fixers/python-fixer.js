// src/core/fixers/python-fixer.js

const BaseFixer = require("./base-fixer");
const FormatterPaths = require('../formatter-paths');
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

function _spawnCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const { input, timeout = 20000, verbose, logError } = options;

    if (verbose) {
      console.log(`[Spawn] Running: ${command} ${args.join(" ")}`);
    }

    const child = spawn(command, args, { timeout: timeout });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.stdin.write(input, (err) => {
      if (err && logError) {
        console.error(`[Spawn] Error writing to stdin: ${err.message}`);
      }
      child.stdin.end();
    });

    child.on("close", (code) => {
      if (verbose) {
        console.log(`[Spawn] Process closed with code ${code}.`);
      }
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on("error", (err) => {
      if (logError) {
        console.error(`[Spawn] Process error: ${err.message}`);
      }
      reject(new Error(`Failed to execute command: ${command}. Error: ${err.message}`));
    });
  });
}

class PythonFixer extends BaseFixer {
  constructor(code, filePath, options = {}) {
    super(code, filePath);
    this.options = options;
    this.pythonExecutable = this._getBundledPythonPath();

    if (this.options.verbose) {
      console.log(`PythonFixer initialized. Using executable: ${this.pythonExecutable}`);
    }
  }

  _getBundledPythonPath() {
    const platform = os.platform();
    const venvPath = path.join(__dirname, "..", "..", "..", "formatters", "python-formatters", "venv");

    let bundledPython;
    if (platform === "win32") {
      bundledPython = path.join(venvPath, "Scripts", "python.exe");
    } else {
      bundledPython = path.join(venvPath, "bin", "python");
    }

    if (fs.existsSync(bundledPython)) {
      return bundledPython;
    }

    return platform === "win32" ? "python" : "python3";
  }

    async analyze(options = {}) {
    const originalCode = this.code || "";
    const isRealTime = options.realTime || false;

    try {
      // For real-time auto-correction, use only fast inline fixes
      if (isRealTime) {
        return this._tryInlineFixes(originalCode);
      }
      
      // For manual fixes, use full processing
      const inlineResult = this._tryInlineFixes(originalCode);
      
      if (inlineResult.success && this._isPurePython(inlineResult.fixedCode)) {
        const autopep8Result = await this._tryAutopep8(inlineResult.fixedCode);
        if (autopep8Result.success) {
          return autopep8Result;
        }
      }
      
      if (inlineResult.success) {
        return inlineResult;
      }

      const scriptPath = path.join(__dirname, "python-syntax-fixer.py");
      
      if (!fs.existsSync(scriptPath)) {
        this._createPythonScript(scriptPath);
      }

      const result = await _spawnCommand(this.pythonExecutable, [scriptPath], {
        timeout: 30000,
        input: originalCode,
        verbose: this.options.verbose,
        logError: true
      });

      if (result.exitCode !== 0) {
        return inlineResult;
      }

      const fixedCode = result.stdout.trim();
      const appliedFixes = originalCode !== fixedCode ? 1 : 0;

      return {
        success: true,
        fixedCode: fixedCode,
        appliedFixes: appliedFixes,
        message: appliedFixes > 0 ? "Code successfully fixed and formatted." : "No syntax errors found or changes applied."
      };
    } catch (error) {
      console.error(`❌ Python Fixer Error: ${error.message}`);
      return this._tryInlineFixes(originalCode);
    }
  }

  async _tryAutopep8(code) {
    try {
      const autopep8Path = FormatterPaths.getAutopep8Path();
      
      const result = await _spawnCommand(autopep8Path, ['-'], {
        timeout: 15000,
        input: code,
        verbose: this.options.verbose,
        logError: false
      });

      if (result.exitCode === 0 && result.stdout.trim()) {
        const formattedCode = result.stdout.trim();
        const appliedFixes = code !== formattedCode ? 1 : 0;
        
        return {
          success: true,
          fixedCode: formattedCode,
          appliedFixes: appliedFixes,
          message: "Code fixed and formatted with autopep8."
        };
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`autopep8 formatting failed: ${error.message}`);
      }
    }
    
    return { success: false };
  }

  _tryInlineFixes(code) {
    let fixedCode = code;
    let fixesApplied = 0;
    const originalCode = code;

    try {
      const colonFixed = this._fixMissingColons(fixedCode);
      if (colonFixed !== fixedCode) {
        fixedCode = colonFixed;
        fixesApplied++;
      }

      const printFixed = this._fixPrintStatements(fixedCode);
      if (printFixed !== fixedCode) {
        fixedCode = printFixed;
        fixesApplied++;
      }

      const syntaxFixed = this._fixCommonSyntaxErrors(fixedCode);
      if (syntaxFixed !== fixedCode) {
        fixedCode = syntaxFixed;
        fixesApplied++;
      }

      const indentFixed = this._fixIndentation(fixedCode);
      if (indentFixed !== fixedCode) {
        fixedCode = indentFixed;
        fixesApplied++;
      }

      if (originalCode !== fixedCode) {
        fixesApplied = Math.max(1, fixesApplied);
      }

      return {
        success: true,
        fixedCode: fixedCode,
        appliedFixes: fixesApplied,
        message: fixesApplied > 0 ? "Applied inline syntax fixes." : "No issues found."
      };
    } catch (error) {
      return {
        success: false,
        fixedCode: code,
        appliedFixes: 0,
        message: `Inline fixing failed: ${error.message}`
      };
    }
  }

  _fixIndentation(code) {
    const lines = code.split('\n');
    const fixedLines = [];
    let indentLevel = 0;
    const indentSize = 4;
    let inClass = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith('#')) {
        fixedLines.push(line);
        continue;
      }

      if (/^class\s+/.test(trimmed)) {
        indentLevel = 0;
        inClass = true;
      }
      else if (inClass && /^def\s+/.test(trimmed)) {
        indentLevel = 1;
      }
      else if (/^(elif|else|except|finally)\b/.test(trimmed)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }
      else if (!inClass && /^def\s+/.test(trimmed)) {
        indentLevel = 0;
        inClass = false;
      }

      const properIndent = ' '.repeat(indentLevel * indentSize);
      fixedLines.push(properIndent + trimmed);

      if (trimmed.endsWith(':')) {
        indentLevel++;
      }
      
      if (!trimmed.startsWith(' ') && !trimmed.endsWith(':') && !/^(class|def)\s+/.test(trimmed)) {
        if (indentLevel === 0) {
          inClass = false;
        }
      }
    }

    return fixedLines.join('\n');
  }

  _fixMissingColons(code) {
    const lines = code.split('\n');
    const fixedLines = lines.map(line => {
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith('#')) {
        return line;
      }
      
      if (/^(if|elif|else|def|class|for|while|try|except|finally|with)\b/.test(trimmed)) {
        if (!trimmed.endsWith(':') && !trimmed.includes('#')) {
          if (/^def\s+.*\(.*\)\s*$/.test(trimmed)) {
            return line.replace(trimmed, trimmed + ':');
          }
          else if (!/^def\s+.*\($/.test(trimmed)) {
            return line.replace(trimmed, trimmed + ':');
          }
        }
      }
      
      return line;
    });
    
    return fixedLines.join('\n');
  }

  _fixPrintStatements(code) {
    return code.replace(/^(\s*)print\s+([^\(\n]+)$/gm, '$1print($2)');
  }

  _fixCommonSyntaxErrors(code) {
    let fixed = code;
    
    // Remove JavaScript keywords
    fixed = fixed.replace(/^(\s*)(var|let|const|function)\s+/gm, '$1');
    
    // Fix arrow functions before processing lines
    fixed = fixed.replace(/(\w+)\s*=>\s*([^\n{]+)$/gm, '$1 = $2');
    fixed = fixed.replace(/(\([^)]*\))\s*=>\s*([^\n{]+)$/gm, '$1 = $2');
    
    // Process line by line to handle braces properly
    const lines = fixed.split('\n');
    const fixedLines = [];
    
    for (const line of lines) {
      let processedLine = line;
      const trimmed = line.trim();
      
      // Skip lines that are just closing braces or catch/finally patterns
      if (trimmed === '}' || trimmed.startsWith('} catch') || trimmed.startsWith('} finally') || trimmed.startsWith('} else')) {
        if (trimmed.startsWith('} catch')) {
          const indent = line.match(/^\s*/)[0];
          const catchPart = trimmed.replace(/^}\s*catch\s*\(([^)]*)\)\s*\{?/, 'except $1:');
          processedLine = indent + catchPart;
        }
        else if (trimmed.startsWith('} finally')) {
          const indent = line.match(/^\s*/)[0];
          processedLine = indent + 'finally:';
        }
        else if (trimmed.startsWith('} else')) {
          const indent = line.match(/^\s*/)[0];
          processedLine = indent + 'else:';
        }
        else {
          continue; // Skip standalone closing braces
        }
      }
      // Handle opening braces - replace { or {: with :
      else if (trimmed.endsWith(' {') || trimmed.endsWith('{') || trimmed.endsWith(' {:') || trimmed.endsWith('{:')) {
        processedLine = line.replace(/\s*\{:?\s*$/, ':');
      }
      // Handle remaining arrow functions with braces
      else if (trimmed.includes('=>') && trimmed.endsWith('{')) {
        processedLine = processedLine.replace(/\s*=>\s*\{\s*$/, ':');
      }
      
      fixedLines.push(processedLine);
    }
    
    fixed = fixedLines.join('\n');
    
    // Fix assignment operators
    fixed = fixed.replace(/===/g, '==');
    fixed = fixed.replace(/!==/g, '!=');
    
    // Fix boolean values
    fixed = fixed.replace(/\btrue\b/g, 'True');
    fixed = fixed.replace(/\bfalse\b/g, 'False');
    fixed = fixed.replace(/\bnull\b/g, 'None');
    fixed = fixed.replace(/\bundefined\b/g, 'None');
    
    // Fix 'new' keyword
    fixed = fixed.replace(/\bnew\s+/g, '');
    
    return fixed;
  }

  _isPurePython(code) {
    const jsArtifacts = [
      /\bvar\s+/,
      /\blet\s+/,
      /\bconst\s+/,
      /\bfunction\s+/,
      /{\s*$/m,
      /^\s*}\s*$/m,
      /\bnew\s+/,
      /===/,
      /!==/
    ];
    
    return !jsArtifacts.some(pattern => pattern.test(code));
  }

  _createPythonScript(scriptPath) {
    const pythonScript = `#!/usr/bin/env python3
import sys
import ast
import re

def fix_python_syntax(code):
    """Fix common Python syntax and indentation errors"""
    lines = code.splitlines()
    fixed_lines = []
    indent_level = 0
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        
        if not stripped or stripped.startswith('#'):
            fixed_lines.append(line)
            continue
            
        if re.match(r'^(elif|else|except|finally)\\b', stripped):
            indent_level = max(0, indent_level - 1)
            
        proper_indent = '    ' * indent_level
        fixed_line = proper_indent + stripped
        
        if re.match(r'^(if|elif|else|def|class|for|while|try|except|finally|with)\\b', stripped):
            if not stripped.endswith(':') and '#' not in stripped:
                fixed_line += ':'
                
        fixed_line = re.sub(r'^(\\s*)print\\s+([^\\(].+)$', r'\\1print(\\2)', fixed_line)
        
        fixed_line = re.sub(r'\\btrue\\b', 'True', fixed_line)
        fixed_line = re.sub(r'\\bfalse\\b', 'False', fixed_line)
        fixed_line = re.sub(r'\\bnull\\b', 'None', fixed_line)
        fixed_line = re.sub(r'\\bundefined\\b', 'None', fixed_line)
        
        fixed_lines.append(fixed_line)
        
        if stripped.endswith(':'):
            indent_level += 1
            
    return '\\n'.join(fixed_lines)

if __name__ == '__main__':
    input_code = sys.stdin.read()
    try:
        fixed_code = fix_python_syntax(input_code)
        try:
            ast.parse(fixed_code)
        except SyntaxError:
            fixed_code = input_code
        sys.stdout.write(fixed_code)
    except Exception:
        sys.stdout.write(input_code)
`;
    
    fs.writeFileSync(scriptPath, pythonScript, 'utf8');
  }
}

module.exports = PythonFixer;