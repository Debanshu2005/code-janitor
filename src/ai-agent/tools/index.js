/**
 * tools/index.js
 * 
 * Central export point for all Bob-style tools
 */

const { applyDiff, validateDiff, parseDiffBlocks } = require("./apply-diff");
const { insertContent, validateInsert } = require("./insert-content");
const { readFiles, readSingleFile, formatResults, parseLineRange, MAX_FILES_PER_REQUEST } = require("./read-file");
const {
  listCodeDefinitionNames,
  parseFile,
  getLanguage,
  LANGUAGE_MAP,
  MAX_FILE_SIZE,
  MAX_DEFINITIONS_PER_FILE
} = require("./list-code-definition-names");
const {
  updateTodoList,
  normalizeTodoItems,
  buildTodoSummary,
  VALID_TODO_STATUSES,
  MAX_TODO_ITEMS
} = require("./update-todo-list");
const {
  askFollowupQuestion,
  normalizeSuggestions,
  MAX_SUGGESTIONS
} = require("./ask-followup-question");
const {
  attemptCompletion,
  validateAttemptCompletion
} = require("./attempt-completion");
const { registry, ToolRegistry, TOOL_DEFINITIONS } = require("./tool-registry");
const {
  submitReviewFindings,
  validateIssues: validateReviewIssues,
  VALID_CATEGORIES,
  VALID_TYPES,
  VALID_SEVERITIES,
  VALID_SCOPES,
  MAX_ISSUES_PER_SUBMISSION
} = require("./submit-review-findings");
const {
  fetchGitHubContext,
  validateGitHubContextRequest,
  parseGitHubRemoteUrl,
  VALID_MODES: VALID_GITHUB_CONTEXT_MODES
} = require("./fetch-github-context");

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

  // List Code Definition Names
  listCodeDefinitionNames,
  parseFile,
  getLanguage,
  LANGUAGE_MAP,
  MAX_FILE_SIZE,
  MAX_DEFINITIONS_PER_FILE,

  // Todo List
  updateTodoList,
  normalizeTodoItems,
  buildTodoSummary,
  VALID_TODO_STATUSES,
  MAX_TODO_ITEMS,

  // Ask Followup Question
  askFollowupQuestion,
  normalizeSuggestions,
  MAX_SUGGESTIONS,

  // Attempt Completion
  attemptCompletion,
  validateAttemptCompletion,
  
  // Review Findings
  submitReviewFindings,
  validateReviewIssues,
  VALID_CATEGORIES,
  VALID_TYPES,
  VALID_SEVERITIES,
  VALID_SCOPES,
  MAX_ISSUES_PER_SUBMISSION,

  // GitHub Context
  fetchGitHubContext,
  validateGitHubContextRequest,
  parseGitHubRemoteUrl,
  VALID_GITHUB_CONTEXT_MODES,
  
  // Tool Registry
  registry,
  ToolRegistry,
  TOOL_DEFINITIONS
};

// Made with Bob
