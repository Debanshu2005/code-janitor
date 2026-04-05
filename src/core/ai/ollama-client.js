// src/core/ai/ollama-client.js
const vscode = require("vscode");

class OllamaClient {
  constructor() {
    this.baseUrl = "http://localhost:11434";
    this.model = "codellama:latest";
  }

  getConfig() {
    const config = vscode.workspace.getConfiguration("codeJanitor.ai");
    return {
      enabled: config.get("enabled", true),
      baseUrl: config.get("ollamaUrl", this.baseUrl),
      model: config.get("model", this.model),
      timeout: config.get("timeout", 30000)
    };
  }

  async isAvailable() {
    const config = this.getConfig();
    console.log(
      `🔍 AI Config: enabled=${config.enabled}, url=${config.baseUrl}, model=${config.model}, timeout=${config.timeout}`
    );

    if (!config.enabled) {
      console.log("❌ AI is disabled in settings");
      return false;
    }

    try {
      console.log("🔍 Checking Ollama availability...");
      const response = await fetch(`${config.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000)
      });
      const available = response.ok;
      console.log(`✓ Ollama available: ${available}`);
      return available;
    } catch (error) {
      console.warn("❌ Ollama not available:", error.message);
      return false;
    }
  }

  async validateAndFix(originalCode, ruleBasedFix, language) {
    const config = this.getConfig();

    if (!config.enabled) {
      return {
        shouldUseAI: false,
        fixedCode: ruleBasedFix,
        reason: "AI disabled",
        securityIssues: []
      };
    }

    const prompts = {
      javascript: `Fix syntax errors in this JavaScript code. Add semicolons ONLY where genuinely required.

Rules:
- Add semicolons ONLY where missing them causes syntax errors
- Do NOT add after: function/class declarations, if/for/while, blocks
- Keep existing style

Code:
${originalCode}

Fixed code:`,

      python: `Fix all possible syntax errors in this Python code.

Rules:
- Add missing colons after: def, class, if, else, elif, for, while, try, except, finally, with
- Fix indentation issues
- Convert JavaScript syntax to Python (true→True, false→False, null→None)
- Keep existing style

Code:
${originalCode}

Fixed code:`,

      java: `Fix all possible syntax errors in this Java code.

Rules:
- Add missing semicolons at end of statements
- Fix missing braces
- Keep existing style

Code:
${originalCode}

Fixed code:`,

      c: `Fix all possible syntax errors in this C code.

Rules:
- Add missing semicolons
- Fix missing braces
- Keep existing style

Code:
${originalCode}

Fixed code:`,

      cpp: `Fix all possible syntax errors in this C++code.

Rules:
- Add missing semicolons
- Fix missing braces
- Keep existing style

Code:
${originalCode}

Fixed code:`,

      html: `Fix all possible syntax errors in this HTML code.

Rules:
- Close unclosed tags
- Fix malformed attributes
- Keep existing style

Code:
${originalCode}

Fixed code:`
    };

    const prompt =
      prompts[language] ||
      `Fix syntax errors in this ${language} code. Keep existing style.

Code:
${originalCode}

Fixed code:`;

    try {
      console.log(`🤖 Sending AI validation request for ${language}...`);
      const response = await fetch(`${config.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 1024,
            top_k: 40,
            top_p: 0.9
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      let fixedCode = data.response.trim();

      // Remove code block wrappers if present
      fixedCode = fixedCode
        .replace(/^```[a-z]*\n?/i, "")
        .replace(/\n?```$/, "");

      // Remove quotes if AI wrapped entire code in quotes
      if (
        (fixedCode.startsWith("'") && fixedCode.endsWith("'")) ||
        (fixedCode.startsWith('"') && fixedCode.endsWith('"')) ||
        (fixedCode.startsWith("`") && fixedCode.endsWith("`"))
      ) {
        fixedCode = fixedCode.slice(1, -1);
      }

      // Unescape if needed
      fixedCode = fixedCode
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"');

      // Validate output - reject if AI added too many semicolons
      const originalSemicolons = (originalCode.match(/;/g) || []).length;
      const fixedSemicolons = (fixedCode.match(/;/g) || []).length;
      const semicolonDiff = fixedSemicolons - originalSemicolons;

      const originalLines = originalCode.split("\n").length;
      const fixedLines = fixedCode.split("\n").length;
      const lineDiff = Math.abs(originalLines - fixedLines);

      // Reject if AI added more than 2 semicolons
      if (semicolonDiff > 2) {
        console.warn(`⚠️ AI added ${semicolonDiff} semicolons, rejecting`);
        return {
          shouldUseAI: false,
          fixedCode: originalCode, // Use original, not rule-based
          reason: "AI made too many changes",
          securityIssues: []
        };
      }

      if (
        fixedCode &&
        fixedCode.length > 10 &&
        fixedCode !== originalCode &&
        lineDiff < 5
      ) {
        console.log(`✓ AI fixed code successfully`);
        return {
          shouldUseAI: true,
          fixedCode: fixedCode,
          reason: "AI fixed syntax",
          securityIssues: []
        };
      }

      return {
        shouldUseAI: false,
        fixedCode: ruleBasedFix,
        reason: "No changes needed",
        securityIssues: []
      };
    } catch (error) {
      console.error("❌ AI validation failed:", error.message);
      return {
        shouldUseAI: false,
        fixedCode: ruleBasedFix,
        reason: "AI unavailable",
        securityIssues: []
      };
    }
  }

  parseSecurityResponse(response, fallbackCode) {
    try {
      // Try multiple extraction strategies
      let parsed = null;

      // Strategy 1: Extract JSON between ```json and ```
      const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        try {
          parsed = JSON.parse(codeBlockMatch[1].trim());
        } catch (e) {}
      }

      // Strategy 2: Find first complete JSON object
      if (!parsed) {
        const jsonMatch = response.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (e) {}
        }
      }

      // Strategy 3: Try parsing entire response
      if (!parsed) {
        try {
          parsed = JSON.parse(response.trim());
        } catch (e) {}
      }

      if (parsed && parsed.fixedCode) {
        return {
          shouldUseAI: parsed.fixedCode !== fallbackCode,
          fixedCode: parsed.fixedCode,
          reason:
            parsed.securityIssues?.length > 0
              ? "Security issues found"
              : "Code is secure",
          securityIssues: parsed.securityIssues || []
        };
      }

      console.warn("AI response format invalid:", response.substring(0, 200));
      return {
        shouldUseAI: false,
        fixedCode: fallbackCode,
        reason: "Invalid AI response format",
        securityIssues: []
      };
    } catch (error) {
      console.warn("Failed to parse AI security response:", error.message);
      return {
        shouldUseAI: false,
        fixedCode: fallbackCode,
        reason: "Parse error",
        securityIssues: []
      };
    }
  }

  parseAIResponse(response) {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return [];
    } catch (error) {
      console.warn("Failed to parse AI response");
      return [];
    }
  }

  async enhanceFixer(code, language, existingIssues = []) {
    const aiIssues = await this.analyzeSyntax(code, language);

    if (!aiIssues || aiIssues.length === 0) {
      return existingIssues;
    }

    const combined = [...existingIssues];

    for (const aiIssue of aiIssues) {
      const isDuplicate = existingIssues.some(
        (existing) => existing.line === aiIssue.line
      );

      if (!isDuplicate) {
        combined.push(aiIssue);
      }
    }

    return combined;
  }
}

module.exports = OllamaClient;
