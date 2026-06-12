/**
 * apply-diff.js
 * 
 * Implements Bob-style apply_diff tool with SEARCH/REPLACE blocks.
 * Supports multiple diff blocks in a single operation for efficient editing.
 */

const fs = require("fs").promises;
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const babelParser = require("@babel/parser");
const os = require("os");

/**
 * Parse diff string into structured blocks
 * Format:
 * <<<<<<< SEARCH
 * :start_line: N
 * -------
 * [search content]
 * =======
 * [replace content]
 * >>>>>>> REPLACE
 */
function parseDiffBlocks(diffString) {
  const blocks = [];
  const diffPattern = /<<<<<<< SEARCH\s*\n:start_line:\s*(\d+)\s*\n-------\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  
  let match;
  while ((match = diffPattern.exec(diffString)) !== null) {
    blocks.push({
      startLine: parseInt(match[1], 10),
      search: match[2],
      replace: match[3]
    });
  }
  
  if (blocks.length === 0) {
    throw new Error("No valid SEARCH/REPLACE blocks found in diff");
  }
  
  return blocks;
}

/**
 * Check if lines match the search block
 */
function matchesBlock(lines, startIndex, searchLines) {
  if (startIndex + searchLines.length > lines.length) {
    return false;
  }
  
  for (let i = 0; i < searchLines.length; i++) {
    if (lines[startIndex + i] !== searchLines[i]) {
      return false;
    }
  }
  
  return true;
}

/**
 * Normalize line endings for consistent matching
 */
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n");
}

function restoreLineEndings(text, prefersCrlf) {
  if (!prefersCrlf) {
    return text;
  }
  return text.replace(/\n/g, "\r\n");
}

/**
 * Get syntax check command for a file based on extension
 */
function commandExists(command, args = ["--version"]) {
  const probe = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true
  });

  return !probe.error && probe.status === 0;
}

function getSyntaxCheckInvocation(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
    return {
      command: process.execPath,
      args: ["--check", filePath]
    };
  }

  if (ext === ".py") {
    const pythonCandidates = process.platform === "win32"
      ? [
          { command: "python", probeArgs: ["--version"] },
          { command: "py", probeArgs: ["-3", "--version"], argsPrefix: ["-3"] }
        ]
      : [
          { command: "python3", probeArgs: ["--version"] },
          { command: "python", probeArgs: ["--version"] }
        ];

    for (const candidate of pythonCandidates) {
      if (commandExists(candidate.command, candidate.probeArgs)) {
        return {
          command: candidate.command,
          args: [...(candidate.argsPrefix || []), "-m", "py_compile", filePath]
        };
      }
    }

    return null;
  }

  if (ext === ".java") {
    if (!commandExists("javac")) {
      return null;
    }

    return {
      command: "javac",
      args: [filePath]
    };
  }

  // JSON is validated separately
  if (ext === ".json") {
    return null;
  }
  // HTML, CSS, and other files don't have simple CLI syntax checkers
  return null;
}

function validateJavaScriptLikeSyntax(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  const plugins = [
    "classProperties",
    "classPrivateProperties",
    "classPrivateMethods",
    "decorators-legacy",
    "dynamicImport",
    "importAttributes",
    "topLevelAwait"
  ];

  if (ext === ".jsx" || ext === ".tsx") {
    plugins.push("jsx");
  }
  if (ext === ".ts" || ext === ".tsx") {
    plugins.push("typescript");
  }

  try {
    babelParser.parse(content, {
      sourceType: "unambiguous",
      sourceFilename: path.basename(filePath),
      errorRecovery: false,
      plugins
    });
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: `Syntax error: ${err.message}`
    };
  }
}

/**
 * Validate syntax of content before writing to file
 * Returns { valid: true } or { valid: false, error: string }
 */
async function validateSyntax(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  
  // JSON validation
  if (ext === ".json") {
    try {
      JSON.parse(content);
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: `JSON syntax error: ${err.message}`
      };
    }
  }

  if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
    return validateJavaScriptLikeSyntax(filePath, content);
  }
  
  // Get syntax check command
  const invocation = getSyntaxCheckInvocation(filePath);
  if (!invocation) {
    // No syntax checker available for this file type
    return { valid: true };
  }
  
  // Write content to temp file and check syntax
  const tempName = `code-janitor-syntax-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
  const tempPath = path.join(os.tmpdir(), tempName);
  
  try {
    await fs.writeFile(tempPath, content, "utf8");
    
    // Run syntax check command
    const tempInvocation = getSyntaxCheckInvocation(tempPath);
    if (!tempInvocation) {
      await fs.unlink(tempPath).catch(() => {});
      return { valid: true };
    }

    try {
      execFileSync(tempInvocation.command, tempInvocation.args, {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 10000,
        windowsHide: true
      });
      
      // Command succeeded - syntax is valid
      await fs.unlink(tempPath).catch(() => {});
      return { valid: true };
    } catch (err) {
      if (err.code === "ENOENT") {
        await fs.unlink(tempPath).catch(() => {});
        return { valid: true };
      }

      // Command failed - syntax error
      await fs.unlink(tempPath).catch(() => {});
      
      // Extract error message
      const output = err.stderr || err.stdout || err.message || "Syntax check failed";
      return {
        valid: false,
        error: `Syntax error: ${output}`
      };
    }
  } catch (err) {
    // Failed to create temp file or other error
    await fs.unlink(tempPath).catch(() => {});
    return {
      valid: false,
      error: `Failed to validate syntax: ${err.message}`
    };
  }
}

/**
 * Apply a single diff block to the file lines
 */
function applySingleDiff(lines, block) {
  const { startLine, search, replace } = block;
  
  // Normalize search and replace content
  const searchNormalized = normalizeLineEndings(search);
  const replaceNormalized = normalizeLineEndings(replace);
  
  const searchLines = searchNormalized.split("\n");
  const replaceLines = replaceNormalized.split("\n");
  
  // Try exact match at specified line (1-based to 0-based)
  const searchStart = startLine - 1;

  // Check if search block matches at the specified location
  if (
    searchStart >= 0 &&
    searchStart < lines.length &&
    matchesBlock(lines, searchStart, searchLines)
  ) {
    // Replace the matched lines
    lines.splice(searchStart, searchLines.length, ...replaceLines);
    return {
      success: true,
      matchedAt: searchStart + 1, // Convert back to 1-based
      linesRemoved: searchLines.length,
      linesAdded: replaceLines.length
    };
  }
  
  // If exact match fails, try fuzzy search nearby (±5 lines)
  const searchRadius = 5;
  const searchMin = Math.max(0, searchStart - searchRadius);
  const searchMax = Math.min(lines.length - searchLines.length, searchStart + searchRadius);
  
  for (let i = searchMin; i <= searchMax; i++) {
    if (matchesBlock(lines, i, searchLines)) {
      lines.splice(i, searchLines.length, ...replaceLines);
      return {
        success: true,
        matchedAt: i + 1,
        linesRemoved: searchLines.length,
        linesAdded: replaceLines.length,
        warning: `Match found at line ${i + 1} instead of specified line ${startLine}`
      };
    }
  }

  // Fall back to a whole-file search when line anchors drift in larger files.
  // Only a unique global match is considered safe to apply automatically.
  const globalMatches = [];
  for (let i = 0; i <= lines.length - searchLines.length; i++) {
    if (matchesBlock(lines, i, searchLines)) {
      globalMatches.push(i);
    }
  }

  if (globalMatches.length === 1) {
    const matchIndex = globalMatches[0];
    lines.splice(matchIndex, searchLines.length, ...replaceLines);
    return {
      success: true,
      matchedAt: matchIndex + 1,
      linesRemoved: searchLines.length,
      linesAdded: replaceLines.length,
      warning: `Match found at line ${matchIndex + 1} after a whole-file search instead of specified line ${startLine}`
    };
  }

  if (globalMatches.length > 1) {
    throw new Error(
      `Search block matched ${globalMatches.length} locations, so Code Janitor could not apply it safely. ` +
      "Make the SEARCH block more specific."
    );
  }

  if (searchStart < 0 || searchStart >= lines.length) {
    throw new Error(`Start line ${startLine} is out of range (file has ${lines.length} lines)`);
  }
  
  throw new Error(
    `Search block not found at line ${startLine} or nearby.\n` +
    `Expected:\n${searchLines.slice(0, 3).join("\n")}${searchLines.length > 3 ? "\n..." : ""}`
  );
}

function applyDiffToContent(content, diffString) {
  const originalContent = typeof content === "string" ? content : "";
  const prefersCrlf = originalContent.includes("\r\n");
  const normalizedContent = normalizeLineEndings(originalContent);
  const lines = normalizedContent.split("\n");
  const blocks = parseDiffBlocks(diffString);

  blocks.sort((a, b) => b.startLine - a.startLine);

  const details = [];
  for (const block of blocks) {
    try {
      const result = applySingleDiff(lines, block);
      details.push(result);
    } catch (error) {
      throw new Error(`Failed to apply diff block at line ${block.startLine}: ${error.message}`);
    }
  }

  return {
    blocksApplied: details.length,
    details,
    finalLineCount: lines.length,
    previousContent: originalContent,
    newContent: restoreLineEndings(lines.join("\n"), prefersCrlf)
  };
}

/**
 * Apply multiple diff blocks to a file
 * Blocks are applied in reverse order (bottom to top) to maintain line numbers
 */
async function applyDiff(filePath, diffString, workspaceRoot) {
  // Resolve absolute path
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);
  
  // Read file content
  let content;
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error.message}`);
  }
  const diffResult = applyDiffToContent(content, diffString);
  const newContent = diffResult.newContent;
  
  // Validate syntax before writing
  const syntaxValidation = await validateSyntax(absolutePath, newContent);
  if (!syntaxValidation.valid) {
    throw new Error(
      `Refusing to apply syntax-invalid update to ${filePath}: ${syntaxValidation.error}`
    );
  }
  
  // Write back to file
  try {
    await fs.writeFile(absolutePath, newContent, "utf8");
  } catch (error) {
    throw new Error(`Failed to write file ${filePath}: ${error.message}`);
  }
  
  return {
    success: true,
    filePath: filePath,
    absolutePath,
    blocksApplied: diffResult.blocksApplied,
    details: diffResult.details,
    finalLineCount: diffResult.finalLineCount,
    previousContent: content,
    newContent
  };
}

/**
 * Validate diff format before applying
 */
function validateDiff(diffString) {
  try {
    const blocks = parseDiffBlocks(diffString);
    
    // Check for overlapping blocks
    const sortedBlocks = [...blocks].sort((a, b) => a.startLine - b.startLine);
    for (let i = 0; i < sortedBlocks.length - 1; i++) {
      const current = sortedBlocks[i];
      const next = sortedBlocks[i + 1];
      const currentSearchLines = current.search.split("\n").length;
      
      if (current.startLine + currentSearchLines > next.startLine) {
        return {
          valid: false,
          error: `Overlapping diff blocks: block at line ${current.startLine} overlaps with block at line ${next.startLine}`
        };
      }
    }
    
    return { valid: true, blockCount: blocks.length };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

module.exports = {
  applyDiff,
  applyDiffToContent,
  validateDiff,
  parseDiffBlocks,
  validateSyntax
};

// Made with Bob
