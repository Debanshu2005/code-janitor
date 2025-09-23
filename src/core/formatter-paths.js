const path = require('path');
const fs = require('fs-extra');

class FormatterPaths {
  static getUncrustifyPath() {
    const basePath = path.join(__dirname, '..', '..', 'formatters', 'uncrustify');
    
    // Look for the uncrustify executable
    if (process.platform === 'win32') {
      const exePath = path.join(basePath, 'uncrustify-0.81.0_f-win64', 'bin', 'uncrustify.exe');
      if (fs.existsSync(exePath)) return exePath;
      
      // Try alternative path structure
      const altPath = path.join(basePath, 'bin', 'uncrustify.exe');
      if (fs.existsSync(altPath)) return altPath;
    } else {
      const unixPath = path.join(basePath, 'uncrustify-0.81.0_f-' + (process.platform === 'darwin' ? 'macOS' : 'linux'), 'bin', 'uncrustify');
      if (fs.existsSync(unixPath)) return unixPath;
      
      const altPath = path.join(basePath, 'bin', 'uncrustify');
      if (fs.existsSync(altPath)) return altPath;
    }
    
    // Fallback to system PATH
    return 'uncrustify';
  }

  static getJavaFormatterPath() {
    const jarPath = path.join(__dirname, '..', '..', 'formatters', 'google-java-format', 'google-java-format.jar');
    if (fs.existsSync(jarPath)) return jarPath;
    return 'google-java-format';
  }

  static getBlackPath() {
    const basePath = path.join(__dirname, '..', '..', 'formatters', 'black');
    
    if (process.platform === 'win32') {
      const exePath = path.join(basePath, 'venv', 'Scripts', 'black.exe');
      if (fs.existsSync(exePath)) return exePath;
    } else {
      const unixPath = path.join(basePath, 'venv', 'bin', 'black');
      if (fs.existsSync(unixPath)) return unixPath;
    }
    
    return 'black';
  }

  static getPrettierPath() {
    const basePath = path.join(__dirname, '..', '..', 'formatters', 'prettier');
    const nodeModulesPath = path.join(basePath, 'node_modules', '.bin', 'prettier');
    
    if (process.platform === 'win32') {
      const exePath = nodeModulesPath + '.CMD';
      if (fs.existsSync(exePath)) return exePath;
    } else {
      if (fs.existsSync(nodeModulesPath)) return nodeModulesPath;
    }
    
    return 'prettier';
  }
}

module.exports = FormatterPaths;