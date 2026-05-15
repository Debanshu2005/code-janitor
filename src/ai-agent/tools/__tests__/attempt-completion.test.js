/**
 * Tests for attempt-completion tool
 */

const { attemptCompletion, validateAttemptCompletion } = require("../attempt-completion");

describe("attempt-completion tool", () => {
  describe("validateAttemptCompletion", () => {
    it("should validate valid completion result", () => {
      const params = {
        result: "Task completed successfully. All files updated."
      };
      const validation = validateAttemptCompletion(params);
      expect(validation.isValid).toBe(true);
    });

    it("should reject empty result", () => {
      const params = { result: "" };
      const validation = validateAttemptCompletion(params);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain("cannot be empty");
    });

    it("should reject result ending with question mark", () => {
      const params = {
        result: "Task completed. Would you like me to do more?"
      };
      const validation = validateAttemptCompletion(params);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain("should not end with a question");
    });

    it("should reject conversational phrases", () => {
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

      for (const phrase of conversationalPhrases) {
        const params = {
          result: `Task completed. ${phrase} if you need more help.`
        };
        const validation = validateAttemptCompletion(params);
        expect(validation.isValid).toBe(false);
        expect(validation.error).toContain("conversational phrases");
      }
    });

    it("should reject forbidden starting words", () => {
      const forbiddenStarts = ["Great", "Certainly", "Okay", "Sure"];

      for (const word of forbiddenStarts) {
        const params = {
          result: `${word}, the task is complete.`
        };
        const validation = validateAttemptCompletion(params);
        expect(validation.isValid).toBe(false);
        expect(validation.error).toContain("should not start with conversational words");
      }
    });

    it("should accept multi-line results with bullet points", () => {
      const params = {
        result: "- CSS update complete\n- Documented changes\n- Navigation menu redesigned"
      };
      const validation = validateAttemptCompletion(params);
      expect(validation.isValid).toBe(true);
    });

    it("should reject missing result parameter", () => {
      const params = {};
      const validation = validateAttemptCompletion(params);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain("required");
    });

    it("should reject non-string result", () => {
      const params = { result: 123 };
      const validation = validateAttemptCompletion(params);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain("must be a string");
    });

    it("should reject null params", () => {
      const validation = validateAttemptCompletion(null);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain("must be an object");
    });
  });

  describe("attemptCompletion", () => {
    it("should execute successfully with valid params", async () => {
      const params = {
        result: "Task completed successfully."
      };
      const result = await attemptCompletion(params, "/workspace");
      
      expect(result.success).toBe(true);
      expect(result.result).toBe("Task completed successfully.");
      expect(result.message).toBe("Task completion attempted");
    });

    it("should throw error for invalid params", async () => {
      const params = {
        result: "Task completed?"
      };
      
      await expect(attemptCompletion(params, "/workspace")).rejects.toThrow(
        "should not end with a question"
      );
    });

    it("should trim whitespace from result", async () => {
      const params = {
        result: "  Task completed successfully.  \n"
      };
      const result = await attemptCompletion(params, "/workspace");
      
      expect(result.result).toBe("Task completed successfully.");
    });

    it("should handle multi-line results", async () => {
      const params = {
        result: "Task complete:\n- File updated\n- Tests passed\n- Documentation added"
      };
      const result = await attemptCompletion(params, "/workspace");
      
      expect(result.success).toBe(true);
      expect(result.result).toContain("File updated");
      expect(result.result).toContain("Tests passed");
    });

    it("should reject empty result after trimming", async () => {
      const params = {
        result: "   \n   "
      };
      
      await expect(attemptCompletion(params, "/workspace")).rejects.toThrow(
        "cannot be empty"
      );
    });

    it("should work with execution context", async () => {
      const params = {
        result: "Task completed successfully."
      };
      const executionContext = { agent: {} };
      const result = await attemptCompletion(params, "/workspace", executionContext);
      
      expect(result.success).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle result with special characters", async () => {
      const params = {
        result: "Updated files: src/app.js, src/utils.ts, package.json"
      };
      const result = await attemptCompletion(params, "/workspace");
      
      expect(result.success).toBe(true);
      expect(result.result).toContain("src/app.js");
    });

    it("should handle result with code snippets", async () => {
      const params = {
        result: "Added function `calculateTotal()` to utils.js"
      };
      const result = await attemptCompletion(params, "/workspace");
      
      expect(result.success).toBe(true);
    });

    it("should reject result starting with forbidden word case-insensitive", () => {
      const params = {
        result: "GREAT! The task is complete."
      };
      const validation = validateAttemptCompletion(params);
      expect(validation.isValid).toBe(false);
    });

    it("should allow words containing forbidden starts", () => {
      const params = {
        result: "Greater performance achieved through optimization."
      };
      const validation = validateAttemptCompletion(params);
      expect(validation.isValid).toBe(true);
    });
  });
});

// Made with Bob