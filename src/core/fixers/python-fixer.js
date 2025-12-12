// src/core/fixers/python-fixer.js (or similar location)

const BaseFixer = require("./base-fixer");
const FormatterPaths = require('../formatter-paths');
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// --- HELPER FUNCTION: SPAWN COMMAND (Re-used from previous discussion) ---
/**
 * Executes a command, sends input via stdin, and captures stdout/stderr.
 */
function _spawnCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const { input, timeout = 20000, verbose, logError } = options;

    if (verbose) {
      console.log(`[Spawn] Running: ${command} ${args.join(" ")}`);
    }

    const child = spawn(command, args, {
      timeout: timeout
      // Ensure the spawned process uses the correct working directory if needed,
      // but for this script, standard piping is sufficient.
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // 1. Write Input to STDIN (The Code to be Fixed)
    child.stdin.write(input, (err) => {
      if (err && logError) {
        console.error(`[Spawn] Error writing to stdin: ${err.message}`);
      }
      child.stdin.end(); // Signal input is complete
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
      reject(
        new Error(
          `Failed to execute command: ${command}. Check installation and permissions. Error: ${err.message}`
        )
      );
    });

    // Timeout handling is usually implicit in spawn options but can be added explicitly here
  });
}

class PythonFixer extends BaseFixer {
  /**
   * @param {string} code - Original code text
   * @param {string} filePath - File path of the code
   * @param {object} options - Options object (e.g., { verbose: true })
   */
  constructor(code, filePath, options = {}) {
    super(code, filePath);
    this.options = options;
    // In this architecture, we rely on the bundled VENV, so we need the exact path.
    this.pythonExecutable = this._getBundledPythonPath();

    if (this.options.verbose) {
      console.log(
        `PythonFixer initialized. Using executable: ${this.pythonExecutable}`
      );
    }
  }

  /**
   * Determines the path to the Python executable.
   * Falls back to system Python if bundled version not found.
   * @returns {string} The path to Python executable.
   */
  _getBundledPythonPath() {
    const platform = os.platform();
    
    // Try bundled Python first
    const venvPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "formatters",
      "python-formatters",
      "venv"
    );

    let bundledPython;
    if (platform === "win32") {
      bundledPython = path.join(venvPath, "Scripts", "python.exe");
    } else {
      bundledPython = path.join(venvPath, "bin", "python");
    }

    // Check if bundled Python exists, otherwise fall back to system Python
    if (fs.existsSync(bundledPython)) {
      return bundledPython;
    }

    // Fallback to system Python
    return platform === "win32" ? "python" : "python3";
  }

  /**
   * The main analysis pipeline. Calls the external python-syntax-fixer.py script.
   * @returns {Promise<object>} Result object containing fixedCode and metadata.
   */
  async analyze() {
    const originalCode = this.code || "";

    try {
      // First apply inline fixes for syntax issues
      const inlineResult = this._tryInlineFixes(originalCode);
      
      // Use autopep8 only for pure Python code (no major structural changes)
      if (inlineResult.success && this._isPurePython(inlineResult.fixedCode)) {
        const autopep8Result = await this._tryAutopep8(inlineResult.fixedCode);
        if (autopep8Result.success) {
          return autopep8Result;
        }
      }
      
      if (inlineResult.success) {
        return inlineResult;
      }

      // Fallback to Python script for complex cases
      const scriptPath = path.join(__dirname, "python-syntax-fixer.py");
      
      // Create the Python script if it doesn't exist
      if (!fs.existsSync(scriptPath)) {
        this._createPythonScript(scriptPath);
      }

      const commandArgs = [scriptPath];
      const result = await _spawnCommand(this.pythonExecutable, commandArgs, {
        timeout: 30000,
        input: originalCode,
        verbose: this.options.verbose,
        logError: true
      });

      if (result.exitCode !== 0) {
        // If Python script fails, return inline result as fallback
        return inlineResult;
      }

      const fixedCode = result.stdout.trim();
      const appliedFixes = originalCode !== fixedCode ? 1 : 0;
      const message = appliedFixes > 0
        ? "Code successfully fixed and formatted."
        : "No syntax errors found or changes applied.";

      return {
        success: true,
        fixedCode: fixedCode,
        appliedFixes: appliedFixes,
        message: message
      };
    } catch (error) {
      console.error(`❌ Python Fixer Error: ${error.message}`);
      // Return inline fixes as fallback
      return this._tryInlineFixes(originalCode);
    }
  }

  /**
   * Try autopep8 formatting
   * @param {string} code - Code to format
   * @returns {object} Result object
   */
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

  /**
   * Try to fix common syntax and indentation issues inline
   * @param {string} code - Original code
   * @returns {object} Result object
   */
  _tryInlineFixes(code) {
    let fixedCode = code;
    let fixesApplied = 0;
    const originalCode = code;

    try {
      // Fix missing colons first
      const colonFixed = this._fixMissingColons(fixedCode);
      if (colonFixed !== fixedCode) {
        fixedCode = colonFixed;
        fixesApplied++;
      }

      // Fix print statements
      const printFixed = this._fixPrintStatements(fixedCode);
      if (printFixed !== fixedCode) {
        fixedCode = printFixed;
        fixesApplied++;
      }

      // Fix common syntax errors
      const syntaxFixed = this._fixCommonSyntaxErrors(fixedCode);
      if (syntaxFixed !== fixedCode) {
        fixedCode = syntaxFixed;
        fixesApplied++;
      }

      // Fix indentation issues last
      const indentFixed = this._fixIndentation(fixedCode);
      if (indentFixed !== fixedCode) {
        fixedCode = indentFixed;
        fixesApplied++;
      }

      // Count total changes
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

  /**
   * Fix indentation issues
   */
  _fixIndentation(code) {
    const lines = code.split('\n');
    const fixedLines = [];
    let indentLevel = 0;
    const indentSize = 4;
    let inClass = false;
    let classIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith('#')) {
        fixedLines.push(line);
        continue;
      }

      // Handle class definitions
      if (/^class\s+/.test(trimmed)) {
        indentLevel = 0;
        inClass = true;
        classIndent = 0;
      }
      // Handle method definitions in class
      else if (inClass && /^def\s+/.test(trimmed)) {
        indentLevel = 1; // Methods are indented once inside class
      }
      // Handle dedent keywords
      else if (/^(elif|else|except|finally)\b/.test(trimmed)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }
      // Handle function definitions at module level
      else if (!inClass && /^def\s+/.test(trimmed)) {
        indentLevel = 0;
        inClass = false;
      }

      // Apply proper indentation
      const properIndent = ' '.repeat(indentLevel * indentSize);
      fixedLines.push(properIndent + trimmed);

      // Increase indent after colon
      if (trimmed.endsWith(':')) {
        indentLevel++;
      }
      
      // Reset class context for top-level statements
      if (!trimmed.startsWith(' ') && !trimmed.endsWith(':') && !/^(class|def)\s+/.test(trimmed)) {
        if (indentLevel === 0) {
          inClass = false;
        }
      }
    }

    return fixedLines.join('\n');
  }

  /**
   * Fix missing colons after control structures
   */
  _fixMissingColons(code) {
    const lines = code.split('\n');
    const fixedLines = lines.map(line => {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        return line;
      }
      
      // Check for control structures missing colons
      if (/^(if|elif|else|def|class|for|while|try|except|finally|with)\b/.test(trimmed)) {
        // Don't add colon if line already has one or has inline comment
        if (!trimmed.endsWith(':') && !trimmed.includes('#')) {
          // Handle multiline function definitions
          if (/^def\s+.*\(.*\)\s*$/.test(trimmed)) {
            return line.replace(trimmed, trimmed + ':');
          }
          // Handle other control structures
          else if (!/^def\s+.*\($/.test(trimmed)) {
            return line.replace(trimmed, trimmed + ':');
          }
        }
      }
      
      return line;
    });
    
    return fixedLines.join('\n');
  }

  /**
   * Fix Python 2 style print statements
   */
  _fixPrintStatements(code) {
    return code.replace(/^(\s*)print\s+([^\(\n]+)$/gm, '$1print($2)');
  }

  /**
   * Fix common syntax errors
   */
  _fixCommonSyntaxErrors(code) {
    let fixed = code;
    
    // Remove JavaScript keywords
    fixed = fixed.replace(/^(\s*)(var|let|const|function)\s+/gm, '$1');
    
    // Remove JavaScript braces and fix structure
    fixed = fixed.replace(/\s*{\s*$/gm, ':');
    fixed = fixed.replace(/^(\s*)}\s*$/gm, '');
    
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

  /**
   * Post-process autopep8 output to fix structural issues
   */
  _postProcessAutopep8(code) {
    const lines = code.split('\n');
    const fixedLines = [];
    let indentLevel = 0;
    const indentSize = 4;
    let inFunction = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (!trimmed) {
        // Skip excessive empty lines, especially after function definitions
        if (i > 0 && fixedLines.length > 0) {
          const lastLine = fixedLines[fixedLines.length - 1].trim();
          if (lastLine.endsWith(':') && inFunction) {
            continue; // Skip empty line after function def
          }
        }
        fixedLines.push('');
        continue;
      }
      
      if (trimmed.startsWith('#')) {
        fixedLines.push(line);
        continue;
      }

      // Track function definitions
      if (/^def\s+/.test(trimmed)) {
        inFunction = true;
        indentLevel = 0;
      }

      // Handle dedent keywords
      if (/^(elif|else|except|finally)\b/.test(trimmed)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      // Apply proper indentation
      const properIndent = ' '.repeat(indentLevel * indentSize);
      fixedLines.push(properIndent + trimmed);

      // Increase indent after colon
      if (trimmed.endsWith(':')) {
        indentLevel++;
        if (inFunction && /^def\s+/.test(trimmed)) {
          inFunction = false; // We're now inside the function
        }
      }
    }

    return fixedLines.join('\n');
  }

  /**
   * Check if code is pure Python (no major JS artifacts)
   */
  _isPurePython(code) {
    // Check for remaining JavaScript artifacts
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

  /**
   * Create the Python syntax fixer script
   */
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
            
        # Fix indentation
        if re.match(r'^(elif|else|except|finally)\\b', stripped):
            indent_level = max(0, indent_level - 1)
            
        proper_indent = '    ' * indent_level
        fixed_line = proper_indent + stripped
        
        # Fix missing colons
        if re.match(r'^(if|elif|else|def|class|for|while|try|except|finally|with)\\b', stripped):
            if not stripped.endswith(':') and '#' not in stripped:
                fixed_line += ':'
                
        # Fix print statements
        fixed_line = re.sub(r'^(\\s*)print\\s+([^\\(].+)$', r'\\1print(\\2)', fixed_line)
        
        # Fix common syntax issues
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
        # Try to parse to validate
        try:
            ast.parse(fixed_code)
        except SyntaxError:
            # If still invalid, return original
            fixed_code = input_code
        sys.stdout.write(fixed_code)
    except Exception:
        sys.stdout.write(input_code)
`;
    
    fs.writeFileSync(scriptPath, pythonScript, 'utf8');
  }
}

module.exports = PythonFixer;
