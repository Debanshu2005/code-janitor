const path = require('path');
const fs = require('fs-extra');

class FormatterPaths {
  static getUncrustifyPath() {
    const basePath = path.join(__dirname, 'uncrustify');
    const exeName = process.platform === 'win32' ? 'uncrustify.exe' : 'uncrustify';
    const exePath = path.join(basePath, 'bin', exeName);
    if (fs.existsSync(exePath)) return exePath;
    return 'uncrustify'; // fallback to system PATH
  }

  static getJavaFormatterPath() {
    const jarPath = path.join(__dirname, 'google-java-format', 'google-java-format.jar');
    if (fs.existsSync(jarPath)) return jarPath;
    return 'google-java-format'; // fallback
  }

  static getPythonPath() {
    // Portable Python runtime bundled for Black
    const basePath = path.join(__dirname, 'black', 'python');
    const exePath =
      process.platform === 'win32'
        ? path.join(basePath, 'python.exe')
        : path.join(basePath, 'bin', 'python3');
    if (fs.existsSync(exePath)) return exePath;
    return 'python3'; // fallback
  }

  static getBlackPath() {
    // Black module inside the portable Python environment
    return '-m black';
  }

  static getAutopep8Path() {
    // Try bundled autopep8 first
    const venvPath = path.join(__dirname, '..', '..', 'formatters', 'python-formatters', 'venv');
    const autopep8Path = process.platform === 'win32' 
      ? path.join(venvPath, 'Scripts', 'autopep8.exe')
      : path.join(venvPath, 'bin', 'autopep8');
    
    if (fs.existsSync(autopep8Path)) {
      return autopep8Path;
    }
    
    // Fallback to system autopep8
    return 'autopep8';
  }

  static getPrettierPath() {
    // Node bundled Prettier CLI
    try {
      return require.resolve('prettier/bin-prettier.js');
    } catch (err) {
      return 'prettier'; // fallback
    }
  }

  static getPrettierModule() {
    // Cache the result to avoid repeated require.resolve calls
    if (!this._prettierModulePath) {
      try {
        this._prettierModulePath = require.resolve('prettier');
      } catch (err) {
        try {
          const formatterPath = path.join(__dirname, '..', '..', 'formatters', 'prettier', 'node_modules', 'prettier');
          this._prettierModulePath = require.resolve(formatterPath);
        } catch (err2) {
          this._prettierModulePath = null;
        }
      }
    }
    return this._prettierModulePath;
  }

  // 🔥 New: HTML uses Prettier, so just point to Prettier path
  static getHtmlFormatterPath() {
    return this.getPrettierPath();
  }
}

module.exports = FormatterPaths;
