/**
 * Tests for ask-followup-question.js
 */

const {
  askFollowupQuestion,
  normalizeSuggestions,
  normalizeSuggestion,
  MAX_SUGGESTIONS,
  MAX_QUESTION_LENGTH,
  MAX_SUGGESTION_LENGTH
} = require("../ask-followup-question");

describe("ask-followup-question", () => {
  describe("normalizeSuggestion", () => {
    test("normalizes valid suggestion with text", () => {
      const suggestion = { text: "Option 1" };
      const result = normalizeSuggestion(suggestion, 0);
      expect(result).toEqual({ text: "Option 1" });
    });

    test("normalizes suggestion with mode", () => {
      const suggestion = { text: "Switch to code mode", mode: "code" };
      const result = normalizeSuggestion(suggestion, 0);
      expect(result).toEqual({ text: "Switch to code mode", mode: "code" });
    });

    test("accepts alternative field names", () => {
      const suggestion = { answer: "Option 1" };
      const result = normalizeSuggestion(suggestion, 0);
      expect(result).toEqual({ text: "Option 1" });
    });

    test("trims whitespace from text", () => {
      const suggestion = { text: "  Option 1  " };
      const result = normalizeSuggestion(suggestion, 0);
      expect(result).toEqual({ text: "Option 1" });
    });

    test("throws error for non-object suggestion", () => {
      expect(() => normalizeSuggestion("not an object", 0)).toThrow(
        "Suggestion 1 must be an object"
      );
    });

    test("throws error for missing text", () => {
      expect(() => normalizeSuggestion({}, 0)).toThrow(
        "Suggestion 1 is missing text"
      );
    });

    test("throws error for text exceeding max length", () => {
      const longText = "a".repeat(MAX_SUGGESTION_LENGTH + 1);
      expect(() => normalizeSuggestion({ text: longText }, 0)).toThrow(
        `Suggestion 1 exceeds maximum length`
      );
    });
  });

  describe("normalizeSuggestions", () => {
    test("normalizes array of valid suggestions", () => {
      const suggestions = [
        { text: "Option 1" },
        { text: "Option 2" },
        { text: "Option 3" }
      ];
      const result = normalizeSuggestions(suggestions);
      expect(result).toEqual([
        { text: "Option 1" },
        { text: "Option 2" },
        { text: "Option 3" }
      ]);
    });

    test("throws error for non-array input", () => {
      expect(() => normalizeSuggestions("not an array")).toThrow(
        "suggestions must be an array"
      );
    });

    test("throws error for empty array", () => {
      expect(() => normalizeSuggestions([])).toThrow(
        "At least one suggestion is required"
      );
    });

    test("throws error for too many suggestions", () => {
      const tooMany = Array(MAX_SUGGESTIONS + 1).fill({ text: "Option" });
      expect(() => normalizeSuggestions(tooMany)).toThrow(
        `Too many suggestions (max ${MAX_SUGGESTIONS})`
      );
    });
  });

  describe("askFollowupQuestion", () => {
    test("returns success with valid question and suggestions", async () => {
      const params = {
        question: "Which file should I modify?",
        suggestions: [
          { text: "src/app.js" },
          { text: "src/utils.js" }
        ]
      };

      const result = await askFollowupQuestion(params, "/workspace");

      expect(result.success).toBe(true);
      expect(result.question).toBe("Which file should I modify?");
      expect(result.suggestions).toEqual([
        { text: "src/app.js" },
        { text: "src/utils.js" }
      ]);
      expect(result.summary).toBe("Asked question with 2 suggestion(s)");
    });

    test("handles suggestions with mode", async () => {
      const params = {
        question: "How would you like to proceed?",
        suggestions: [
          { text: "Review code", mode: "ask" },
          { text: "Make changes", mode: "code" }
        ]
      };

      const result = await askFollowupQuestion(params, "/workspace");

      expect(result.success).toBe(true);
      expect(result.suggestions).toEqual([
        { text: "Review code", mode: "ask" },
        { text: "Make changes", mode: "code" }
      ]);
    });

    test("throws error for missing question", async () => {
      const params = {
        suggestions: [{ text: "Option 1" }]
      };

      await expect(askFollowupQuestion(params, "/workspace")).rejects.toThrow(
        "question parameter is required"
      );
    });

    test("throws error for empty question", async () => {
      const params = {
        question: "   ",
        suggestions: [{ text: "Option 1" }]
      };

      await expect(askFollowupQuestion(params, "/workspace")).rejects.toThrow(
        "question parameter is required"
      );
    });

    test("throws error for question exceeding max length", async () => {
      const longQuestion = "a".repeat(MAX_QUESTION_LENGTH + 1);
      const params = {
        question: longQuestion,
        suggestions: [{ text: "Option 1" }]
      };

      await expect(askFollowupQuestion(params, "/workspace")).rejects.toThrow(
        `Question exceeds maximum length`
      );
    });

    test("throws error for missing suggestions", async () => {
      const params = {
        question: "What should I do?"
      };

      await expect(askFollowupQuestion(params, "/workspace")).rejects.toThrow(
        "suggestions parameter is required"
      );
    });

    test("throws error for invalid suggestions", async () => {
      const params = {
        question: "What should I do?",
        suggestions: []
      };

      await expect(askFollowupQuestion(params, "/workspace")).rejects.toThrow(
        "At least one suggestion is required"
      );
    });
  });
});

// Made with Bob