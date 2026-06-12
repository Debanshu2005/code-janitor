/**
 * Attempt Completion Tool
 * 
 * This tool is used to present the final result of a task to the user.
 * It should only be used after confirming that all previous tool uses were successful.
 * 
 * IMPORTANT: This tool CANNOT be used until you've confirmed from the user that any 
 * previous tool uses were successful. Failure to do so will result in code corruption 
 * and system failure.
 */

/**
 * Validate attempt_completion parameters
 * @param {Object} params - The parameters object
 * @param {string} params.result - The result text to present
 * @returns {Object} Validation result with isValid and error properties
 */
function validateAttemptCompletion(params) {
  if (!params || typeof params !== "object") {
    return {
      isValid: false,
      error: "Parameters must be an object"
    };
  }

  if (typeof params.result !== "string") {
    return {
      isValid: false,
      error: "Result parameter is required and must be a string"
    };
  }

  const result = params.result.trim();
  
  if (result.length === 0) {
    return {
      isValid: false,
      error: "Result parameter cannot be empty"
    };
  }

  // Check if result ends with a question
  if (result.endsWith("?")) {
    return {
      isValid: false,
      error: "Result should not end with a question. Formulate the result in a way that is final and does not require further input."
    };
  }

  // Check for phrases that suggest further conversation
  const conversationalPhrases = [
    "let me know",
    "feel free to",
    "if you need",
    "would you like",
    "do you want",
    "shall i",
    "should i",
    "can i help",
    "anything else",
    "further assistance"
  ];

  const lowerResult = result.toLowerCase();
  for (const phrase of conversationalPhrases) {
    if (lowerResult.includes(phrase)) {
      return {
        isValid: false,
        error: `Result should not include conversational phrases like "${phrase}". End with a final statement, not an offer for further assistance.`
      };
    }
  }

  // Check for forbidden starting words
  const forbiddenStarts = ["great", "certainly", "okay", "sure"];
  const firstWord = result.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  
  if (forbiddenStarts.includes(firstWord)) {
    return {
      isValid: false,
      error: `Result should not start with conversational words like "${firstWord}". Be direct and to the point.`
    };
  }

  return { isValid: true };
}

/**
 * Execute attempt_completion tool
 * @param {Object} params - The parameters object
 * @param {string} params.result - The result text to present
 * @param {string} workspaceRoot - The workspace root directory (unused but kept for consistency)
 * @param {Object} executionContext - Additional context (unused but kept for consistency)
 * @returns {Promise<Object>} Result object with success status and formatted result
 */
async function attemptCompletion(params, workspaceRoot, executionContext = {}) {
  // Validate parameters
  const validation = validateAttemptCompletion(params);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  const result = params.result.trim();

  // Return formatted result
  return {
    success: true,
    result: result,
    message: "Task completion attempted"
  };
}

module.exports = {
  attemptCompletion,
  validateAttemptCompletion
};

// Made with Bob
