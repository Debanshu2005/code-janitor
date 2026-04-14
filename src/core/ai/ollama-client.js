const vscode = require("vscode");

let babelParser;
try {
  babelParser = require("@babel/parser");
} catch {
  babelParser = null;
}

const AVAILABILITY_CACHE_MS = 15_000;
const MAX_CODE_LENGTH = 12_000;
const SUPPORTED_LANGUAGES = new Set([
  "javascript",
  "python",
  "java",
  "c",
  "cpp",
  "html"
]);

class OllamaClient {
  constructor() {
    this.baseUrl = "http://localhost:11434";
    this.model = "qwen2.5-coder:1.5b";
    this._availabilityCache = null;
  }

  getConfig() {
    const config = vscode.workspace.getConfiguration("codeJanitor.ai");
    return {
      enabled: config.get("enabled", true),
      baseUrl: config.get("ollamaUrl", this.baseUrl),
      model: config.get("model", this.model),
      timeout: config.get("timeout", 20_000)
    };
  }

  async isAvailable(forceRefresh = false) {
    const config = this.getConfig();

    if (!config.enabled) {
      return false;
    }

    const now = Date.now();
    if (
      !forceRefresh &&
      this._availabilityCache &&
      this._availabilityCache.baseUrl === config.baseUrl &&
      now - this._availabilityCache.checkedAt < AVAILABILITY_CACHE_MS
    ) {
      return this._availabilityCache.available;
    }

    try {
      const response = await fetch(`${config.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(Math.min(config.timeout, 5_000))
      });

      const available = response.ok;
      this._availabilityCache = {
        available,
        baseUrl: config.baseUrl,
        checkedAt: now
      };

      return available;
    } catch (error) {
      console.warn("Ollama not available:", error.message);
      this._availabilityCache = {
        available: false,
        baseUrl: config.baseUrl,
        checkedAt: now
      };
      return false;
    }
  }

  shouldAttemptAI(originalCode, ruleBasedFix, language) {
    if (!SUPPORTED_LANGUAGES.has(language)) {
      return false;
    }

    const source = (originalCode || "").trim();
    const candidate = (ruleBasedFix || "").trim();
    if (!source) {
      return false;
    }

    if (source.length > MAX_CODE_LENGTH || candidate.length > MAX_CODE_LENGTH) {
      return false;
    }

    if (candidate !== source) {
      if (
        language === "javascript" &&
        this._passesLanguageValidation(source, language) &&
        this._passesLanguageValidation(candidate, language)
      ) {
        return false;
      }

      return true;
    }

    return this.looksSyntaxBroken(source, language);
  }

  looksSyntaxBroken(code, language) {
    const trimmed = code.trim();

    switch (language) {
      case "python":
        return /^(if|elif|else|def|class|for|while|try|except|finally|with)\b(?!.*:)/m.test(
          trimmed
        ) || this._hasUnbalancedPythonBrackets(trimmed);
      case "javascript":
      case "java":
      case "c":
      case "cpp":
        return (
          /,\s*;/.test(trimmed) ||
          /\(\s*;/.test(trimmed) ||
          /(^|\n)\s*(let|const|var|return)\b[^\n;{}]*$/m.test(trimmed)
        );
      case "html":
        return /<[^/!][^>]*$(?![\s\S]*>)/m.test(trimmed);
      default:
        return false;
    }
  }

  _hasUnbalancedPythonBrackets(code) {
    if (!code) return false;

    const stripped = code
      .replace(/("""|''')[\s\S]*?\1/g, "")
      .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "")
      .replace(/#.*$/gm, "");

    const stack = [];
    const pairs = { "(": ")", "[": "]", "{": "}" };
    const closers = new Set(Object.values(pairs));

    for (let i = 0; i < stripped.length; i += 1) {
      const ch = stripped[i];
      if (pairs[ch]) {
        stack.push(pairs[ch]);
        continue;
      }
      if (closers.has(ch)) {
        const expected = stack.pop();
        if (expected !== ch) {
          return true;
        }
      }
    }

    return stack.length > 0;
  }

  buildPrompt(originalCode, ruleBasedFix, language) {
    const instructions = {
      javascript: [
        "Return only fixed JavaScript code.",
        "Preserve behavior and existing style.",
        "Prefer the candidate code if it is already correct.",
        "Do not add explanations or markdown fences."
      ],
      python: [
        "Return only fixed Python code.",
        "Fix syntax and indentation errors.",
        "Prefer the candidate code if it is already correct.",
        "Do not add explanations or markdown fences."
      ],
      java: [
        "Return only fixed Java code.",
        "Fix syntax errors with the smallest possible diff.",
        "Do not add explanations or markdown fences."
      ],
      c: [
        "Return only fixed C code.",
        "Fix syntax errors with the smallest possible diff.",
        "Do not add explanations or markdown fences."
      ],
      cpp: [
        "Return only fixed C++ code.",
        "Fix syntax errors with the smallest possible diff.",
        "Do not add explanations or markdown fences."
      ],
      html: [
        "Return only fixed HTML.",
        "Close broken tags and keep the original document structure.",
        "Do not add explanations or markdown fences."
      ]
    };

    const header = (instructions[language] || [
      `Return only fixed ${language} code.`,
      "Do not add explanations or markdown fences."
    ]).join("\n");

    return `${header}

Original code:
${originalCode}

Candidate code to improve:
${ruleBasedFix}

Final fixed code:`;
  }

  extractCode(responseText, fallbackCode) {
    const text = (responseText || "").trim();
    if (!text) {
      return fallbackCode;
    }

    const fencedMatch = text.match(/```[a-z0-9_-]*\s*([\s\S]*?)```/i);
    let fixedCode = fencedMatch ? fencedMatch[1].trim() : text;

    if (/^final fixed code\s*:/i.test(fixedCode)) {
      fixedCode = fixedCode.replace(/^final fixed code\s*:/i, "").trim();
    }

    if (
      (fixedCode.startsWith("\"") && fixedCode.endsWith("\"")) ||
      (fixedCode.startsWith("'") && fixedCode.endsWith("'")) ||
      (fixedCode.startsWith("`") && fixedCode.endsWith("`"))
    ) {
      fixedCode = fixedCode.slice(1, -1);
    }

    return fixedCode
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\'/g, "'");
  }

  isReasonableFix(originalCode, ruleBasedFix, fixedCode) {
    if (!fixedCode || fixedCode.trim().length < 3) {
      return false;
    }

    if (fixedCode.length > Math.max(originalCode.length, ruleBasedFix.length) * 2) {
      return false;
    }

    const fenceCount = (fixedCode.match(/```/g) || []).length;
    if (fenceCount > 0) {
      return false;
    }

    const originalLines = originalCode.split("\n").length;
    const fixedLines = fixedCode.split("\n").length;
    if (Math.abs(originalLines - fixedLines) > 25) {
      return false;
    }

    if (
      !this._passesLanguageValidation(fixedCode, this._lastValidationLanguage)
    ) {
      return false;
    }

    return true;
  }

  _passesLanguageValidation(code, language) {
    if (!language || !code) {
      return true;
    }

    if (
      (language === "javascript" || language === "java" || language === "c" || language === "cpp") &&
      babelParser &&
      language === "javascript"
    ) {
      try {
        babelParser.parse(code, {
          sourceType: "unambiguous",
          allowReturnOutsideFunction: true,
          errorRecovery: false,
          plugins: [
            "jsx",
            "typescript",
            "classProperties",
            "dynamicImport",
            "optionalChaining",
            "nullishCoalescingOperator",
            "objectRestSpread"
          ]
        });
        return true;
      } catch {
        return false;
      }
    }

    if (language === "python") {
      const trimmed = code.trim();
      if (!trimmed) {
        return true;
      }

      const hasJsArtifacts =
        /\b(var|let|const|function)\b/.test(trimmed) ||
        /[{};]/.test(trimmed) ||
        /=>/.test(trimmed);

      const hasBrokenBlocks =
        /^(if|elif|else|def|class|for|while|try|except|finally|with)\b(?!.*:)/m.test(
          trimmed
        ) || /^\s+(return|pass|break|continue)\b/m.test(trimmed) && !/:\s*$/m.test(trimmed);

      return !hasJsArtifacts && !hasBrokenBlocks;
    }

    return true;
  }

  async validateAndFix(originalCode, ruleBasedFix, language, options = {}) {
    const config = this.getConfig();
    const safeOriginal = originalCode || "";
    const safeRuleBased = ruleBasedFix || safeOriginal;
    const force =
      options.force === true ||
      !this._passesLanguageValidation(safeOriginal, language) ||
      !this._passesLanguageValidation(safeRuleBased, language);

    if (!config.enabled) {
      return {
        shouldUseAI: false,
        fixedCode: safeRuleBased,
        reason: "AI disabled",
        securityIssues: []
      };
    }

    if (!force && !this.shouldAttemptAI(safeOriginal, safeRuleBased, language)) {
      return {
        shouldUseAI: false,
        fixedCode: safeRuleBased,
        reason: "Rule-based fix is sufficient",
        securityIssues: []
      };
    }

    if (!(await this.isAvailable())) {
      return {
        shouldUseAI: false,
        fixedCode: safeRuleBased,
        reason: "Ollama unavailable",
        securityIssues: []
      };
    }

    try {
      this._lastValidationLanguage = language;
      const response = await fetch(`${config.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(config.timeout),
        body: JSON.stringify({
          model: config.model,
          prompt: this.buildPrompt(safeOriginal, safeRuleBased, language),
          stream: false,
          options: {
            temperature: 0,
            num_predict: Math.min(768, Math.max(256, safeRuleBased.length / 4)),
            top_k: 20,
            top_p: 0.8
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const fixedCode = this.extractCode(data.response, safeRuleBased);

      if (
        fixedCode !== safeOriginal &&
        fixedCode !== safeRuleBased &&
        this.isReasonableFix(safeOriginal, safeRuleBased, fixedCode)
      ) {
        return {
          shouldUseAI: true,
          fixedCode,
          reason: force ? "AI forced due to invalid syntax" : "AI improved the candidate fix",
          securityIssues: []
        };
      }

      return {
        shouldUseAI: false,
        fixedCode: safeRuleBased,
        reason: "AI response was not better than the candidate fix",
        securityIssues: []
      };
    } catch (error) {
      console.warn("AI validation failed:", error.message);
      return {
        shouldUseAI: false,
        fixedCode: safeRuleBased,
        reason: "AI request failed",
        securityIssues: []
      };
    }
  }

  parseSecurityResponse(response, fallbackCode) {
    try {
      let parsed = null;

      const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        try {
          parsed = JSON.parse(codeBlockMatch[1].trim());
        } catch (parseError) {
          // Ignore invalid JSON blocks and fall through to the next strategy.
        }
      }

      if (!parsed) {
        const jsonMatch = response.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (parseError) {
            // Ignore partial JSON fragments.
          }
        }
      }

      if (!parsed) {
        try {
          parsed = JSON.parse(response.trim());
        } catch (parseError) {
          // Ignore non-JSON responses.
        }
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

      return {
        shouldUseAI: false,
        fixedCode: fallbackCode,
        reason: "Invalid AI response format",
        securityIssues: []
      };
    } catch (error) {
      return {
        shouldUseAI: false,
        fixedCode: fallbackCode,
        reason: `Parse error: ${error.message}`,
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
    } catch {
      return [];
    }
  }
}

module.exports = OllamaClient;
