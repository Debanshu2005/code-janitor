// src/core/fixers/fixer-wrapper.js
const PythonFixer = require('./python-fixer');
const JavaScriptFixer = require('./javascript-fixer');
const EmbeddedCFixer = require('./EmbeddedCFixer');
const JavaFixer = require('./JavaFixer');

async function fixPythonBuffer(code, filePath = '') {
  const fixer = new PythonFixer(code, filePath);
  await fixer.analyze();
  return fixer.applyFixes();
}

async function fixJSBuffer(code, filePath = '') {
  const fixer = new JavaScriptFixer(code, filePath);
  await fixer.analyze();
  return fixer.applyFixes();
}

async function fixEmbeddedCBuffer(code, filePath = '') {
  const fixer = new EmbeddedCFixer(code, filePath);
  await fixer.analyze();
  return fixer.applyFixes();
}

async function fixJavaBuffer(code, filePath = '') {
  const fixer = new JavaFixer(code, filePath);
  await fixer.analyze();
  return fixer.applyFixes();
}

module.exports = {
  fixPythonBuffer,
  fixJSBuffer,
  fixEmbeddedCBuffer,
  fixJavaBuffer
};