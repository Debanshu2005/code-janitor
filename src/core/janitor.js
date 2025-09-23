// src/core/janitor.js - CORRECTED IMPORTS
const path = require('path');
const fs = require('fs').promises;

// FIXED: Import from the specific index file
const { getFixerForFile } = require('./fixers/index');
const { findFiles } = require('../utils/file-finder');

// ... the rest of your janitor.js code remains the same
/**
 * Analyze and fix a single file
 * @param {string} filePath - Path to the file
 * @returns {Promise<number>} - Number of fixes applied
 */
async function analyzeAndFixFile(filePath) {
  const FixerClass = getFixerForFile(filePath);
  
  if (!FixerClass) {
    return 0; // Unsupported file type
  }

  try {
    const code = await fs.readFile(filePath, 'utf-8');
    const fixer = new FixerClass(code, filePath);
    
    await fixer.analyze();
    const fixedCode = fixer.applyFixes();
    
    if (code !== fixedCode) {
      await fs.writeFile(filePath, fixedCode);
      return fixer.fixes.length;
    }
    
    return 0;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return 0;
  }
}

/**
 * Analyze and fix all supported files in a directory
 * @param {string} directoryPath - Path to the directory
 * @returns {Promise<Object>} - Results summary
 */
async function analyzeAndFixDirectory(directoryPath) {
  const supportedExtensions = Object.keys(require('./fixers').FIXER_MAP);
  const files = await findFiles(directoryPath, supportedExtensions);
  
  let totalFixes = 0;
  const processedFiles = [];
  
  for (const filePath of files) {
    const fixes = await analyzeAndFixFile(filePath);
    if (fixes > 0) {
      totalFixes += fixes;
      processedFiles.push(filePath);
    }
  }
  
  return {
    totalFixes,
    filesProcessed: files.length,
    filesFixed: processedFiles.length,
    fixedFiles: processedFiles
  };
}

module.exports = {
  analyzeAndFixFile,
  analyzeAndFixDirectory
};