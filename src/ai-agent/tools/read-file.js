/**
 * read-file.js
 * 
 * Implements Bob-style read_file tool with line range support and multi-file reading.
 * Supports reading up to 5 files in a single operation with optional line ranges.
 */

const fs = require("fs").promises;
const path = require("path");

const MAX_FILES_PER_REQUEST = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Parse line range string (e.g., "1-100", "50-75")
 */
function parseLineRange(rangeStr) {
  const match = rangeStr.match(/^(\d+)-(\d+)$/);
  if (!match) {
    throw new Error(`Invalid line range format: ${rangeStr}. Expected format: "start-end" (e.g., "1-100")`);
  }
  
  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  
  if (start < 1) {
    throw new Error(`Line range start must be >= 1, got ${start}`);
  }
  
  if (end < start) {
    throw new Error(`Line range end (${end}) must be >= start (${start})`);
  }
  
  return { start, end };
}

/**
 * Extract lines from content based on ranges
 */
function extractLines(content, ranges) {
  const lines = content.split("\n");
  
  if (!ranges || ranges.length === 0) {
    // Return all lines with line numbers
    return lines.map((line, idx) => `${idx + 1} | ${line}`).join("\n");
  }
  
  // Extract specified ranges
  const result = [];
  
  for (const rangeStr of ranges) {
    const { start, end } = parseLineRange(rangeStr);
    
    if (start > lines.length) {
      result.push(`[Line range ${start}-${end} exceeds file length (${lines.length} lines)]`);
      continue;
    }
    
    const actualEnd = Math.min(end, lines.length);
    
    for (let i = start - 1; i < actualEnd; i++) {
      result.push(`${i + 1} | ${lines[i]}`);
    }
    
    // Add separator between ranges if there are multiple
    if (ranges.length > 1 && rangeStr !== ranges[ranges.length - 1]) {
      result.push("...");
    }
  }
  
  return result.join("\n");
}

/**
 * Check if file is binary
 */
function isBinaryFile(buffer) {
  // Check for null bytes in first 8KB
  const sample = buffer.slice(0, 8192);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Read a single file with optional line ranges
 */
async function readSingleFile(fileSpec, workspaceRoot) {
  const { path: filePath, lineRanges } = fileSpec;
  
  // Resolve absolute path
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);
  
  try {
    // Check file size
    const stats = await fs.stat(absolutePath);
    
    if (stats.size > MAX_FILE_SIZE) {
      return {
        path: filePath,
        error: `File too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
        size: stats.size
      };
    }
    
    // Read file
    const buffer = await fs.readFile(absolutePath);
    
    // Check if binary
    if (isBinaryFile(buffer)) {
      return {
        path: filePath,
        error: "Binary file detected. Cannot display content.",
        size: stats.size,
        isBinary: true
      };
    }
    
    // Convert to string
    const content = buffer.toString("utf8");
    
    // Extract lines based on ranges
    const extractedContent = extractLines(content, lineRanges);
    
    const totalLines = content.split("\n").length;
    const displayedLines = extractedContent.split("\n").length;
    
    return {
      path: filePath,
      content: extractedContent,
      totalLines: totalLines,
      displayedLines: displayedLines,
      size: stats.size,
      ranges: lineRanges || ["all"]
    };
  } catch (error) {
    return {
      path: filePath,
      error: error.message
    };
  }
}

/**
 * Read multiple files with optional line ranges
 * 
 * @param {Array} fileSpecs - Array of file specifications
 *   Each spec: { path: string, lineRanges?: string[] }
 * @param {string} workspaceRoot - Workspace root directory
 * @returns {Promise<Object>} Results for all files
 */
async function readFiles(fileSpecs, workspaceRoot) {
  // Validate input
  if (!Array.isArray(fileSpecs) || fileSpecs.length === 0) {
    throw new Error("fileSpecs must be a non-empty array");
  }
  
  if (fileSpecs.length > MAX_FILES_PER_REQUEST) {
    throw new Error(
      `Too many files requested (${fileSpecs.length}). Maximum is ${MAX_FILES_PER_REQUEST} files per request.`
    );
  }
  
  // Validate each file spec
  for (const spec of fileSpecs) {
    if (!spec.path) {
      throw new Error("Each file spec must have a \"path\" property");
    }
  }
  
  // Read all files in parallel
  const results = await Promise.all(
    fileSpecs.map(spec => readSingleFile(spec, workspaceRoot))
  );
  
  // Compile summary
  const successful = results.filter(r => !r.error).length;
  const failed = results.filter(r => r.error).length;
  const totalSize = results.reduce((sum, r) => sum + (r.size || 0), 0);
  
  return {
    success: failed === 0,
    filesRead: successful,
    filesFailed: failed,
    totalFiles: results.length,
    totalSize: totalSize,
    results: results
  };
}

/**
 * Format results for display
 */
function formatResults(results) {
  const lines = [];
  
  lines.push(`Files read: ${results.filesRead}/${results.totalFiles}`);
  if (results.filesFailed > 0) {
    lines.push(`Failed: ${results.filesFailed}`);
  }
  lines.push(`Total size: ${Math.round(results.totalSize / 1024)}KB`);
  lines.push("");
  
  for (const result of results.results) {
    lines.push(`# ${result.path}`);
    
    if (result.error) {
      lines.push(`Error: ${result.error}`);
    } else {
      lines.push(`Lines: ${result.displayedLines}/${result.totalLines}`);
      if (result.ranges && result.ranges[0] !== "all") {
        lines.push(`Ranges: ${result.ranges.join(", ")}`);
      }
      lines.push("");
      lines.push(result.content);
    }
    
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  
  return lines.join("\n");
}

module.exports = {
  readFiles,
  readSingleFile,
  formatResults,
  parseLineRange,
  MAX_FILES_PER_REQUEST
};

// Made with Bob
