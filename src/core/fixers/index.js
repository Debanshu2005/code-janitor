const JavaScriptFixer = require("./javascript-fixer");
const PythonFixer = require("./python-fixer");
const EmbeddedCFixer = require("./EmbeddedCFixer");
const JavaFixer = require("./JavaFixer");
const HtmlFixer = require("./html-fixer");

const FIXER_MAP = {
  ".js": JavaScriptFixer,
  ".jsx": JavaScriptFixer,
  ".ts": JavaScriptFixer,
  ".tsx": JavaScriptFixer,
  ".py": PythonFixer,
  ".c": EmbeddedCFixer,
  ".cpp": EmbeddedCFixer,
  ".cc": EmbeddedCFixer,
  ".cxx": EmbeddedCFixer,
  ".h": EmbeddedCFixer,
  ".hpp": EmbeddedCFixer,
  ".ino": EmbeddedCFixer,
  ".pde": EmbeddedCFixer,
  ".java": JavaFixer,
  ".html": HtmlFixer
};

function getFixerForFile(filePath) {
  const path = require("path");
  const ext = path.extname(filePath).toLowerCase();
  return FIXER_MAP[ext] || null;
}

function isFileTypeSupported(filePath) {
  const path = require("path");
  const ext = path.extname(filePath).toLowerCase();
  return Object.prototype.hasOwnProperty.call(FIXER_MAP, ext);
}

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
  JavaFixer,
  HtmlFixer
};
