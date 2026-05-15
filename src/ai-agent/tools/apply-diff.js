/**
 * apply-diff.js
 * 
 * Implements Bob-style apply_diff tool with SEARCH/REPLACE blocks.
 * Supports multiple diff blocks in a single operation for efficient editing.
 */

const fs = require("fs").promises;
const path = require("path");

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

/**
 * Apply a single diff block to the file lines
 */
function applySingleDiff(lines, block, prefersCrlf) {
  const { startLine, search, replace } = block;
  
  // Normalize search and replace content
  const searchNormalized = normalizeLineEndings(search);
  const replaceNormalized = normalizeLineEndings(replace);
  
  const searchLines = searchNormalized.split("\n");
  const replaceLines = replaceNormalized.split("\n");
  
  // Try exact match at specified line (1-based to 0-based)
  const searchStart = startLine - 1;
  
  if (searchStart < 0 || searchStart >= lines.length) {
    throw new Error(`Start line ${startLine} is out of range (file has ${lines.length} lines)`);
  }
  
  // Check if search block matches at the specified location
  if (matchesBlock(lines, searchStart, searchLines)) {
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
  
  throw new Error(
    `Search block not found at line ${startLine} or nearby.\n` +
    `Expected:\n${searchLines.slice(0, 3).join("\n")}${searchLines.length > 3 ? "\n..." : ""}`
  );
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
  
  // Detect line ending preference
  const prefersCrlf = content.includes("\r\n");
  
  // Normalize and split into lines
  const normalizedContent = normalizeLineEndings(content);
  const lines = normalizedContent.split("\n");
  
  // Parse diff blocks
  const blocks = parseDiffBlocks(diffString);
  
  // Sort blocks by start line in descending order (apply bottom to top)
  blocks.sort((a, b) => b.startLine - a.startLine);
  
  // Apply each block
  const results = [];
  for (const block of blocks) {
    try {
      const result = applySingleDiff(lines, block, prefersCrlf);
      results.push(result);
    } catch (error) {
      throw new Error(`Failed to apply diff block at line ${block.startLine}: ${error.message}`);
    }
  }
  
  // Reconstruct file content
  let newContent = lines.join("\n");
  
  // Restore original line endings if needed
  if (prefersCrlf) {
    newContent = newContent.replace(/\n/g, "\r\n");
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
    blocksApplied: results.length,
    details: results,
    finalLineCount: lines.length
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
  validateDiff,
  parseDiffBlocks
};

// Made with Bob
