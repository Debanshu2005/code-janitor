const JavaScriptFixer = require('./javascript-fixer');
const PythonFixer = require('./python-fixer');
const EmbeddedCFixer = require('./EmbeddedCFixer');
const JavaFixer = require('./java-fixer');

// Map file extensions to their respective fixer classes
const FIXER_MAP = {
  '.js': JavaScriptFixer,
  '.jsx': JavaScriptFixer,
  '.ts': JavaScriptFixer,
  '.tsx': JavaScriptFixer,
  '.py': PythonFixer,
  '.c': EmbeddedCFixer,
  '.cpp': EmbeddedCFixer,
  '.cc': EmbeddedCFixer,
  '.cxx': EmbeddedCFixer,
  '.h': EmbeddedCFixer,
  '.hpp': EmbeddedCFixer,
  '.ino': EmbeddedCFixer,
  '.pde': EmbeddedCFixer,
  '.java': JavaFixer,
  // Add more languages here as you implement them
  // '.rb': RubyFixer,
  // '.php': PHPFixer,
  // '.go': GoFixer,
  // '.rs': RustFixer,
};

/**
 * Get the appropriate fixer for a file based on its extension
 * @param {string} filePath - Path to the file
 * @returns {BaseFixer|null} - The fixer class or null if not supported
 */
function getFixerForFile(filePath) {
  const path = require('path');
  const ext = path.extname(filePath).toLowerCase();
  return FIXER_MAP[ext] || null;
}

/**
 * Check if a file extension is supported
 * @param {string} filePath - Path to the file
 * @returns {boolean} - True if the file type is supported
 */
function isFileTypeSupported(filePath) {
  const path = require('path');
  const ext = path.extname(filePath).toLowerCase();
  return FIXER_MAP.hasOwnProperty(ext);
}

/**
 * Get all supported file extensions
 * @returns {string[]} - Array of supported file extensions
 */
function getSupportedExtensions() {
  return Object.keys(FIXER_MAP);
}

module.exports = {
  FIXER_MAP,
  getFixerForFile,
  isFileTypeSupported,
  getSupportedExtensions,
  JavaScriptFixer,
  PythonFixer,
  EmbeddedCFixer,
  JavaFixer
};