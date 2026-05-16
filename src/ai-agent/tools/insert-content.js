/**
 * insert-content.js
 * 
 * Implements Bob-style insert_content tool for adding lines to files.
 * Supports inserting at specific line numbers or appending to end.
 */

const fs = require("fs").promises;
const path = require("path");

/**
 * Normalize line endings for consistent handling
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

function insertContentIntoText(fileContent, lineNumber, content) {
  if (typeof lineNumber !== "number" || lineNumber < 0) {
    throw new Error(`Invalid line number: ${lineNumber}. Must be 0 (append) or positive integer.`);
  }

  const originalContent = typeof fileContent === "string" ? fileContent : "";
  const prefersCrlf = originalContent.includes("\r\n");
  const normalizedFile = normalizeLineEndings(originalContent);
  const normalizedContent = normalizeLineEndings(content);
  const lines = normalizedFile.split("\n");

  if (lineNumber > lines.length) {
    throw new Error(
      `Line number ${lineNumber} is out of range. File has ${lines.length} lines. ` +
      `Use 0 to append to end, or 1-${lines.length} to insert before a specific line.`
    );
  }

  const contentLines = normalizedContent.split("\n");
  let insertPosition;

  if (lineNumber === 0) {
    lines.push(...contentLines);
    insertPosition = lines.length - contentLines.length + 1;
  } else {
    const insertIndex = lineNumber - 1;
    lines.splice(insertIndex, 0, ...contentLines);
    insertPosition = lineNumber;
  }

  return {
    insertedAt: insertPosition,
    linesInserted: contentLines.length,
    finalLineCount: lines.length,
    operation: lineNumber === 0 ? "append" : "insert",
    previousContent: originalContent,
    newContent: restoreLineEndings(lines.join("\n"), prefersCrlf)
  };
}

/**
 * Insert content at a specific line in a file
 * 
 * @param {string} filePath - Path to file (relative to workspace)
 * @param {number} lineNumber - Line number to insert before (1-based), or 0 to append
 * @param {string} content - Content to insert
 * @param {string} workspaceRoot - Workspace root directory
 * @returns {Promise<Object>} Result object with success status and details
 */
async function insertContent(filePath, lineNumber, content, workspaceRoot) {
  // Resolve absolute path
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);
  
  // Read file content
  let fileContent;
  try {
    fileContent = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error.message}`);
  }
  const result = insertContentIntoText(fileContent, lineNumber, content);
  
  // Write back to file
  try {
    await fs.writeFile(absolutePath, result.newContent, "utf8");
  } catch (error) {
    throw new Error(`Failed to write file ${filePath}: ${error.message}`);
  }
  
  return {
    success: true,
    filePath: filePath,
    absolutePath,
    insertedAt: result.insertedAt,
    linesInserted: result.linesInserted,
    finalLineCount: result.finalLineCount,
    operation: result.operation,
    previousContent: result.previousContent,
    newContent: result.newContent
  };
}

/**
 * Validate insert operation before executing
 */
async function validateInsert(filePath, lineNumber, workspaceRoot) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);
  
  try {
    const fileContent = await fs.readFile(absolutePath, "utf8");
    const lines = normalizeLineEndings(fileContent).split("\n");
    
    if (lineNumber < 0) {
      return {
        valid: false,
        error: "Line number must be 0 (append) or positive integer"
      };
    }
    
    if (lineNumber > lines.length) {
      return {
        valid: false,
        error: `Line number ${lineNumber} exceeds file length (${lines.length} lines)`
      };
    }
    
    return {
      valid: true,
      fileLineCount: lines.length,
      operation: lineNumber === 0 ? "append" : "insert"
    };
  } catch (error) {
    return {
      valid: false,
      error: `Cannot access file: ${error.message}`
    };
  }
}

module.exports = {
  insertContent,
  insertContentIntoText,
  validateInsert
};

// Made with Bob
