const fs = require("fs").promises;

const { getFixerForFile } = require("./fixers/index");
const { findFiles } = require("../utils/file-finder");

async function analyzeAndFixFile(filePath) {
  const FixerClass = getFixerForFile(filePath);
  if (!FixerClass) {
    return 0;
  }

  try {
    const code = await fs.readFile(filePath, "utf-8");
    const fixer = new FixerClass(code, filePath);
    const result = await fixer.analyze();
    const fixedCode =
      (result && typeof result.fixedCode === "string" && result.fixedCode) ||
      (result && typeof result.formatted === "string" && result.formatted) ||
      fixer.applyFixes();

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

async function analyzeAndFixDirectory(directoryPath) {
  const supportedExtensions = Object.keys(require("./fixers").FIXER_MAP);
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
