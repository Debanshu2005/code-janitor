let vscode = null;
try {
  vscode = require("vscode");
} catch {
  vscode = null;
}

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
const SUPPORTED_PROVIDERS = new Set(["ollama", "nvidia"]);
const NVIDIA_DEFAULT_MODEL = "meta/llama-3.1-8b-instruct";
const NVIDIA_MODEL_ALIASES = new Map([
  ["nvidia/minimax-m2.7", "minimaxai/minimax-m2.7"],
  ["nvidia/llama-3.1-nemotron-70b-instruct", "meta/llama-3.1-70b-instruct"],
  ["nvidia/mistral-nemo-minitron-8b-8k-instruct", "mistralai/mistral-nemotron"],
  ["nvidia/llama-3.1-nemotron-51b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1.5"]
]);
let runtimeConfigOverride = null;

class OllamaClient {
  constructor() {
    this.baseUrl = "http://localhost:11434";
    this.model = "qwen2.5-coder:1.5b";
    this._availabilityCache = null;
  }

  static configureRuntime(config = null) {
    runtimeConfigOverride = config ? { ...config } : null;
  }

  static clearRuntimeConfig() {
    runtimeConfigOverride = null;
  }

  getConfig() {
    const config = vscode?.workspace?.getConfiguration
      ? vscode.workspace.getConfiguration("codeJanitor.ai")
      : null;

    const timeoutValue = runtimeConfigOverride?.timeout;
    const provider = this._normalizeProvider(
      runtimeConfigOverride?.provider || config?.get("provider", "ollama") || "ollama"
    );
    const rawModel =
      runtimeConfigOverride?.model ||
      (provider === "nvidia"
        ? config?.get("nvidiaModel", NVIDIA_DEFAULT_MODEL)
        : config?.get("model", this.model)) ||
      this.model;
    const resolvedModel =
      provider === "nvidia" ? this._sanitizeNvidiaModel(rawModel) : String(rawModel || "").trim() || this.model;

    return {
      enabled: runtimeConfigOverride?.enabled ?? config?.get("enabled", true) ?? true,
      provider,
      baseUrl: this._normalizeOllamaUrl(
        runtimeConfigOverride?.baseUrl || config?.get("ollamaUrl", this.baseUrl) || this.baseUrl
      ),
      model: resolvedModel,
      nvidiaApiKey:
        runtimeConfigOverride?.nvidiaApiKey ||
        config?.get("nvidiaApiKey", "") ||
        "",
      timeout:
        Number.isFinite(timeoutValue) && timeoutValue > 0
          ? timeoutValue
          : config?.get("timeout", 20_000) || 20_000
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
      this._availabilityCache.provider === config.provider &&
      this._availabilityCache.baseUrl === config.baseUrl &&
      now - this._availabilityCache.checkedAt < AVAILABILITY_CACHE_MS
    ) {
      return this._availabilityCache.available;
    }

    try {
      if (config.provider === "nvidia") {
        if (!config.nvidiaApiKey) {
          this._availabilityCache = {
            available: false,
            provider: config.provider,
            baseUrl: config.baseUrl,
            checkedAt: now
          };
          return false;
        }
      }

      const response = config.provider === "nvidia"
        ? await fetch("https://integrate.api.nvidia.com/v1/models", {
            method: "GET",
            headers: {
              Authorization: `Bearer ${config.nvidiaApiKey}`
            },
            signal: AbortSignal.timeout(Math.min(config.timeout, 5_000))
          })
        : await fetch(`${config.baseUrl}/api/tags`, {
            method: "GET",
            signal: AbortSignal.timeout(Math.min(config.timeout, 5_000))
          });

      const available = response.ok;
      this._availabilityCache = {
        available,
        provider: config.provider,
        baseUrl: config.baseUrl,
        checkedAt: now
      };

      return available;
    } catch (error) {
      console.warn(`${this._getProviderDisplayName(config.provider)} not available:`, error.message);
      this._availabilityCache = {
        available: false,
        provider: config.provider,
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
        reason: `${this._getProviderDisplayName(config.provider)} unavailable`,
        securityIssues: []
      };
    }

    try {
      this._lastValidationLanguage = language;
      const fixedCode = await this._requestProviderFix(
        config,
        safeOriginal,
        safeRuleBased,
        language
      );

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

  _normalizeProvider(provider) {
    const normalized = typeof provider === "string" ? provider.trim().toLowerCase() : "";
    return SUPPORTED_PROVIDERS.has(normalized) ? normalized : "ollama";
  }

  _normalizeOllamaUrl(url) {
    let normalized =
      typeof url === "string" && url.trim()
        ? url.trim()
        : "http://localhost:11434";
    normalized = normalized.replace(/\/+$/, "");
    if (/\/api$/i.test(normalized)) {
      normalized = normalized.replace(/\/api$/i, "");
    }
    return normalized || "http://localhost:11434";
  }

  _getProviderDisplayName(provider) {
    return provider === "nvidia" ? "NVIDIA" : "Ollama";
  }

  _sanitizeNvidiaModel(model) {
    const value = typeof model === "string" ? model.trim() : "";
    if (!value) return NVIDIA_DEFAULT_MODEL;
    if (NVIDIA_MODEL_ALIASES.has(value)) return NVIDIA_MODEL_ALIASES.get(value);
    if (/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(value)) return value;
    return NVIDIA_DEFAULT_MODEL;
  }

  async _requestProviderFix(config, originalCode, ruleBasedFix, language) {
    if (config.provider === "nvidia") {
      return this._requestNvidiaFix(config, originalCode, ruleBasedFix, language);
    }
    return this._requestOllamaFix(config, originalCode, ruleBasedFix, language);
  }

  async _requestOllamaFix(config, originalCode, ruleBasedFix, language) {
    const response = await fetch(`${config.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(config.timeout),
      body: JSON.stringify({
        model: config.model,
        prompt: this.buildPrompt(originalCode, ruleBasedFix, language),
        stream: false,
        options: {
          temperature: 0,
          num_predict: Math.min(768, Math.max(256, ruleBasedFix.length / 4)),
          top_k: 20,
          top_p: 0.8
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    return this.extractCode(data.response, ruleBasedFix);
  }

  async _requestNvidiaFix(config, originalCode, ruleBasedFix, language) {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.nvidiaApiKey}`
      },
      signal: AbortSignal.timeout(config.timeout),
      body: JSON.stringify({
        model: this._sanitizeNvidiaModel(config.model),
        messages: [
          {
            role: "system",
            content:
              "You repair code with the smallest safe diff. Return only the fixed code with no markdown or explanations."
          },
          {
            role: "user",
            content: this.buildPrompt(originalCode, ruleBasedFix, language)
          }
        ],
        stream: false,
        temperature: 0.15,
        top_p: 0.8,
        max_tokens: Math.min(1024, Math.max(256, Math.ceil(ruleBasedFix.length / 3)))
      })
    });

    if (!response.ok) {
      throw new Error(`NVIDIA API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    return this.extractCode(content, ruleBasedFix);
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
