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

  static getPrettierPath() {
    // Node bundled Prettier directly
    try {
      return require.resolve('prettier/bin-prettier.js');
    } catch (err) {
      return 'prettier'; // fallback
    }
  }

  // 🔥 New: HTML uses Prettier, so just point to Prettier path
  static getHtmlFormatterPath() {
    return this.getPrettierPath();
  }
}

module.exports = FormatterPaths;
