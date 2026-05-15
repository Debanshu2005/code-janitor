/**
 * tools/index.js
 * 
 * Central export point for all Bob-style tools
 */

const { applyDiff, validateDiff, parseDiffBlocks } = require("./apply-diff");
const { insertContent, validateInsert } = require("./insert-content");
const { readFiles, readSingleFile, formatResults, parseLineRange, MAX_FILES_PER_REQUEST } = require("./read-file");
const {
  updateTodoList,
  normalizeTodoItems,
  buildTodoSummary,
  VALID_TODO_STATUSES,
  MAX_TODO_ITEMS
} = require("./update-todo-list");
const { registry, ToolRegistry, TOOL_DEFINITIONS } = require("./tool-registry");

module.exports = {
  // Apply Diff
  applyDiff,
  validateDiff,
  parseDiffBlocks,
  
  // Insert Content
  insertContent,
  validateInsert,
  
  // Read File
  readFiles,
  readSingleFile,
  formatResults,
  parseLineRange,
  MAX_FILES_PER_REQUEST,

  // Todo List
  updateTodoList,
  normalizeTodoItems,
  buildTodoSummary,
  VALID_TODO_STATUSES,
  MAX_TODO_ITEMS,
  
  // Tool Registry
  registry,
  ToolRegistry,
  TOOL_DEFINITIONS
};

// Made with Bob
