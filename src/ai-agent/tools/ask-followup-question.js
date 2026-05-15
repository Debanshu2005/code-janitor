/**
 * ask-followup-question.js
 *
 * Implements ask_followup_question for gathering additional information from users
 * with suggested answers for quick selection.
 */

const MAX_SUGGESTIONS = 6;
const MAX_QUESTION_LENGTH = 500;
const MAX_SUGGESTION_LENGTH = 200;

/**
 * Validate and normalize a suggestion
 */
function normalizeSuggestion(suggestion, index) {
  if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) {
    throw new Error(`Suggestion ${index + 1} must be an object`);
  }

  const text = String(suggestion.text || suggestion.answer || "").trim();
  const mode = suggestion.mode ? String(suggestion.mode).trim().toLowerCase() : null;

  if (!text) {
    throw new Error(`Suggestion ${index + 1} is missing text`);
  }

  if (text.length > MAX_SUGGESTION_LENGTH) {
    throw new Error(
      `Suggestion ${index + 1} exceeds maximum length (${MAX_SUGGESTION_LENGTH} chars). Got ${text.length} chars.`
    );
  }

  const result = { text };
  if (mode) {
    result.mode = mode;
  }

  return result;
}

/**
 * Validate and normalize suggestions array
 */
function normalizeSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) {
    throw new Error("suggestions must be an array");
  }

  if (suggestions.length === 0) {
    throw new Error("At least one suggestion is required");
  }

  if (suggestions.length > MAX_SUGGESTIONS) {
    throw new Error(
      `Too many suggestions (max ${MAX_SUGGESTIONS}). Got ${suggestions.length} suggestions.`
    );
  }

  return suggestions.map((suggestion, index) => normalizeSuggestion(suggestion, index));
}

/**
 * Ask the user a followup question with suggested answers
 */
async function askFollowupQuestion(params, workspaceRoot, executionContext = {}) {
  const question = String(params.question || "").trim();
  
  if (!question) {
    throw new Error("question parameter is required");
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    throw new Error(
      `Question exceeds maximum length (${MAX_QUESTION_LENGTH} chars). Got ${question.length} chars.`
    );
  }

  if (!params.suggestions) {
    throw new Error("suggestions parameter is required");
  }

  const normalizedSuggestions = normalizeSuggestions(params.suggestions);

  return {
    success: true,
    question,
    suggestions: normalizedSuggestions,
    summary: `Asked question with ${normalizedSuggestions.length} suggestion(s)`
  };
}

module.exports = {
  askFollowupQuestion,
  normalizeSuggestions,
  normalizeSuggestion,
  MAX_SUGGESTIONS,
  MAX_QUESTION_LENGTH,
  MAX_SUGGESTION_LENGTH
};

// Made with Bob