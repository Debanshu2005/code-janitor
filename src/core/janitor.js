const fs = require("fs").promises;

const {
  FIXER_MAP,
  getFixerForFile,
  isFileTypeSupported
} = require("./fixers/index");
const { findFiles } = require("../utils/file-finder");

function resolveAppliedFixCount(result, fixer, modified) {
  if (!modified) {
    return 0;
  }

  if (Number.isFinite(result && result.appliedFixes)) {
    return result.appliedFixes;
  }

  if (typeof fixer.getFixCount === "function") {
    const fixCount = fixer.getFixCount();
    if (Number.isFinite(fixCount) && fixCount > 0) {
      return fixCount;
    }
  }

  return Array.isArray(fixer.fixes) && fixer.fixes.length > 0 ? fixer.fixes.length : 1;
}

async function analyzeFile(filePath, options = {}) {
  const { write = true } = options;
  const FixerClass = getFixerForFile(filePath);

  if (!FixerClass) {
    return {
      filePath,
      supported: false,
      modified: false,
      written: false,
      fixCount: 0,
      error: null
    };
  }

  try {
    const code = await fs.readFile(filePath, "utf-8");
    const fixer = new FixerClass(code, filePath);
    const result = await fixer.analyze();
    const fixedCode =
      result && typeof result.fixedCode === "string"
        ? result.fixedCode
        : result && typeof result.formatted === "string"
          ? result.formatted
          : fixer.applyFixes();
    const modified = code !== fixedCode;
    const fixCount = resolveAppliedFixCount(result, fixer, modified);

    if (modified && write) {
      await fs.writeFile(filePath, fixedCode);
    }

    return {
      filePath,
      supported: true,
      modified,
      written: modified && write,
      fixCount,
      error: null
    };
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return {
      filePath,
      supported: true,
      modified: false,
      written: false,
      fixCount: 0,
      error: error.message
    };
  }
}

async function collectSupportedFiles(targetPath) {
  const stats = await fs.stat(targetPath);

  if (stats.isDirectory()) {
    return findFiles(targetPath, Object.keys(FIXER_MAP));
  }

  if (stats.isFile()) {
    return isFileTypeSupported(targetPath) ? [targetPath] : [];
  }

  return [];
}

function summarizeTargetResults(targetPath, fileResults, options = {}) {
  const { write = true } = options;
  const changedFiles = fileResults.filter((result) => result.modified);
  const writtenFiles = fileResults.filter((result) => result.written);
  const errors = fileResults
    .filter((result) => result.error)
    .map((result) => ({
      filePath: result.filePath,
      message: result.error
    }));

  return {
    targetPath,
    mode: write ? "write" : "check",
    filesProcessed: fileResults.length,
    filesFixed: changedFiles.length,
    filesWritten: writtenFiles.length,
    totalFixes: fileResults.reduce((sum, result) => sum + result.fixCount, 0),
    fixedFiles: changedFiles.map((result) => result.filePath),
    writtenFiles: writtenFiles.map((result) => result.filePath),
    skippedFiles: fileResults
      .filter((result) => result.supported === false)
      .map((result) => result.filePath),
    errors,
    fileResults
  };
}

async function analyzeTarget(targetPath, options = {}) {
  const files = await collectSupportedFiles(targetPath);
  const fileResults = [];

  for (const filePath of files) {
    fileResults.push(await analyzeFile(filePath, options));
  }

  return summarizeTargetResults(targetPath, fileResults, options);
}

async function analyzeAndFixFile(filePath) {
  const result = await analyzeFile(filePath, { write: true });
  return result.fixCount;
}

async function analyzeAndFixDirectory(directoryPath) {
  return analyzeTarget(directoryPath, { write: true });
}

module.exports = {
  analyzeFile,
  analyzeTarget,
  analyzeAndFixFile,
  analyzeAndFixDirectory
};
