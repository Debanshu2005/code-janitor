const vscode = require("vscode");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const SelfDiagnosingErrorHandler = require("../self-healing/error-handler");
const {
  extractReadableContent,
  extractUrls,
  isUrlOnlyMessage
} = require("./web-content-utils");
const {
  buildGraphLookupContext,
  isValidGraphData,
  matchGraphPathsFromHints
} = require("./graph-context");

const MAX_SCAN_FILE_SIZE = 200 * 1024;
const MAX_CONTEXT_CHARS = 8_000;
const MAX_FILE_SNIPPET = 1_200;
const MAX_EDIT_TARGET_SNIPPET = 6_000;
const MAX_FAST_EDIT_ACTIVE_FILE_CHARS = 4_000;
const MAX_RELEVANT_FILES = 3;
const MAX_OPEN_TAB_SNIPPETS = 1;
const MAX_HISTORY_ENTRIES = 3;
const MAX_SESSION_RECENT_ENTRIES = 8;
const MAX_SESSION_PERSISTED_ENTRIES = 24;
const MAX_SESSION_SUMMARY_CHARS = 2_400;
const MAX_CHAT_SESSIONS = 12;
const RELEVANT_FILE_CACHE_LIMIT = 30;
const REPETITION_WINDOW = 150;
const REPETITION_WINDOW_HEAVY = 300;
const SCAN_STALE_MS = 45_000;
const MAX_COMMAND_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_CHARS = 12_000;
const MAX_FETCHED_URLS = 2;
const MAX_FETCHED_CONTENT_CHARS = 5_000;
const IGNORED_DIRS = new Set([
  ".git",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "out",
  "venv",
  "formatters",
  "data"
]);
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "with"
]);
const CONTENT_NOISE_WORDS = new Set([
  "fix",
  "fixes",
  "fixed",
  "error",
  "errors",
  "issue",
  "issues",
  "bug",
  "bugs",
  "problem",
  "problems",
  "broken",
  "failing",
  "why",
  "how",
  "what",
  "help"
]);
const CODE_EXTENSIONS = /\.(js|jsx|ts|tsx|py|java|c|cpp|h|html|css|json|md)$/i;
const NVIDIA_MODEL_ALIASES = new Map([
  ["nvidia/minimax-m2.7", "minimaxai/minimax-m2.7"],
  ["nvidia/llama-3.1-nemotron-70b-instruct", "meta/llama-3.1-70b-instruct"],
  ["nvidia/mistral-nemo-minitron-8b-8k-instruct", "mistralai/mistral-nemotron"],
  ["nvidia/llama-3.1-nemotron-51b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1.5"],
  ["minimaxai/minimax-m2.7", "minimaxai/minimax-m2.7"],
  ["meta/llama-3.1-8b-instruct", "meta/llama-3.1-8b-instruct"],
  ["meta/llama-3.1-70b-instruct", "meta/llama-3.1-70b-instruct"],
  ["mistralai/mistral-nemotron", "mistralai/mistral-nemotron"]
]);
const NVIDIA_MODEL_DISCOVERY_TTL_MS = 5 * 60 * 1000;
const NVIDIA_FALLBACK_MODELS = [
  "meta/llama-3.1-8b-instruct",
  "nvidia/nvidia-nemotron-nano-9b-v2",
  "minimaxai/minimax-m2.7",
  "mistralai/mistral-nemotron",
  "meta/llama-3.1-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5"
];

class AIAgent {
  constructor(context = null) {
    this.codebaseContext = new Map();
    this.context = context;
    const persistedChatState = this._loadPersistedChatState();
    this.chatSessions = persistedChatState.sessions;
    this.currentSessionId = persistedChatState.currentSessionId;
    this.conversationHistory = [];
    this.scanVersion = 0;
    this.lastScanAt = 0;
    this.workspaceRoot = null;
    this.currentEditableTargets = null;
    this._lastActiveEditor = vscode.window.activeTextEditor || null;
    this._relevantFileCache = new Map();
    this._knowledgeGraphCache = new Map();
    this._nvidiaModelsCache = [];
    this._nvidiaModelsFetchedAt = 0;
    this.showThinking = false;
    this.errorHandler = new SelfDiagnosingErrorHandler(this);
    this._syncCurrentSessionReferences();

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === "file") {
        this._lastActiveEditor = editor;
      }
      this._relevantFileCache.clear();
    });
  }

  setActiveEditor(editor) {
    if (editor && editor.document.uri.scheme === "file") {
      this._lastActiveEditor = editor;
    }
  }

  _getConversationStateKey() {
    return "codeJanitor.ai.chatHistory";
  }

  _getChatSessionsStateKey() {
    return "codeJanitor.ai.chatSessions";
  }

  _sanitizeHistoryEntries(history) {
    if (!Array.isArray(history)) return [];
    return history
      .filter(
        (entry) =>
          entry &&
          (entry.role === "user" || entry.role === "assistant") &&
          typeof entry.content === "string" &&
          entry.content.trim().length > 0
      )
      .map((entry) => ({
        role: entry.role,
        content: entry.content.trim()
      }))
      .slice(-MAX_SESSION_PERSISTED_ENTRIES);
  }

  _createSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  _buildDefaultSessionTitle() {
    return `New Chat ${this.chatSessions?.length ? this.chatSessions.length + 1 : 1}`;
  }

  _createSessionRecord(overrides = {}) {
    const now = Date.now();
    return {
      id: overrides.id || this._createSessionId(),
      title:
        typeof overrides.title === "string" && overrides.title.trim()
          ? overrides.title.trim()
          : this._buildDefaultSessionTitle(),
      createdAt:
        Number.isFinite(overrides.createdAt) && overrides.createdAt > 0
          ? overrides.createdAt
          : now,
      updatedAt:
        Number.isFinite(overrides.updatedAt) && overrides.updatedAt > 0
          ? overrides.updatedAt
          : now,
      summary:
        typeof overrides.summary === "string" ? overrides.summary.trim() : "",
      compactedCount:
        Number.isFinite(overrides.compactedCount) && overrides.compactedCount > 0
          ? overrides.compactedCount
          : 0,
      history: this._sanitizeHistoryEntries(overrides.history || [])
    };
  }

  _loadPersistedChatState() {
    const rawState = this.context?.globalState?.get(
      this._getChatSessionsStateKey(),
      null
    );
    if (
      rawState &&
      Array.isArray(rawState.sessions) &&
      rawState.sessions.length > 0
    ) {
      const sessions = rawState.sessions.map((session) =>
        this._createSessionRecord(session)
      );
      if (sessions.length > 0) {
        const currentSessionId = sessions.some(
          (session) => session.id === rawState.currentSessionId
        )
          ? rawState.currentSessionId
          : sessions[0].id;
        return { sessions, currentSessionId };
      }
    }

    const legacyHistory = this._sanitizeHistoryEntries(
      this.context?.globalState?.get(this._getConversationStateKey(), [])
    );
    const defaultSession = this._createSessionRecord({
      title: "New Chat 1",
      history: legacyHistory
    });
    return {
      sessions: [defaultSession],
      currentSessionId: defaultSession.id
    };
  }

  _getCurrentSession() {
    let session = this.chatSessions.find(
      (candidate) => candidate.id === this.currentSessionId
    );
    if (!session) {
      session =
        this.chatSessions[0] || this._createSessionRecord({ title: "New Chat 1" });
      if (this.chatSessions.length === 0) {
        this.chatSessions = [session];
      }
      this.currentSessionId = session.id;
    }
    return session;
  }

  _syncCurrentSessionReferences() {
    const session = this._getCurrentSession();
    this.conversationHistory = session.history;
    return session;
  }

  _persistChatState() {
    if (!this.context?.globalState) return;
    const sessions = this.chatSessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CHAT_SESSIONS)
      .map((session) =>
        this._createSessionRecord({
          ...session,
          history: session.history.slice(-MAX_SESSION_PERSISTED_ENTRIES),
          summary: String(session.summary || "").slice(0, MAX_SESSION_SUMMARY_CHARS)
        })
      );
    this.chatSessions = sessions;
    if (!sessions.some((session) => session.id === this.currentSessionId)) {
      this.currentSessionId = sessions[0]?.id || this._createSessionRecord().id;
    }
    this.context.globalState.update(this._getChatSessionsStateKey(), {
      currentSessionId: this.currentSessionId,
      sessions
    });
    this.context.globalState.update(this._getConversationStateKey(), undefined);
  }

  _touchCurrentSession() {
    const session = this._getCurrentSession();
    session.updatedAt = Date.now();
    return session;
  }

  _condenseHistoryEntry(content, maxLength = 220) {
    const normalized = String(content || "")
      .replace(/```[\s\S]*?```/g, "[code block]")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return "";
    return normalized.length > maxLength
      ? `${normalized.slice(0, maxLength - 3)}...`
      : normalized;
  }

  _buildHistorySummaryChunk(entries) {
    return entries
      .map((entry) => {
        const condensed = this._condenseHistoryEntry(entry.content);
        if (!condensed) return "";
        return `- ${entry.role === "user" ? "User" : "Assistant"}: ${condensed}`;
      })
      .filter(Boolean)
      .join("\n");
  }

  _mergeSessionSummary(existingSummary, nextChunk) {
    const sections = [String(existingSummary || "").trim(), String(nextChunk || "").trim()]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (sections.length <= MAX_SESSION_SUMMARY_CHARS) {
      return sections;
    }
    return sections.slice(sections.length - MAX_SESSION_SUMMARY_CHARS);
  }

  _compactCurrentSessionHistory() {
    const session = this._getCurrentSession();
    if (session.history.length <= MAX_SESSION_RECENT_ENTRIES + 4) {
      return false;
    }

    const compactedEntries = session.history.slice(
      0,
      session.history.length - MAX_SESSION_RECENT_ENTRIES
    );
    if (compactedEntries.length === 0) {
      return false;
    }

    const summaryChunk = this._buildHistorySummaryChunk(compactedEntries);
    session.summary = this._mergeSessionSummary(session.summary, summaryChunk);
    session.compactedCount =
      Number(session.compactedCount || 0) + compactedEntries.length;
    session.history = session.history.slice(-MAX_SESSION_RECENT_ENTRIES);
    this.conversationHistory = session.history;
    return true;
  }

  _maybeAutoTitleCurrentSession(content) {
    const session = this._getCurrentSession();
    const currentTitle = String(session.title || "").trim();
    if (!/^New Chat(?: \d+)?$/i.test(currentTitle)) {
      return;
    }

    const title = this._condenseHistoryEntry(content, 42)
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    if (title) {
      session.title = title;
    }
  }

  _appendConversationEntry(role, content) {
    if (
      (role !== "user" && role !== "assistant") ||
      typeof content !== "string" ||
      !content.trim()
    ) {
      return;
    }

    const session = this._touchCurrentSession();
    session.history.push({ role, content: content.trim() });
    if (role === "user") {
      this._maybeAutoTitleCurrentSession(content);
    }
    this._compactCurrentSessionHistory();
    this._persistChatState();
  }

  getConversationHistory() {
    return this._getCurrentSession().history.slice();
  }

  getSessionState() {
    const currentSession = this._syncCurrentSessionReferences();
    const sessions = this.chatSessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        compactedCount: session.compactedCount || 0
      }));
    return {
      currentSessionId: currentSession.id,
      currentSessionTitle: currentSession.title,
      compactedCount: currentSession.compactedCount || 0,
      sessions,
      history: currentSession.history.slice()
    };
  }

  createSession(title = "") {
    const session = this._createSessionRecord({
      title: title || this._buildDefaultSessionTitle()
    });
    this.chatSessions = [session].concat(
      this.chatSessions.filter((candidate) => candidate.id !== session.id)
    );
    this.currentSessionId = session.id;
    this._syncCurrentSessionReferences();
    this._persistChatState();
    return this.getSessionState();
  }

  switchSession(sessionId) {
    if (!sessionId) return this.getSessionState();
    const sessionExists = this.chatSessions.some(
      (session) => session.id === sessionId
    );
    if (!sessionExists) return this.getSessionState();
    this.currentSessionId = sessionId;
    this._syncCurrentSessionReferences();
    this._persistChatState();
    return this.getSessionState();
  }

  _buildPromptHistoryContext(isTabQuestion = false) {
    const session = this._getCurrentSession();
    const parts = [];
    if (session.summary) {
      parts.push(`Conversation summary:\n${session.summary}`);
    }

    const recentEntries = isTabQuestion
      ? session.history.filter((entry) => entry.role === "user").slice(-2, -1)
      : session.history.slice(-MAX_HISTORY_ENTRIES, -1);
    const historyText = recentEntries
      .map(
        (entry) =>
          `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content.slice(0, 300)}`
      )
      .join("\n\n");
    if (historyText) {
      parts.push(historyText);
    }

    return parts.join("\n\n");
  }

  getConfig() {
    const config = vscode.workspace.getConfiguration("codeJanitor.ai");
    const provider = config.get("provider", "ollama");
    const rawOllamaUrl = config.get("ollamaUrl", "http://localhost:11434");
    const ollamaUrl = this._normalizeOllamaUrl(rawOllamaUrl);
    const genericModel = String(config.get("model", "") || "").trim();
    const nvidiaModel = String(
      config.get("nvidiaModel", this._getDefaultModelForProvider("nvidia")) || ""
    ).trim();
    const model = this._resolveConfiguredModel(
      provider,
      genericModel,
      nvidiaModel
    );
    return {
      enabled: config.get("enabled", true),
      provider,
      ollamaUrl,
      model,
      nvidiaModel: this._sanitizeNvidiaModel(nvidiaModel || model),
      groqApiKey: config.get("groqApiKey", ""),
      openrouterApiKey: config.get("openrouterApiKey", ""),
      anthropicApiKey: config.get("anthropicApiKey", ""),
      nvidiaApiKey: config.get("nvidiaApiKey", ""),
      timeout: config.get("timeout", 300_000),
      maxTokens: {
        fast: Math.max(512, Math.min(4096, config.get("maxTokens.fast", 2048))),
        heavy: Math.max(1024, Math.min(8192, config.get("maxTokens.heavy", 4096))),
        deep: Math.max(2048, Math.min(16384, config.get("maxTokens.deep", 8192))),
        create: Math.max(2048, Math.min(16384, config.get("maxTokens.create", 8192)))
      }
    };
  }

  _getDefaultModelForProvider(provider) {
    if (provider === "groq") return "llama-3.1-8b-instant";
    if (provider === "openrouter") {
      return "meta-llama/llama-3.1-8b-instruct:free";
    }
    if (provider === "anthropic") return "claude-3-5-haiku-20241022";
    if (provider === "nvidia") return NVIDIA_FALLBACK_MODELS[0];
    return "qwen2.5-coder:1.5b";
  }

  _sanitizeNvidiaModel(model) {
    const value = typeof model === "string" ? model.trim() : "";
    if (!value) return this._getDefaultModelForProvider("nvidia");
    if (NVIDIA_MODEL_ALIASES.has(value)) return NVIDIA_MODEL_ALIASES.get(value);
    if (/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(value)) return value;

    // Old broken settings sometimes stored a function UUID instead of a model.
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
    ) {
      return this._getDefaultModelForProvider("nvidia");
    }

    return this._getDefaultModelForProvider("nvidia");
  }

  _resolveConfiguredModel(provider, genericModel, nvidiaModel) {
    if (provider === "nvidia") {
      const preferred = this._sanitizeNvidiaModel(nvidiaModel);
      if (preferred) {
        return preferred;
      }
      return this._sanitizeNvidiaModel(genericModel);
    }

    const normalizedGeneric =
      typeof genericModel === "string" ? genericModel.trim() : "";
    return normalizedGeneric || this._getDefaultModelForProvider(provider);
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

  async _fetchOllamaModelNames(ollamaUrl, timeoutMs = 8_000) {
    try {
      const response = await fetch(`${ollamaUrl}/api/tags`, {
        signal: this._createRequestSignal(null, timeoutMs)
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models || []).map((entry) => entry.name).filter(Boolean);
    } catch {
      return [];
    }
  }

  _looksLikeNvidiaChatModel(modelId) {
    const value = String(modelId || "").trim().toLowerCase();
    if (!value) return false;

    const blockedFragments = [
      "embed",
      "rerank",
      "guard",
      "safety",
      "topic-control",
      "jailbreak",
      "detect",
      "dino",
      "ocdrnet",
      "bevformer",
      "clip",
      "parse",
      "translate",
      "asr",
      "tts",
      "ocr",
      "object-detection"
    ];

    return !blockedFragments.some((fragment) => value.includes(fragment));
  }

  _looksLikeChatModel(modelId) {
    const value = String(modelId || "").trim().toLowerCase();
    if (!value) return false;

    const blockedFragments = [
      "embed",
      "embedding",
      "rerank",
      "guard",
      "safety",
      "moderation",
      "whisper",
      "tts",
      "asr",
      "speech-to-text",
      "text-to-speech"
    ];

    return !blockedFragments.some((fragment) => value.includes(fragment));
  }

  _extractModelIds(data, filterFn = null) {
    const entries = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : Array.isArray(data)
          ? data
          : [];

    return Array.from(
      new Set(
        entries
          .map((entry) =>
            typeof entry === "string"
              ? entry.trim()
              : String(entry?.id || entry?.name || "").trim()
          )
          .filter(Boolean)
          .filter((modelId) => (filterFn ? filterFn(modelId) : true))
      )
    );
  }

  async _fetchModelIdsFromEndpoint(url, { headers = {}, timeoutMs = 8_000, filterFn = null } = {}) {
    try {
      const response = await fetch(url, {
        headers,
        signal: this._createRequestSignal(null, timeoutMs)
      });
      if (!response.ok) return [];

      const data = await response.json();
      return this._extractModelIds(data, filterFn);
    } catch {
      return [];
    }
  }

  _getOpenAiCompatibleModelsUrl(baseUrl) {
    const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!normalized) return "";
    if (/\/chat\/completions$/i.test(normalized)) {
      return normalized.replace(/\/chat\/completions$/i, "/models");
    }
    if (/\/v1$/i.test(normalized)) return `${normalized}/models`;
    if (/\/models$/i.test(normalized)) return normalized;
    return `${normalized}/v1/models`;
  }

  async _fetchGroqModelNames(apiKey, timeoutMs = 8_000) {
    if (!apiKey) return [];
    return this._fetchModelIdsFromEndpoint("https://api.groq.com/openai/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeoutMs,
      filterFn: (modelId) => this._looksLikeChatModel(modelId)
    });
  }

  async _fetchOpenRouterModelNames(apiKey, timeoutMs = 8_000) {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    return this._fetchModelIdsFromEndpoint("https://openrouter.ai/api/v1/models?output_modalities=text", {
      headers,
      timeoutMs,
      filterFn: (modelId) => this._looksLikeChatModel(modelId)
    });
  }

  async _fetchAnthropicModelNames(apiKey, timeoutMs = 8_000) {
    if (!apiKey) return [];
    return this._fetchModelIdsFromEndpoint("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      timeoutMs
    });
  }

  async _fetchOpenAiCompatibleModelNames(baseUrl, apiKey, timeoutMs = 8_000) {
    const modelsUrl = this._getOpenAiCompatibleModelsUrl(baseUrl);
    if (!modelsUrl) return [];

    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    return this._fetchModelIdsFromEndpoint(modelsUrl, {
      headers,
      timeoutMs,
      filterFn: (modelId) => this._looksLikeChatModel(modelId)
    });
  }

  async _fetchNvidiaModelNames(apiKey, timeoutMs = 8_000, forceRefresh = false) {
    const cacheAge = Date.now() - this._nvidiaModelsFetchedAt;
    if (
      !forceRefresh &&
      this._nvidiaModelsCache.length > 0 &&
      cacheAge < NVIDIA_MODEL_DISCOVERY_TTL_MS
    ) {
      return this._nvidiaModelsCache.slice();
    }

    if (!apiKey) return [];

    try {
      const response = await fetch("https://integrate.api.nvidia.com/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        signal: this._createRequestSignal(null, timeoutMs)
      });
      if (!response.ok) return [];

      const data = await response.json();
      const models = Array.from(
        new Set(
          (data?.data || [])
            .map((entry) =>
              typeof entry === "string"
                ? entry.trim()
                : String(entry?.id || entry?.name || "").trim()
            )
            .filter(Boolean)
            .filter((modelId) => this._looksLikeNvidiaChatModel(modelId))
        )
      );

      if (models.length > 0) {
        this._nvidiaModelsCache = models;
        this._nvidiaModelsFetchedAt = Date.now();
      }

      return models;
    } catch {
      return [];
    }
  }

  _pickOllamaModel(models, currentModel) {
    if (!Array.isArray(models) || models.length === 0) return currentModel;
    if (currentModel && models.includes(currentModel)) return currentModel;

    const preferredModels = [
      "qwen2.5-coder:1.5b",
      "codellama:latest",
      "llama3:latest"
    ];
    for (const candidate of preferredModels) {
      if (models.includes(candidate)) return candidate;
    }

    return models[0];
  }

  _pickNvidiaModel(models, currentModel) {
    const normalizedCurrent = this._sanitizeNvidiaModel(currentModel);
    if (Array.isArray(models) && models.includes(normalizedCurrent)) {
      return normalizedCurrent;
    }

    for (const candidate of NVIDIA_FALLBACK_MODELS) {
      if (Array.isArray(models) && models.includes(candidate)) {
        return candidate;
      }
    }

    return Array.isArray(models) && models.length > 0
      ? models[0]
      : normalizedCurrent;
  }

  async getAvailableModelsForProvider(
    provider,
    {
      ollamaUrl = "",
      groqApiKey = "",
      openrouterApiKey = "",
      anthropicApiKey = "",
      nvidiaApiKey = "",
      timeoutMs = 8_000,
      forceRefresh = false,
      customProvider = null
    } = {}
  ) {
    if (provider === "ollama") {
      return this._fetchOllamaModelNames(
        ollamaUrl || this.getConfig().ollamaUrl,
        timeoutMs
      );
    }

    if (provider === "groq") {
      return this._fetchGroqModelNames(groqApiKey || this.getConfig().groqApiKey, timeoutMs);
    }

    if (provider === "openrouter") {
      return this._fetchOpenRouterModelNames(
        openrouterApiKey || this.getConfig().openrouterApiKey,
        timeoutMs
      );
    }

    if (provider === "anthropic") {
      return this._fetchAnthropicModelNames(
        anthropicApiKey || this.getConfig().anthropicApiKey,
        timeoutMs
      );
    }

    if (provider === "nvidia") {
      return this._fetchNvidiaModelNames(
        nvidiaApiKey || this.getConfig().nvidiaApiKey,
        timeoutMs,
        forceRefresh
      );
    }

    if (customProvider) {
      return this._fetchOpenAiCompatibleModelNames(
        customProvider.chatCompletionsUrl || customProvider.baseUrl,
        customProvider.apiKey || "",
        timeoutMs
      );
    }

    return [];
  }

  async _prepareRuntimeConfig(config, reportStatus) {
    if (!config) {
      return config;
    }

    const baseConfig = {
      ...config,
      timeout: Math.max(config.timeout || 0, 300_000)
    };

    // Skip model discovery for non-Ollama/NVIDIA providers
    if (config.provider !== "nvidia" && config.provider !== "ollama") {
      return baseConfig;
    }

    // For NVIDIA: Try quick model discovery with short timeout, fallback to configured model
    if (config.provider === "nvidia") {
      try {
        const discoveredModels = await Promise.race([
          this._fetchNvidiaModelNames(config.nvidiaApiKey, 3_000),
          new Promise((resolve) => setTimeout(() => resolve([]), 3_000))
        ]);
        
        const currentModel = this._sanitizeNvidiaModel(
          config.model || config.nvidiaModel
        );
        
        if (discoveredModels.length > 0) {
          const resolvedModel = this._pickNvidiaModel(discoveredModels, currentModel);
          if (resolvedModel !== currentModel) {
            reportStatus?.(
              `NVIDIA model ${currentModel} was unavailable. Using ${resolvedModel} instead.`
            );
          }
          return {
            ...baseConfig,
            model: resolvedModel,
            nvidiaModel: resolvedModel
          };
        }
      } catch (err) {
        console.warn('[Agent] NVIDIA model discovery failed, using configured model:', err.message);
      }
      
      // Fallback: use configured model without discovery
      return {
        ...baseConfig,
        model: this._sanitizeNvidiaModel(config.model || config.nvidiaModel),
        nvidiaModel: this._sanitizeNvidiaModel(config.model || config.nvidiaModel)
      };
    }

    // For Ollama: Try quick model discovery with short timeout, fallback to configured model
    if (config.provider === "ollama") {
      try {
        const models = await Promise.race([
          this._fetchOllamaModelNames(baseConfig.ollamaUrl, 3_000),
          new Promise((resolve) => setTimeout(() => resolve([]), 3_000))
        ]);
        
        if (models.length > 0) {
          const resolvedModel = this._pickOllamaModel(models, baseConfig.model);
          if (resolvedModel !== baseConfig.model) {
            reportStatus?.(
              `Ollama model ${baseConfig.model} was unavailable. Using ${resolvedModel} instead.`
            );
          }
          return {
            ...baseConfig,
            model: resolvedModel
          };
        }
      } catch (err) {
        console.warn('[Agent] Ollama model discovery failed, using configured model:', err.message);
      }
      
      // Fallback: use configured model without discovery
      return baseConfig;
    }

    return baseConfig;
  }

  _getLatencyProfile(config, mode = "fast", intent = "general") {
    const resolvedModel =
      config?.provider === "nvidia"
        ? this._sanitizeNvidiaModel(config.model || config.nvidiaModel)
        : String(config?.model || "").trim();
    const profile = {
      maxTokens: mode === "deep" ? 4608 : mode === "heavy" ? 3072 : 1024,
      relevantFileCount: MAX_RELEVANT_FILES,
      fileSnippetChars: MAX_FILE_SNIPPET,
      contextChars: MAX_CONTEXT_CHARS,
      repoContextPolicy: "normal"
    };

    if ((mode === "heavy" || mode === "deep") && intent === "create") {
      profile.maxTokens = 8192;
    }

    if (config?.provider === "nvidia" && mode === "fast") {
      profile.maxTokens = 640;
      profile.relevantFileCount = 2;
      profile.fileSnippetChars = 700;
      profile.contextChars = 3500;
      profile.repoContextPolicy = "explicit";
    }

    if (
      config?.provider === "nvidia" &&
      resolvedModel === "meta/llama-3.1-70b-instruct"
    ) {
      if (mode === "fast") {
        profile.maxTokens = 768;
        profile.relevantFileCount = 2;
        profile.fileSnippetChars = 850;
        profile.contextChars = 4200;
        profile.repoContextPolicy = "explicit";
      } else if (mode === "heavy") {
        profile.maxTokens = intent === "create" ? 4096 : 2304;
        profile.relevantFileCount = 3;
        profile.fileSnippetChars = 950;
        profile.contextChars = 5200;
      } else if (mode === "deep") {
        profile.maxTokens = intent === "create" ? 8192 : 4608;
        profile.relevantFileCount = 3;
        profile.fileSnippetChars = 1100;
        profile.contextChars = 6500;
      }
    }

    return profile;
  }

  _buildRequestOptions(config, prompt, mode = "fast", intent = "general") {
    const isUnlimited = mode === "deep" && intent === "create";
    const latencyProfile = this._getLatencyProfile(config, mode, intent);
    const optimizedMaxTokens = isUnlimited ? 8192 : latencyProfile.maxTokens;

    // Log API key status for debugging
    console.log("[Agent] Building request for provider:", config.provider);
    console.log("[Agent] API key status:", {
      groq: config.groqApiKey ? `${config.groqApiKey.substring(0, 10)}... (length: ${config.groqApiKey.length})` : "(empty)",
      openrouter: config.openrouterApiKey ? `${config.openrouterApiKey.substring(0, 10)}... (length: ${config.openrouterApiKey.length})` : "(empty)",
      anthropic: config.anthropicApiKey ? `${config.anthropicApiKey.substring(0, 10)}... (length: ${config.anthropicApiKey.length})` : "(empty)",
      nvidia: config.nvidiaApiKey ? `${config.nvidiaApiKey.substring(0, 10)}... (length: ${config.nvidiaApiKey.length})` : "(empty)"
    });

    // Split prompt into system + user parts using unique markers
    const SYS_END = "\n\n### USER_MESSAGE ###\n";
    const sysIdx = prompt.indexOf(SYS_END);
    const sysContent =
      sysIdx > 0
        ? prompt.slice(0, sysIdx).trim()
        : "You are a coding assistant.";
    const userContent =
      sysIdx > 0
        ? prompt
            .slice(sysIdx + SYS_END.length)
            .replace(/\nAssistant:$/, "")
            .trim()
        : prompt;

    if (config.customProvider?.protocol === "openai") {
      return {
        url: config.customProvider.chatCompletionsUrl,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.customProvider.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: sysContent },
            { role: "user", content: userContent }
          ],
          stream: true,
          temperature: 0.2,
          max_tokens: optimizedMaxTokens,
          top_p: 0.9
        }),
        parseChunk: (line) => {
          if (!line.startsWith("data: ") || line === "data: [DONE]") return null;
          try {
            return (
              JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || null
            );
          } catch {
            return null;
          }
        }
      };
    }

    if (config.provider === "anthropic") {
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.anthropicApiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: optimizedMaxTokens,
          stream: true,
          system: sysContent,
          messages: [{ role: "user", content: userContent }]
        }),
        parseChunk: (line) => {
          if (!line.startsWith("data: ")) return null;
          try {
            const d = JSON.parse(line.slice(6));
            return d.type === "content_block_delta"
              ? d.delta?.text || null
              : null;
          } catch {
            return null;
          }
        }
      };
    }
    if (config.provider === "groq") {
      const apiKey = config.groqApiKey;
      console.log("[Agent] Groq request - API key:", apiKey ? `${apiKey.substring(0, 10)}... (length: ${apiKey.length})` : "(EMPTY!)");
      return {
        url: "https://api.groq.com/openai/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: sysContent },
            { role: "user", content: userContent }
          ],
          stream: true,
          temperature: 0.2,
          max_tokens: optimizedMaxTokens,
          top_p: 0.9,
          frequency_penalty: 0.2
        }),
        parseChunk: (line) => {
          if (!line.startsWith("data: ") || line === "data: [DONE]") return null;
          try {
            return (
              JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || null
            );
          } catch {
            return null;
          }
        }
      };
    }
    if (config.provider === "openrouter") {
      return {
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.openrouterApiKey}`,
          "HTTP-Referer": "https://github.com/Debanshu2005/code-janitor",
          "X-Title": "Code Janitor"
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: sysContent },
            { role: "user", content: userContent }
          ],
          stream: true,
          temperature: 0.2,
          max_tokens: optimizedMaxTokens,
          top_p: 0.9
        }),
        parseChunk: (line) => {
          if (!line.startsWith("data: ") || line === "data: [DONE]") return null;
          try {
            return (
              JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || null
            );
          } catch {
            return null;
          }
        }
      };
    }
    if (config.provider === "nvidia") {
      const resolvedModel = this._sanitizeNvidiaModel(config.model || config.nvidiaModel);
      const isMinimax = resolvedModel === "minimaxai/minimax-m2.7";
      const isLlama70b = resolvedModel === "meta/llama-3.1-70b-instruct";
      const isNemotron = resolvedModel === "nvidia/llama-3.3-nemotron-super-49b-v1.5";
      
      const minimaxOptimizations = isMinimax ? {
        top_p: 0.8,
        frequency_penalty: 0.3,
        presence_penalty: 0.1
      } : {};
      const llama70bOptimizations = isLlama70b ? {
        top_p: 0.72,
        frequency_penalty: 0.0,
        presence_penalty: 0.0
      } : {};
      
      const nemotronOptimizations = isNemotron ? {
        top_p: 0.95,
        frequency_penalty: 0.0,
        presence_penalty: 0.0
      } : {};
      
      return {
        url: "https://integrate.api.nvidia.com/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.nvidiaApiKey}`
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: [
            { role: "system", content: sysContent },
            { role: "user", content: userContent }
          ],
          stream: true,
          temperature: isMinimax ? 0.3 : isNemotron ? 0.7 : isLlama70b ? 0.15 : 0.2,
          max_tokens: optimizedMaxTokens,
          ...minimaxOptimizations,
          ...llama70bOptimizations,
          ...nemotronOptimizations
        }),
        parseChunk: (line) => {
          if (!line.startsWith("data: ") || line === "data: [DONE]") return null;
          try {
            const token = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || null;
            if (!token) return null;
            // Filter out <think> tags and their content
            if (token.includes("<think>") || token.includes("</think>")) {
              return null;
            }
            return token;
          } catch {
            return null;
          }
        },
        smoothStreaming: isNemotron  // Flag for smoother streaming
      };
    }
    // Ollama — use /api/chat for proper system/user role support
    return {
      url: `${config.ollamaUrl}/api/chat`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: sysContent },
          { role: "user", content: userContent }
        ],
        stream: true,
        options: {
          temperature: 0.2,
          num_predict: mode === "deep" ? -1 : mode === "heavy" ? 2048 : 1024,
          top_k: 15,
          top_p: 0.85,
          num_ctx: 2048,
          repeat_penalty: 1.15
        }
      }),
      parseChunk: (line) => {
        try {
          const d = JSON.parse(line);
          if (d.done) return null;
          return d.message?.content || null;
        } catch {
          return null;
        }
      }
    };
  }

  _createRequestSignal(abortSignal, timeoutMs) {
    if (!abortSignal) {
      return AbortSignal.timeout(timeoutMs);
    }

    if (typeof AbortSignal.any === "function") {
      return AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)]);
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    abortSignal.addEventListener("abort", onAbort, { once: true });
    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        abortSignal.removeEventListener("abort", onAbort);
      },
      { once: true }
    );

    return controller.signal;
  }

  async _buildHttpError(response, prefix) {
    let details = "";
    try {
      const bodyText = await response.text();
      if (bodyText) {
        const trimmed = bodyText.trim();
        try {
          const parsed = JSON.parse(trimmed);
          details =
            parsed?.error?.message ||
            parsed?.error ||
            parsed?.message ||
            parsed?.detail ||
            trimmed;
        } catch {
          details = trimmed;
        }
      }
    } catch {
      details = "";
    }

    const shortDetails =
      typeof details === "string" && details.length > 0
        ? `: ${details.slice(0, 280)}`
        : "";
    return `${prefix} ${response.status}${shortDetails}`;
  }

  async scanCodebase(workspaceFolder) {
    this.codebaseContext.clear();
    this.scanVersion += 1;
    this.workspaceRoot = workspaceFolder;
    this._relevantFileCache.clear();

    const files = await this._getAllFiles(workspaceFolder);
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        if (stat.size > MAX_SCAN_FILE_SIZE) {
          continue;
        }

        const content = await fs.readFile(file, "utf8");
        const relativePath = path.relative(workspaceFolder, file);
        this.codebaseContext.set(relativePath, {
          content,
          fullPath: file,
          fileName: path.basename(relativePath).toLowerCase(),
          directory: path.dirname(relativePath).toLowerCase()
        });
      } catch (error) {
        console.warn(`Failed to read ${file}:`, error.message);
      }
    }

    this.lastScanAt = Date.now();
    return this.codebaseContext.size;
  }

  async ensureCodebaseScanned(workspaceFolder, force = false) {
    const scanIsFresh =
      this.workspaceRoot === workspaceFolder &&
      Date.now() - this.lastScanAt < SCAN_STALE_MS &&
      this.codebaseContext.size > 0;

    if (force || !scanIsFresh) {
      return this.scanCodebase(workspaceFolder);
    }

    return this.codebaseContext.size;
  }

  async prepareWorkspaceContext(userMessage, workspaceFolder, options = {}) {
    if (!workspaceFolder) {
      return {
        available: false,
        indexedFiles: 0,
        relevantFiles: [],
        activeFile: null
      };
    }

    const indexedFiles = await this.ensureCodebaseScanned(
      workspaceFolder,
      !!options.force
    );
    const relevantFiles = this._findRelevantFiles(
      userMessage || "",
      workspaceFolder
    ).map((file) => file.path.replace(/\\/g, "/"));
    const editorState = this._getEditorState(workspaceFolder);

    return {
      available: true,
      indexedFiles,
      relevantFiles,
      activeFile: editorState.activeTabPath || null
    };
  }

  async getCodebaseOverview(workspaceFolder) {
    if (!workspaceFolder) {
      return "No workspace is open, so I can't scan the codebase yet.";
    }

    await this.ensureCodebaseScanned(workspaceFolder, true);
    return this._buildCodebaseOverview(workspaceFolder);
  }

  async _getAllFiles(dir, fileList = []) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await this._getAllFiles(filePath, fileList);
        }
        continue;
      }

      if (CODE_EXTENSIONS.test(entry.name)) {
        fileList.push(filePath);
      }
    }

    return fileList;
  }

  _buildCodebaseOverview(workspaceFolder) {
    const normalizedPaths = Array.from(this.codebaseContext.keys())
      .map((relativePath) => relativePath.replace(/\\/g, "/"))
      .sort();

    if (normalizedPaths.length === 0) {
      return "Scan completed, but no supported code files were indexed.";
    }

    const extensionCounts = new Map();
    const topLevelCounts = new Map();
    const topLevelSamples = new Map();
    const tree = new Map();

    for (const relativePath of normalizedPaths) {
      const ext = path.extname(relativePath).toLowerCase() || "[no extension]";
      extensionCounts.set(ext, (extensionCounts.get(ext) || 0) + 1);

      const parts = relativePath.split("/");
      const topLevel = parts.length > 1 ? parts[0] : "[root]";
      topLevelCounts.set(topLevel, (topLevelCounts.get(topLevel) || 0) + 1);

      if (!topLevelSamples.has(topLevel)) {
        topLevelSamples.set(topLevel, []);
      }
      if (topLevelSamples.get(topLevel).length < 3) {
        topLevelSamples.get(topLevel).push(relativePath);
      }

      let node = tree;
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (!node.has(part)) {
          node.set(part, new Map());
        }
        node = node.get(part);
      }
    }

    const totalLines = Array.from(this.codebaseContext.values()).reduce(
      (sum, fileData) => sum + fileData.content.split(/\r?\n/).length,
      0
    );

    const formatRankedCounts = (sourceMap, limit, suffix = "") =>
      Array.from(sourceMap.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([name, count]) => `- ${name}: ${count}${suffix}`)
        .join("\n");

    const renderTree = (node, prefix = "", depth = 0, lines = []) => {
      if (depth >= 3 || lines.length >= 30) {
        return lines;
      }

      const entries = Array.from(node.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(0, depth === 0 ? 8 : 6);

      for (const [name, child] of entries) {
        const isLeaf = child.size === 0;
        lines.push(`${prefix}${isLeaf ? "- " : "+ "}${name}`);
        if (!isLeaf) {
          renderTree(child, `${prefix}  `, depth + 1, lines);
        }
        if (lines.length >= 30) {
          break;
        }
      }

      return lines;
    };

    const topLevelSection = Array.from(topLevelCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([name, count]) => {
        const samples = topLevelSamples.get(name) || [];
        const sampleText =
          samples.length > 0 ? ` Examples: ${samples.join(", ")}` : "";
        return `- ${name}: ${count} files.${sampleText}`;
      })
      .join("\n");

    const treeLines = renderTree(tree).join("\n");

    return [
      `Workspace: ${path.basename(workspaceFolder)}`,
      `Indexed files: ${normalizedPaths.length}`,
      `Estimated total lines: ${totalLines}`,
      "",
      "Top-level structure:",
      topLevelSection || "- [root]: 0 files.",
      "",
      "Primary file types:",
      formatRankedCounts(extensionCounts, 8, " files") || "- none",
      "",
      "Tree preview:",
      treeLines || "- no files"
    ].join("\n");
  }

  _getActiveRelativePath(workspaceFolder) {
    const activeEditor =
      vscode.window.activeTextEditor || this._lastActiveEditor;
    if (!activeEditor || !workspaceFolder) {
      return "";
    }

    const relativePath = path.relative(
      workspaceFolder,
      activeEditor.document.fileName
    );
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      return "";
    }

    return relativePath.replace(/\\/g, "/").toLowerCase();
  }

  _getCachedKnowledgeGraphData(workspaceFolder) {
    if (!workspaceFolder) return null;
    return this._knowledgeGraphCache.get(workspaceFolder)?.data?.graphData || null;
  }

  async _getKnowledgeGraphAssets(workspaceFolder) {
    if (!workspaceFolder) return null;

    const reportPath = path.join(
      workspaceFolder,
      "graphify-out",
      "GRAPH_REPORT.md"
    );
    const graphJsonPath = path.join(
      workspaceFolder,
      "graphify-out",
      "graph.json"
    );
    const reportExists = fsSync.existsSync(reportPath);
    const graphExists = fsSync.existsSync(graphJsonPath);

    if (!reportExists && !graphExists) {
      this._knowledgeGraphCache.delete(workspaceFolder);
      return null;
    }

    const reportMtime = reportExists ? fsSync.statSync(reportPath).mtimeMs : 0;
    const graphMtime = graphExists ? fsSync.statSync(graphJsonPath).mtimeMs : 0;
    const cached = this._knowledgeGraphCache.get(workspaceFolder);

    if (
      cached &&
      cached.reportMtime === reportMtime &&
      cached.graphMtime === graphMtime
    ) {
      return cached.data;
    }

    const data = {
      reportPath: reportExists ? reportPath : null,
      graphJsonPath: graphExists ? graphJsonPath : null,
      reportText: "",
      graphData: null
    };

    if (reportExists) {
      data.reportText = await fs.readFile(reportPath, "utf8");
    }

    if (graphExists) {
      try {
        const parsedGraph = JSON.parse(await fs.readFile(graphJsonPath, "utf8"));
        if (isValidGraphData(parsedGraph)) {
          data.graphData = parsedGraph;
        }
      } catch {
        data.graphData = null;
      }
    }

    this._knowledgeGraphCache.set(workspaceFolder, {
      reportMtime,
      graphMtime,
      data
    });

    return data;
  }

  async chat(
    userMessage,
    workspaceFolder,
    streamCallback,
    abortSignal,
    options = {}
  ) {
    const mode =
      options.mode === "deep"
        ? "deep"
        : options.mode === "heavy"
          ? "heavy"
          : "fast";
    const reportStatus =
      typeof options.onStatus === "function" ? options.onStatus : null;

    const runtimeConfig =
      options.runtimeConfig && typeof options.runtimeConfig === "object"
        ? {
            ...this.getConfig(),
            ...options.runtimeConfig
          }
        : this.getConfig();

    const config = await this._prepareRuntimeConfig(
      runtimeConfig,
      reportStatus
    );
    if (!config.enabled) {
      return { error: "AI is disabled in Code Janitor settings." };
    }

    this._appendConversationEntry("user", userMessage);
    const isTabQuestion = this._isTabQuestion(userMessage);

    // Detect intent early for knowledge graph decision
    const earlyIntent = this._detectIntent(userMessage);
    const latencyProfile = this._getLatencyProfile(config, mode, earlyIntent);

    // Check for knowledge graph only for code-related intents
    const knowledgeGraphContext = await this._loadKnowledgeGraph(workspaceFolder, userMessage, earlyIntent);

    // Resolve effective workspace — use active file's directory if no workspace or file is outside
    const activeEditor =
      vscode.window.activeTextEditor || this._lastActiveEditor;
    let effectiveWorkspace = workspaceFolder;
    if (activeEditor && activeEditor.document.uri.scheme === "file") {
      const activeDir = path.dirname(activeEditor.document.fileName);
      if (!workspaceFolder) {
        effectiveWorkspace = activeDir;
      } else {
        const rel = path.relative(
          workspaceFolder,
          activeEditor.document.fileName
        );
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          // Active file is outside workspace — use its directory as context root
          effectiveWorkspace = activeDir;
        }
      }
    }

    // Only intercept factual questions the model cannot answer
    const lowerMsg = userMessage.trim().toLowerCase();
    
    // Inject active file path so the model never needs to ask for it
    let resolvedMessage = userMessage;
    if (isUrlOnlyMessage(userMessage)) {
      resolvedMessage = `Analyze and summarize this link for me:\n${userMessage}`;
    }
    
    // For news/current affairs questions, inject a hint to use FETCH
    if (
      /\b(news|current (affairs|events)|happening|going on|latest|war|conflict|politics|election)\b/i.test(
        lowerMsg
      ) &&
      !/\b(code|file|project|workspace|repo)\b/i.test(lowerMsg)
    ) {
      // Add hint to output FETCH and continue with analysis
      resolvedMessage = `${userMessage}\n\n[SYSTEM: Output FETCH: https://www.reuters.com on first line, then continue with your analysis. Format: "FETCH: https://www.reuters.com\n\nBased on recent developments..."]`;
    }

    const fetchedWebContext = await this._buildFetchedWebContext(
      userMessage,
      reportStatus
    );
    if (fetchedWebContext) {
      resolvedMessage = `${resolvedMessage}\n\n${fetchedWebContext}`;
    }
    
    if (
      /\b(what('?s| is)\s+(today'?s?|the|current)\s+date|what date is it|today'?s date)\b/i.test(
        lowerMsg
      )
    ) {
      const reply = `Today is ${new Date().toDateString()}.`;
      if (streamCallback) streamCallback(reply);
      this._appendConversationEntry("assistant", reply);
      return { text: reply, actions: [] };
    }
    if (
      /\b(what (time|day) is it|current time|what'?s the time)\b/i.test(
        lowerMsg
      )
    ) {
      const reply = `Current date and time: ${new Date().toString()}.`;
      if (streamCallback) streamCallback(reply);
      this._appendConversationEntry("assistant", reply);
      return { text: reply, actions: [] };
    }

    if (activeEditor && effectiveWorkspace) {
      const rel = path
        .relative(effectiveWorkspace, activeEditor.document.fileName)
        .replace(/\\/g, "/");
      
      // Replace "current file", "active file", "this file" with actual path
      if (/\b(active|current|this)\s*(file|tab)?\b/i.test(userMessage) && !/[/\\]/.test(userMessage)) {
        resolvedMessage = userMessage.replace(
          /\b(active|current|this)\s*(file|tab)?\b/gi,
          `"${rel}"`
        );
      }
    }

    let prompt;
    if (mode === "fast") {
      reportStatus?.("Preparing fast reply...");
      const intent = earlyIntent;
      const activeFileContext = this._getActiveFileContext(
        effectiveWorkspace,
        intent === "edit" || intent === "debug" || intent === "refactor"
          ? MAX_FAST_EDIT_ACTIVE_FILE_CHARS
          : 1_200
      );
      const editorState = this._getEditorState(effectiveWorkspace);
      let fastContext = "";
      if (
        effectiveWorkspace &&
        this._shouldUseRepoContextInFastMode(userMessage, config.provider)
      ) {
        reportStatus?.("Scanning relevant files for fast mode...");
        await this.ensureCodebaseScanned(effectiveWorkspace);
        const relevantFiles = this._findRelevantFiles(
          userMessage,
          effectiveWorkspace,
          {
            maxResults: latencyProfile.relevantFileCount,
            snippetChars: latencyProfile.fileSnippetChars
          }
        );
        fastContext = this._buildRelevantFileContext(
          relevantFiles,
          latencyProfile.fileSnippetChars,
          latencyProfile.contextChars
        );
      }
      const history = this._buildPromptHistoryContext(false);
      const editableTargets = this._resolveEditableTargets(
        userMessage,
        effectiveWorkspace,
        editorState
      );
      this.currentEditableTargets =
        intent !== "create" && editableTargets.paths.length
          ? new Set(editableTargets.paths)
          : null;
      const systemInstruction = this._buildSystemInstruction(
        intent,
        effectiveWorkspace,
        mode,
        this.showThinking
      );
      const isCreateIntent = intent === "create";
      const isEditIntent =
        intent === "edit" || intent === "debug" || intent === "refactor";
      const contextToUse = isCreateIntent ? "" : fastContext;
      const activeCtx = isCreateIntent ? "" : activeFileContext;
      const editHint =
        isEditIntent && activeFileContext
          ? "\nPrefer PATCH for targeted edits. Copy SEARCH exactly from the provided file context, make it the smallest unique anchor that matches only once, and prefer source files over generated copies. Use FILE only when the change spans broad sections or PATCH would be brittle."
          : "";
      const fastKnowledgeGraph = knowledgeGraphContext;
      prompt = `${systemInstruction}${editHint}${fastKnowledgeGraph ? `\n\n${fastKnowledgeGraph}` : ""}${activeCtx ? `\n\n${activeCtx}` : ""}${contextToUse ? `\n\n${contextToUse}` : ""}${history ? `\n\n${history}` : ""}

### USER_MESSAGE ###
${resolvedMessage}`;
    } else {
      const editorState = this._getEditorState(effectiveWorkspace);
      const editableTargets = this._resolveEditableTargets(
        userMessage,
        effectiveWorkspace,
        editorState
      );
      const isScopedActiveFileEdit =
        this._isActiveFileScanRequest(userMessage) &&
        this._isEditRequest(userMessage) &&
        editableTargets.paths.length > 0;

      const intent = this._detectIntent(userMessage);

      reportStatus?.(
        isScopedActiveFileEdit
          ? "Scanning active files..."
          : "Scanning workspace..."
      );
      if (effectiveWorkspace)
        await this.ensureCodebaseScanned(effectiveWorkspace);

      // For full codebase scan requests, inject the overview + snippets directly
      const isFullScan = this._isRepoWideScanRequest(userMessage);
      const relevantFiles = isFullScan
        ? Array.from(this.codebaseContext.entries())
            .slice(0, latencyProfile.relevantFileCount)
            .map(([p, d]) => ({
              path: p.replace(/\\/g, "/"),
              score: 1,
              content: d.content.slice(0, latencyProfile.fileSnippetChars)
            }))
        : this._findRelevantFiles(userMessage, effectiveWorkspace, {
            maxResults: latencyProfile.relevantFileCount,
            snippetChars: latencyProfile.fileSnippetChars
          });
      const activeFileContext = this._getActiveFileContext(effectiveWorkspace);
      const editorStateContext = this._buildEditorStateContext(editorState);
      const openTabSnippetContext = isScopedActiveFileEdit
        ? this._getTargetSnippetContext(
            editableTargets.paths,
            effectiveWorkspace,
            MAX_RELEVANT_FILES,
            MAX_EDIT_TARGET_SNIPPET
          )
        : this._getOpenTabSnippetContext(
            editorState.allOpenTabs,
            effectiveWorkspace
          );
      this.currentEditableTargets =
        intent !== "create" && intent !== "edit" && editableTargets.paths.length
          ? new Set(editableTargets.paths)
          : null;
      prompt = this._buildPrompt(
        resolvedMessage,
        relevantFiles,
        activeFileContext,
        editorStateContext,
        openTabSnippetContext,
        isTabQuestion,
        editableTargets,
        mode,
        knowledgeGraphContext
      );
    }

    try {
      reportStatus?.(`Contacting ${config.provider}...`);
      const reqIntent = earlyIntent;
      const shouldCheckRepetition = !this._shouldForceStructuredEdit(
        reqIntent,
        userMessage
      );
      const reqOpts = this._buildRequestOptions(config, prompt, mode, reqIntent);
      const extendedTimeout =
        reqIntent === "create" ||
        reqIntent === "edit" ||
        reqIntent === "debug" ||
        reqIntent === "refactor"
          ? Math.max(config.timeout || 0, 360_000)
          : config.timeout;
      const response = await fetch(reqOpts.url, {
        method: "POST",
        headers: reqOpts.headers,
        signal: this._createRequestSignal(abortSignal, extendedTimeout),
        body: reqOpts.body
      });

      if (!response.ok) {
        const errorDetails = await this._buildHttpError(response, "AI request failed with status");
        
        // Special handling for NVIDIA token limit errors
        if (config.provider === "nvidia" && response.status === 400) {
          if (/max.*token|token.*limit|context.*length|too.*long/i.test(errorDetails)) {
            throw new Error(
              "NVIDIA NIM: Response was truncated due to token limit.\n\n" +
              "The model hit its maximum token limit while generating code. This means the file was too large to generate completely.\n\n" +
              "Solutions:\n" +
              "1. Break the request into smaller parts\n" +
              "2. Use Heavy mode (/heavy) for larger token limits\n" +
              "3. Try a different model like meta/llama-3.1-70b-instruct\n" +
              "4. Simplify the request to generate less code\n\n" +
              `Original error: ${errorDetails}`
            );
          }
        }
        
        throw new Error(errorDetails);
      }

      let fullResponse = "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamDone = false;
      let repetitionDetected = false;

      while (!streamDone) {
        if (abortSignal?.aborted) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          streamDone = true;
          continue;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const token = reqOpts.parseChunk(line);
            if (token === null) continue;
            const nextResponse = fullResponse + token;
            if (
              shouldCheckRepetition &&
              this._isRepeatingResponse(nextResponse, mode)
            ) {
              repetitionDetected = true;
              streamDone = true;
              if (!abortSignal?.aborted) {
                try {
                  reader.cancel();
                } catch (_) {}
              }
              break;
            }
            fullResponse += token;
            if (streamCallback) streamCallback(token);
          } catch (parseError) {
            // ignore partial chunks
          }
        }
      }

      const finalText = repetitionDetected
        ? `${fullResponse}\n\nStopped because the response started repeating.`
        : fullResponse || this._getEmptyResponseFallback(mode);
      
      // Remove <think> tags and their content (some models output reasoning)
      const cleanedText = finalText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      
      let parsedResponse = this._parseResponse(cleanedText);
      const finalIntent = this._detectIntent(userMessage);
      const requiresFileActions = this._shouldForceStructuredEdit(
        finalIntent,
        userMessage
      );
      let assistantText = finalText;
      let firstRetryText = "";
      const shouldAllowClarification = this._isClarificationResponse(
        assistantText,
        finalIntent,
        userMessage
      );

      if (
        requiresFileActions &&
        !shouldAllowClarification &&
        !this._hasRequiredActions(
          finalIntent,
          userMessage,
          parsedResponse.actions
        ) &&
        !abortSignal?.aborted
      ) {
        reportStatus?.(
          "Model replied with prose. Retrying with strict edit format..."
        );
        const retryPrompt = `${prompt}\n\n${this._buildStructuredRetryPrompt(finalText)}`;
        const retryOpts = this._buildRequestOptions(
          config,
          retryPrompt,
          mode,
          "edit"
        );
        const retryResponse = await fetch(retryOpts.url, {
          method: "POST",
          headers: retryOpts.headers,
          signal: this._createRequestSignal(abortSignal, config.timeout),
          body: retryOpts.body
        });

        if (!retryResponse.ok) {
          throw new Error(
            await this._buildHttpError(
              retryResponse,
              "AI retry failed with status"
            )
          );
        }

        let retryText = "";
        const retryReader = retryResponse.body.getReader();
        const retryDecoder = new TextDecoder();
        let retryDone = false;

        while (!retryDone) {
          if (abortSignal?.aborted) {
            break;
          }

          const { done, value } = await retryReader.read();
          if (done) {
            retryDone = true;
            continue;
          }

          const chunk = retryDecoder.decode(value);
          const lines = chunk.split("\n").filter((line) => line.trim());

          for (const line of lines) {
            try {
              const token = retryOpts.parseChunk(line);
              if (token === null) continue;
              retryText += token;
            } catch (_) {
              // ignore partial chunks
            }
          }
        }

        firstRetryText = retryText || finalText;
        parsedResponse = this._parseResponse(firstRetryText);
        assistantText = firstRetryText;
      }

      const shouldAllowClarificationAfterRetry = this._isClarificationResponse(
        assistantText,
        finalIntent,
        userMessage
      );

      if (
        requiresFileActions &&
        !shouldAllowClarificationAfterRetry &&
        !this._hasEditActions(parsedResponse.actions) &&
        !abortSignal?.aborted
      ) {
        reportStatus?.("Retrying with FILE-only format for safe edits...");
        const fileOnlyRetryPrompt = `${prompt}\n\n${this._buildFileOnlyRetryPrompt(
          assistantText
        )}`;
        const fileOnlyRetryOpts = this._buildRequestOptions(
          config,
          fileOnlyRetryPrompt,
          mode,
          "edit"
        );
        const fileOnlyRetryResponse = await fetch(fileOnlyRetryOpts.url, {
          method: "POST",
          headers: fileOnlyRetryOpts.headers,
          signal: this._createRequestSignal(abortSignal, config.timeout),
          body: fileOnlyRetryOpts.body
        });

        if (!fileOnlyRetryResponse.ok) {
          throw new Error(
            await this._buildHttpError(
              fileOnlyRetryResponse,
              "AI file-only retry failed with status"
            )
          );
        }

        let fileOnlyRetryText = "";
        const fileOnlyReader = fileOnlyRetryResponse.body.getReader();
        const fileOnlyDecoder = new TextDecoder();
        let fileOnlyDone = false;

        while (!fileOnlyDone) {
          if (abortSignal?.aborted) {
            break;
          }

          const { done, value } = await fileOnlyReader.read();
          if (done) {
            fileOnlyDone = true;
            continue;
          }

          const chunk = fileOnlyDecoder.decode(value);
          const lines = chunk.split("\n").filter((line) => line.trim());

          for (const line of lines) {
            try {
              const token = fileOnlyRetryOpts.parseChunk(line);
              if (token === null) continue;
              fileOnlyRetryText += token;
            } catch (_) {
              // ignore partial chunks
            }
          }
        }

        assistantText = fileOnlyRetryText || assistantText;
        parsedResponse = this._parseResponse(assistantText);
      }

      if (
        requiresFileActions &&
        !this._isClarificationResponse(assistantText, finalIntent, userMessage) &&
        !this._hasEditActions(parsedResponse.actions)
      ) {
        const noEditsMessage =
          "No executable file edits were generated for this edit request. Please retry with the exact target file path and desired change.";
        this._appendConversationEntry("assistant", assistantText || noEditsMessage);
        return {
          text: noEditsMessage,
          actions: [],
          warnings: [noEditsMessage]
        };
      }

      this._appendConversationEntry(
        "assistant",
        assistantText ||
          (repetitionDetected
            ? `${fullResponse}\n\n[stopped repetitive output]`
            : fullResponse || this._getEmptyResponseFallback(mode))
      );

      return parsedResponse;
    } catch (error) {
      if (error.name === "AbortError") {
        return { text: "Generation stopped", actions: [] };
      }

      return { error: `AI error: ${error.message}` };
    } finally {
      this.currentEditableTargets = null;
    }
  }

  async _loadKnowledgeGraph(workspaceFolder, userMessage, intent) {
    if (!workspaceFolder) return "";

    // Only load graph for code-related intents where location matters
    const shouldLoadGraph =
      intent === "scan" ||
      intent === "debug" ||
      intent === "refactor" ||
      intent === "edit" ||
      intent === "show_graph" ||
      this._extractPathHints(userMessage).length > 0 ||
      /\b(where is|where's|locate|find|location|which file|what file|architecture|structure|dependency|dependencies|module|modules|codebase|project overview|workspace overview|how does .* fit)\b/i.test(
        userMessage
      );
    
    if (!shouldLoadGraph) return "";

    try {
      const graphAssets = await this._getKnowledgeGraphAssets(workspaceFolder);
      if (!graphAssets) {
        return "";
      }

      const graphReport = graphAssets.reportText || "";
      
      const overviewMatch = graphReport
        ? graphReport.match(/## Overview[\s\S]*?(?=##|$)/)
        : null;
      const godNodesMatch = graphReport
        ? graphReport.match(/## God Nodes[\s\S]*?(?=##|$)/)
        : null;
      const directoryMatch = graphReport
        ? graphReport.match(
            /## Directory Structure[\s\S]*?(?=## Architecture Insights|## Usage|$)/
          )
        : null;
      const insightsMatch = graphReport
        ? graphReport.match(/## Architecture Insights[\s\S]*?(?=## Usage|$)/)
        : null;

      const sections = [];

      if (overviewMatch) {
        sections.push(overviewMatch[0].trim());
      }

      if (godNodesMatch) {
        const firstThreeNodes = godNodesMatch[0].split("###").slice(0, 4).join("###").trim();
        sections.push(firstThreeNodes);
      }

      if (directoryMatch) {
        const topDirectories = directoryMatch[0].split("###").slice(0, 7).join("###").trim();
        sections.push(topDirectories);
      }

      if (insightsMatch) {
        sections.push(insightsMatch[0].trim());
      }

      const graphMatches = graphAssets.graphData
        ? this._preferActivePathMatches(
            matchGraphPathsFromHints(
              graphAssets.graphData,
              this._extractPathHints(userMessage)
            ),
            this._getActiveRelativePath(workspaceFolder)
          )
        : [];
      const graphLookupContext = graphAssets.graphData
        ? buildGraphLookupContext(graphAssets.graphData, graphMatches)
        : "";

      if (sections.length > 0 || graphLookupContext) {
        const graphAvailability = graphAssets.graphData
          ? "A Graphify knowledge graph is available in `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json`."
          : "A Graphify summary report is available in `graphify-out/GRAPH_REPORT.md`, but `graphify-out/graph.json` is not available right now.";
        const graphContextBody = [
          sections.join("\n\n").slice(0, 1800),
          graphLookupContext
        ]
          .filter(Boolean)
          .join("\n\n");
        return `\n**Knowledge Graph Context**\n${graphAvailability} Use it first for architecture, codebase navigation, file lookup, multi-file debugging, and refactors.\n${graphContextBody}\n`;
      }

      return "";
    } catch (err) {
      return "";
    }
  }

  _getActiveFileContext(workspaceFolder, maxChars = 4_000) {
    const activeEditor =
      vscode.window.activeTextEditor || this._lastActiveEditor;
    if (!activeEditor) return "";

    const doc = activeEditor.document;

    // Skip untitled and non-file documents
    if (doc.isUntitled) return "";
    if (doc.uri.scheme !== "file") return "";

    // If workspace exists, skip files outside it
    if (workspaceFolder) {
      const relative = path.relative(workspaceFolder, doc.fileName);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        // Still include it but with full path label
        return this._buildDocumentContext("Active file", doc, null, 4_000);
      }
    }

    return this._buildDocumentContext(
      "Active file",
      doc,
      workspaceFolder,
      maxChars
    );
  }

  _toWorkspaceRelativePath(filePath, workspaceFolder) {
    if (!filePath) {
      return null;
    }

    const normalizedPath = workspaceFolder
      ? path.relative(workspaceFolder, filePath)
      : filePath;

    return normalizedPath.replace(/\\/g, "/");
  }

  _formatContextPath(filePath, workspaceFolder) {
    if (!filePath) {
      return "untitled";
    }

    if (!workspaceFolder) {
      return filePath.replace(/\\/g, "/");
    }

    const relativePath = path.relative(workspaceFolder, filePath);
    const escapesWorkspace =
      relativePath.startsWith("..") || path.isAbsolute(relativePath);

    return escapesWorkspace
      ? filePath.replace(/\\/g, "/")
      : relativePath.replace(/\\/g, "/");
  }

  _buildDocumentContext(label, document, workspaceFolder, maxChars = 1_200) {
    if (!document) {
      return "";
    }

    const filePath = document.isUntitled ? null : document.fileName;
    const displayPath = this._formatContextPath(filePath, workspaceFolder);
    const content = document.getText().slice(0, maxChars);

    return `${label}: ${displayPath}${document.isDirty ? " (unsaved changes)" : ""}\n\`\`\`\n${content}\n\`\`\``;
  }

  _formatFileList(label, filePaths) {
    if (filePaths.length === 0) {
      return `${label}: unavailable`;
    }

    return `${label}:\n${filePaths.map((filePath) => `File: ${filePath}`).join("\n")}`;
  }

  _getEditorState(workspaceFolder) {
    const allOpenTabs = new Set();
    const visibleTabs = new Set();
    const activeEditor =
      vscode.window.activeTextEditor || this._lastActiveEditor;
    const activeTabPath = this._toWorkspaceRelativePath(
      activeEditor?.document?.fileName,
      workspaceFolder
    );

    if (vscode.window.tabGroups?.all) {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input;
          const filePath = input?.uri?.fsPath || input?.modified?.fsPath || null;
          if (!filePath) continue;
          // Skip VS Code internal paths
          if (
            filePath.includes("extension-output") ||
            filePath.includes("AppData\\Local\\Programs") ||
            filePath.includes("AppData/Local/Programs") ||
            !fsSync.existsSync(filePath)
          )
            continue;
          const relativePath = this._toWorkspaceRelativePath(
            filePath,
            workspaceFolder
          );
          if (relativePath) allOpenTabs.add(relativePath);
        }
      }
    }

    if (Array.isArray(vscode.window.visibleTextEditors)) {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.scheme !== "file") continue;
        const filePath = editor.document.fileName;
        if (
          filePath.includes("extension-output") ||
          filePath.includes("AppData\\Local\\Programs") ||
          filePath.includes("AppData/Local/Programs")
        )
          continue;
        const relativePath = this._toWorkspaceRelativePath(
          filePath,
          workspaceFolder
        );
        if (relativePath) {
          visibleTabs.add(relativePath);
          allOpenTabs.add(relativePath);
        }
      }
    }

    if (!activeTabPath && allOpenTabs.size === 0 && visibleTabs.size === 0) {
      return {
        available: false,
        activeTabPath: null,
        visibleTabs: [],
        allOpenTabs: []
      };
    }

    return {
      available: true,
      activeTabPath,
      visibleTabs: Array.from(visibleTabs).sort(),
      allOpenTabs: Array.from(allOpenTabs).sort()
    };
  }

  _buildEditorStateContext(editorState) {
    if (!editorState.available) {
      return "";
    }

    const sections = [
      editorState.activeTabPath
        ? `Active tab:\nFile: ${editorState.activeTabPath}`
        : "Active tab: unavailable",
      this._formatFileList("Visible tabs", editorState.visibleTabs),
      this._formatFileList("All open tabs", editorState.allOpenTabs)
    ];

    return `${sections.join("\n\n")}\n`;
  }

  _getOpenTabSnippetContext(openTabPaths, workspaceFolder) {
    const snippetBlocks = [];
    const openDocuments = new Map(
      vscode.workspace.textDocuments.map((document) => [
        document.fileName,
        document
      ])
    );

    for (const tabPath of openTabPaths) {
      let snippet = "";
      const fullPath = workspaceFolder
        ? path.join(workspaceFolder, tabPath)
        : tabPath;
      const openDocument = openDocuments.get(fullPath);

      if (openDocument) {
        snippet = this._buildDocumentContext(
          "Open tab content",
          openDocument,
          workspaceFolder,
          MAX_FILE_SNIPPET
        );
      } else {
        const fileData = this.codebaseContext.get(tabPath);
        if (!fileData) {
          continue;
        }

        snippet = `Open tab content: ${tabPath}\n\`\`\`\n${fileData.content.slice(
          0,
          MAX_FILE_SNIPPET
        )}\n\`\`\``;
      }

      snippetBlocks.push(`${snippet}\n\n`);

      if (snippetBlocks.length >= MAX_OPEN_TAB_SNIPPETS) {
        break;
      }
    }

    return snippetBlocks.join("");
  }

  _getTargetSnippetContext(
    targetPaths,
    workspaceFolder,
    maxSnippets = MAX_RELEVANT_FILES,
    maxChars = MAX_FILE_SNIPPET
  ) {
    if (!Array.isArray(targetPaths) || targetPaths.length === 0) {
      return "";
    }

    const snippetBlocks = [];
    const openDocuments = new Map(
      vscode.workspace.textDocuments.map((document) => [
        document.fileName,
        document
      ])
    );

    for (const targetPath of targetPaths) {
      let snippet = "";
      const fullPath = workspaceFolder
        ? path.join(workspaceFolder, targetPath)
        : targetPath;
      const openDocument = openDocuments.get(fullPath);

      if (openDocument) {
        snippet = this._buildDocumentContext(
          "Editable target content",
          openDocument,
          workspaceFolder,
          maxChars
        );
      } else {
        const fileData = this.codebaseContext.get(targetPath);
        if (!fileData) {
          continue;
        }

        snippet = `Editable target content: ${targetPath}\n\`\`\`\n${fileData.content.slice(
          0,
          maxChars
        )}\n\`\`\``;
      }

      snippetBlocks.push(`${snippet}\n\n`);

      if (snippetBlocks.length >= maxSnippets) {
        break;
      }
    }

    return snippetBlocks.join("");
  }

  _extractKeywords(query) {
    return query
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .filter((word) => word && word.length > 1 && !STOP_WORDS.has(word));
  }

  _isTabQuestion(message) {
    return /\b(tab|tabs|active tab|open tab|visible tab)\b/i.test(message || "");
  }

  _mentionsEditorFiles(message) {
    return /\b(active|current|visible|open)?\s*(file|files|fies|tab|tabs|editor|editors)\b/i.test(
      message || ""
    );
  }

  _isActiveFileScanRequest(message) {
    return (
      /\b(scan|inspect|analyze|review|check|read|summari[sz]e)\b/i.test(
        message || ""
      ) && this._mentionsEditorFiles(message)
    );
  }

  _isEditRequest(message) {
    if (this._isGreetingOnly(message)) return false;
    return (
      /\b(edit|update|upadet|modify|change|fix|refactor|rewrite|rename|patch|improve|clean up|format|apply)\b/i.test(
        message || ""
      ) ||
      /\b(do|make)\s+(this|these|it)\s+for\s+me\b/i.test(message || "") ||
      /\b(can you|could you|please)\s+(fix|change|update|edit|do|apply)\s+(this|these|it)\b/i.test(
        message || ""
      ) ||
      /\b(please\s+)?do\s+it\b/i.test(message || "") ||
      /\binstall\s+it\b/i.test(message || "") ||
      /\b(set|wire)\s+it\s+up\b/i.test(message || "") ||
      /\b(host|deploy)\s+it\b/i.test(message || "")
    );
  }

  _detectIntent(message) {
    const m = message.toLowerCase();
    if (this._isGreetingOnly(m)) return "greeting";
    const hasExplicitCommandRequest =
      /\b(run|execute|exec|launch|start|invoke)\b/.test(m) &&
      (
        /`[^`]+`/.test(message || "") ||
        /\b(npm|pnpm|yarn|node|python|pip|git|cargo|go|java|javac|mvn|gradle|docker|kubectl|pytest|jest|vitest|eslint|prettier|powershell|bash|cmd)\b/.test(m)
      );
    const hasExplicitEditVerb =
      /\b(add|edit|update|upadet|modify|change|rename|patch|insert|remove|delete|make|set|turn|enable|disable|implement|include|put|give|write|fix)\b/.test(
        m
      );
    const hasApplyChangePhrase =
      /\b(apply|implement|make|do)\s+(this|these|it)\b/.test(m) ||
      /\b(do|make)\s+(this|these|it)\s+for\s+me\b/.test(m) ||
      /\b(can you|could you|please)\s+(fix|change|update|edit|do|apply)\s+(this|these|it)\b/.test(
        m
      ) ||
      /\b(use|follow)\s+(this|these)\b/.test(m) ||
      /\b(please\s+)?do\s+it\b/.test(m) ||
      /\binstall\s+it\b/.test(m) ||
      /\b(set|wire)\s+it\s+up\b/.test(m) ||
      /\b(host|deploy)\s+it\b/.test(m);
    const hasImplementationContext =
      /\b(vercel|webpack|deploy|host|install|setup|bundle|build)\b/.test(m) ||
      this._mentionsEditorFiles(m) ||
      /\b(code|project|app|site|html|css|js|file|files)\b/.test(m);
    const hasReviewIntent =
      /\b(review|code review|pr review|audit|inspect for bugs|look for bugs|find issues|find bugs|find regressions|find risks|find problems)\b/.test(
        m
      ) &&
      (
        this._mentionsEditorFiles(m) ||
        /\b(code|diff|patch|changes|project|repo|repository|workspace|implementation)\b/.test(m)
      );
    const hasScanIntent =
      /\b(scan|review|analyze|audit|check|inspect|summari[sz]e|overview|read|walk through|walkthrough|map out)\b/.test(
        m
      ) &&
      /\b(codebase|repo|repository|project|workspace|file|files|folder|folders|module|modules)\b/.test(
        m
      );
    const hasDebugSignals =
      /\b(fix|debug|error|issue|bug|broken|not working|failing|wrong|problem|crash|exception|traceback|stack trace|syntax error)\b/.test(
        m
      );
    const hasRefactorSignals =
      /\b(refactor|improve|optimize|clean up|rewrite|restructure|simplify|tidy up|modernize|harden)\b/.test(
        m
      );
    if (
      /\b(hi|hello|hey|thanks|thank you|thx|good morning|good evening|how are you|what's up|sup)\b/.test(
        m
      ) &&
      m.split(" ").length < 8
    )
      return "greeting";
    if (
      /\b(show|display|open|visualize|view)\b/.test(m) &&
      /\b(graph|graphify|visualization|dependency|dependencies|architecture|structure)\b/.test(m) &&
      /\b(repo|repository|codebase|project)\b/.test(m)
    )
      return "show_graph";
    if (hasExplicitCommandRequest) return "command";
    if (hasReviewIntent) return "review";
    if (
      /\b(make|create|build|develop|generate|scaffold|bootstrap|spin up|write me|code me|start a new|set up a new)\b/.test(
        m
      ) &&
      /\b(app|website|site|portfolio|game|api|server|script|program|html|css|component|page|project|tool|extension|plugin|bot|dashboard|landing)\b/.test(
        m
      )
    )
      return "create";
    if (
      /\b(explain|what is|what are|how does|how do|tell me about|describe|why is|why does|what's the difference|walk me through)\b/.test(
        m
      )
    )
      return "explain";
    if (hasApplyChangePhrase && hasImplementationContext) return "edit";
    if (hasExplicitEditVerb) return "edit";
    if (hasDebugSignals)
      return "debug";
    if (hasRefactorSignals)
      return "refactor";
    if (hasScanIntent || /\breadme\b/.test(m) && /\b(codebase|repo|project|workspace|file|files)\b/.test(m)) {
      // If also asking to update/write a file, treat as edit
      if (hasExplicitEditVerb || /\b(rewrite|improve)\b/.test(m)) return "edit";
      return "scan";
    }
    return "general";
  }

  _isGreetingOnly(message) {
    const text = (message || "").toLowerCase().trim();
    if (!text) return false;

    const greetingWords = new Set([
      "hi",
      "hello",
      "hey",
      "thanks",
      "thank",
      "you",
      "thx",
      "sup",
      "morning",
      "evening",
      "good",
      "how",
      "are",
      "what's",
      "up"
    ]);

    const tokens = text
      .replace(/[^a-z0-9'\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

    if (tokens.length === 0) return false;
    return tokens.every((token) => greetingWords.has(token));
  }

  _buildSystemInstruction(intent, workspaceFolder, mode = "fast", showThinking = false) {
    const thinkingInstruction = showThinking
      ? "\n\nIMPORTANT: Structure your reply in exactly two top-level sections when possible: a heading titled \"Thinking\" with 3-6 concise bullets summarizing approach, tradeoffs, or checks, followed by a heading titled \"Answer\" for the final response. Keep the Thinking section brief and useful. Do not expose hidden internal chain-of-thought or long private reasoning."
      : "";
    const base =
      "You are Code Janitor, a professional coding agent embedded in VS Code. Act like a careful senior software engineer: calm, precise, execution-focused, and accountable for the outcome.\n\nCode Janitor capabilities:\n- Code formatting and linting for Python, JavaScript, Java, C/C++, Arduino, HTML, CSS, JSON, Markdown, SVG, Vue, Svelte\n- Live preview for HTML, React, Markdown, CSS, JSON, SVG, Vue, Svelte in webview\n- Preview inspection that can capture runtime/render/resource issues from the active previewable file\n- Frontend dependency validation for HTML, CSS, and JavaScript files\n- Mermaid diagrams rendered directly in chat when you answer with fenced ```mermaid code blocks\n- Built-in extension actions you can trigger when helpful: `GRAPHIFY: open`, `LINT: active`, `VALIDATE: frontend`, `PREVIEW: open`, `PREVIEW: inspect`, `PERFORMANCE: show`\n- AI-assisted quick fixes through diagnostics and chat-driven fix flows\n- Auto-correction while typing for supported languages\n- Multiple AI provider support (Ollama, Groq, OpenRouter, Anthropic, NVIDIA)\n- Workspace scanning and knowledge graph integration\n- Graphify project intelligence: interactive codebase graph visualization, dependency exploration, and `graphify-out/GRAPH_REPORT.md` architecture summaries\n- Syntax checking and code quality analysis\n- Internet connectivity: You have FULL internet access via FETCH: action.\n  * When you output FETCH: https://example.com, the system AUTOMATICALLY fetches and displays the content to the user\n  * You do NOT need to tell the user to visit the URL manually\n  * The fetched content appears immediately in the chat\n  * Use FETCH for: current events, news, documentation, API references, package versions, external resources\n  * Format: FETCH: https://www.reuters.com or FETCH: https://www.bbc.com/news\n  * After outputting FETCH:, you can add a brief comment about what you're fetching, but the content will be shown automatically\n- Web search: You can search the web using DuckDuckGo (no API key required)\n- YouTube videos: Users can search for YouTube videos using the dedicated YouTube button in the chat interface (not via AI commands)" +
      thinkingInstruction;
    const compactRules = [
      "Operational rules (fast):",
      "- Be concise and correct.",
      "- Use FILE: only when the user asks to change files.",
      "- Avoid unrelated context or speculation.",
      "- Write production-grade code: robust error handling, proper validation, clean architecture, no placeholders or TODOs.",
      "- You have FULL internet access via FETCH: action. When users ask about current events, news, or time-sensitive topics:",
      "  * Output FETCH: https://www.reuters.com on its own line",
      "  * Then CONTINUE your response with analysis/discussion",
      "  * The fetch happens in the background - you won't see the results immediately",
      "  * Provide your best analysis based on your knowledge while the fetch completes",
      "  * Example: \"FETCH: https://www.reuters.com\\n\\nBased on recent developments, the situation involves...\""
    ].join("\n");
    const operatingPrinciples = [
      "Operational rules:",
      "- Be precise and minimal: use only the actions required to solve the request.",
      "- Prefer FILE: and MKDIR: changes before CMD: when shell commands are not necessary.",
      "- Never claim a command/check was run unless it is actually in your action list.",
      "- If external or time-sensitive facts are required, say verification is needed instead of guessing.",
      "- If a command is likely to fail, propose a corrected safer command immediately.",
      "- Preserve user intent, existing features, and project conventions unless the request requires a change.",
      "- Favor robust, maintainable solutions over shortcuts, placeholders, or tutorial-style output.",
      "- Before changing code, infer the smallest correct scope from the provided context and avoid unrelated edits.",
      "- When editing files, keep the codebase buildable and coherent; do not leave partial migrations or dangling references.",
      "- If information is missing, make the safest reasonable assumption instead of stalling, unless a wrong assumption would be destructive.",
      "- When the user asks for a flowchart, sequence diagram, class diagram, state diagram, ER diagram, gantt chart, or architecture visualization, respond with a valid fenced ```mermaid block first, then add a short explanation after it.",
      "- When using CMD:, keep commands workspace-scoped, deterministic, and directly relevant to the task.",
      "- On Windows, prefer safe read-only PowerShell inspection commands such as `Get-Content`, `Get-ChildItem`, and `Select-String` when CMD: is needed for file inspection.",
      "- When the workspace contains `graphify-out/GRAPH_REPORT.md`, treat it as the first source for architecture, codebase overview, dependency, and file-location questions before wider searching.",
      "- When `graphify-out/graph.json` is present, use it to resolve requested filenames/paths and dependency neighbors before falling back to generic workspace search.",
      "- Use the Graphify report's god nodes and directory communities to choose likely files and reason about cross-file impact.",
      "- If the user wants to visualize architecture, dependencies, or the project graph, use the `GRAPHIFY: open` action instead of only describing it.",
      "- If the user wants lint results for the active JavaScript file, use `LINT: active`.",
      "- If the user wants frontend dependency checks for the active HTML/CSS/JS file, use `VALIDATE: frontend`.",
      "- If the user wants a live preview of the active previewable file, use `PREVIEW: open`.",
      "- If the user wants you to inspect/study/analyze the live preview, detect render/runtime issues, or fix problems found from the preview, use `PREVIEW: inspect`.",
      "- If the user asks for the extension's AI performance report or self-healing/performance diagnostics, use `PERFORMANCE: show`.",
      "- You have FULL internet access via FETCH: action. Use it when:",
      "  * User asks about current events, news, politics, wars, conflicts, or any time-sensitive topics",
      "  * Output FETCH: URL on its own line, then CONTINUE your response",
      "  * Format: FETCH: https://www.reuters.com\\n\\nYour analysis here...",
      "  * The fetch happens in background - provide your analysis while it completes",
      "  * Example: \"FETCH: https://www.reuters.com\\n\\nRegarding the Iran situation, recent reports indicate...\"",
      "  * User explicitly asks for current/latest information from the web",
      "  * You need to check documentation, API references, or package versions",
      "- CRITICAL: All generated code must be production-grade by default:",
      "  * Comprehensive error handling and input validation",
      "  * Security best practices (sanitization, authentication, authorization where applicable)",
      "  * Performance optimization (efficient algorithms, proper resource management)",
      "  * Accessibility compliance (ARIA labels, semantic HTML, keyboard navigation)",
      "  * Responsive design for web interfaces",
      "  * Proper logging and monitoring hooks",
      "  * Clean architecture with separation of concerns",
      "  * Type safety where applicable (TypeScript, type hints)",
      "  * No placeholder comments, TODOs, or tutorial-style code",
      "  * Database connections with proper pooling and error recovery",
      "  * API endpoints with rate limiting and proper status codes",
      "  * Environment-based configuration (dev/staging/prod)",
      "  * Graceful degradation and fallback mechanisms"
    ].join("\n");
    const rules = mode === "fast" ? compactRules : operatingPrinciples;
    switch (intent) {
      case "greeting":
        return `${base}
${rules}
Reply naturally and briefly.`;
      case "show_graph":
        return `${base}
${rules}
The user wants to see the codebase graph visualization.

**CRITICAL INSTRUCTION**: You MUST output EXACTLY this line (copy it character-for-character):
GRAPHIFY: open

Do NOT add any other text before this line. Output it as the very first line of your response.
After that line, you may add a brief message like "Opening the codebase graph visualization panel..."

Example correct response:
GRAPHIFY: open

Opening the codebase graph visualization panel. You'll be able to see the dependency structure and file relationships.`;
      case "create": {
        const loc = workspaceFolder
          ? `Save files in: ${workspaceFolder.replace(/\\/g, "/")}`
          : "No workspace is open. Generate FILE blocks only; files will be opened as drafts for the user to save manually.";
        return `${base}
${rules}
${loc}
Write PRODUCTION-GRADE code by default:
- Enterprise-level error handling with proper try-catch, error boundaries, and graceful failures
- Input validation and sanitization for all user inputs and external data
- Security: XSS prevention, CSRF tokens, SQL injection protection, secure headers
- Performance: lazy loading, code splitting, caching strategies, optimized queries
- Accessibility: WCAG 2.1 AA compliance, ARIA labels, keyboard navigation, screen reader support
- Responsive design: mobile-first approach, breakpoints, touch-friendly interfaces
- SEO optimization: meta tags, semantic HTML, structured data
- Logging and monitoring: structured logs, error tracking integration points
- Configuration management: environment variables, feature flags
- Testing hooks: data-testid attributes, clear component boundaries
- Database: connection pooling, transactions, proper indexing, migration scripts
- API design: RESTful conventions, proper status codes, rate limiting, pagination
- Authentication: secure token handling, session management, password hashing
- Code quality: TypeScript/type hints, linting compliance, consistent formatting
- Documentation: JSDoc/docstrings for complex logic only (code should be self-documenting)
- Never use placeholders like TODO, FIXME, or "implement this later"
- Make opinionated but reasonable engineering choices when the user has not specified low-level details.
- If you touch multiple files, ensure imports, references, and wiring stay consistent.
- Never delete or empty README.md unless the user explicitly asks you to remove it.
You have access to structured shell actions when needed. You may use:
- FILE: to create or replace file contents
- MKDIR: to create directories
- CMD: to run a single workspace shell command only when strictly needed
Respond ONLY with executable FILE:, MKDIR:, or CMD: actions. No explanations or markdown outside code fences.
Format:
FILE: folder/file.ext
\`\`\`
content here
\`\`\`
MKDIR: folder/subfolder
CMD: <single workspace command>

Example response for "create a hello world site as a single previewable file with embedded CSS and JS":
FILE: hello/index.html
\`\`\`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Hello World demonstration page" />
  <title>Hello World</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: grid; 
      place-items: center; 
      min-height: 100vh; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      padding: 1rem;
    }
    h1 { 
      font-size: clamp(2rem, 5vw, 4rem);
      text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
      animation: fadeIn 0.6s ease-in;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      * { animation: none !important; }
    }
  </style>
</head>
<body>
  <main role="main">
    <h1 id="greeting" aria-live="polite">Hello World</h1>
  </main>
  <script>
    (function() {
      'use strict';
      const greeting = document.getElementById('greeting');
      if (!greeting) {
        console.error('Greeting element not found');
        return;
      }
      console.log('Hello from Code Janitor - Page loaded successfully');
      
      // Example: Dynamic greeting based on time
      const hour = new Date().getHours();
      const timeGreeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
      greeting.textContent = \`\${timeGreeting}, World!\`;
    })();
  </script>
</body>
</html>
\`\`\`

Now respond with executable actions only for the user's request:`;
      }
      case "explain":
        return `${base}
${rules}
Give a clear, direct, technically sound explanation with production-level insights:
- Explain architectural decisions and trade-offs
- Highlight security implications and best practices
- Discuss performance considerations and optimization opportunities
- Mention scalability and maintenance concerns
- Reference industry standards and patterns where relevant
Be concise but substantive. Do not output FILE: or CMD: directives unless asked.`;
      case "debug":
        return `${base}
${rules}
Debug like a senior production engineer:
- Identify the most likely root cause, not just the visible symptom
- Call out concrete failure modes, regressions, or risks when relevant
- Consider production implications: data loss, downtime, security vulnerabilities
- Suggest monitoring and logging improvements to prevent recurrence
- Provide fixes that are production-grade: proper error handling, rollback strategies, backward compatibility
- Include defensive programming practices in solutions
Use FILE: directives only if the user asks you to apply the fix.`;
      case "refactor":
        return `${base}
${rules}
Suggest production-grade improvements with senior engineering judgment:
- Prioritize: security vulnerabilities, performance bottlenecks, scalability issues, maintainability
- Recommend design patterns and architectural improvements
- Identify technical debt and propose migration strategies
- Suggest testing strategies and coverage improvements
- Consider backward compatibility and deployment risks
- Distinguish critical fixes from optional cleanup
- Avoid churn that does not materially improve production readiness
Use FILE: directives only if the user asks you to apply changes.`;
      case "review":
        return `${base}
${rules}
Perform a senior-level production code review:
- CRITICAL ISSUES: Security vulnerabilities, data loss risks, authentication/authorization flaws, injection attacks
- HIGH PRIORITY: Performance bottlenecks, memory leaks, race conditions, error handling gaps
- PRODUCTION READINESS: Logging, monitoring, graceful degradation, rollback strategies
- CODE QUALITY: Architecture violations, tight coupling, missing tests, poor error messages
- SCALABILITY: Database query optimization, caching strategies, resource management
- COMPLIANCE: Accessibility (WCAG), data privacy (GDPR), security standards (OWASP)
- Lead with concrete findings rather than long summaries
- Cite the most relevant files, behaviors, or failure modes from the provided context
- Be explicit when a concern is a risk or inference rather than a confirmed bug
- Provide severity levels: Critical, High, Medium, Low
Use FILE: directives only if the user explicitly asks you to apply changes.`;
      case "command":
        return `${base}
${rules}
The user is asking to run or provide command-oriented actions.
- Prefer the smallest workspace-scoped command that satisfies the request.
- Use CMD: only when command execution is actually requested or clearly necessary.
- Do not wrap commands in explanations or tutorials.
- If file edits are also required, combine FILE: and CMD: only when both are necessary.
Respond with executable actions when a command is requested.
If a command alone solves the request, output CMD: actions only.
Format:
CMD: <single workspace command>
FILE: <exact file path>
\`\`\`
(complete updated file content)
\`\`\`
MKDIR: folder/subfolder
Output ONLY executable FILE:, MKDIR:, or CMD: actions. No explanations, no markdown outside code fences.`;
      case "edit":
        return `${base}
${rules}
The user wants to edit a file. Write PRODUCTION-GRADE code by default:
- Preserve existing architecture and style unless changes are required
- Apply all production-level standards: error handling, validation, security, performance, accessibility
- Include concrete fixes with proper error boundaries and fallback mechanisms
- Make the smallest correct change that fully solves the request at production quality
- Preserve public behavior unless the user explicitly asks for a behavioral change
- Update all directly affected code paths, imports, and nearby integration points when necessary
- Add proper logging for debugging production issues
- Ensure backward compatibility unless breaking changes are explicitly requested
- Do not silently remove logic, configuration, or content unless the request clearly calls for it
- Never delete or empty README.md unless the user explicitly asks you to remove it

**CRITICAL: Choose the right edit format:**

**Use PATCH by default for PRECISE edits to existing files:**
- Single function or block modification
- Localized bug fix
- Small-to-medium targeted refactor in one area
- Adding/removing an import or dependency line
- Updating config values, JSON entries, markup blocks, or a contained section

PATCH format:
PATCH: <exact file path>
SEARCH:
\`\`\`
(exact code to find - copy it EXACTLY from the provided file context)
\`\`\`
REPLACE:
\`\`\`
(new code to replace with)
\`\`\`

PATCH guidance:
- Prefer a unique SEARCH anchor, usually 3-12 surrounding lines.
- Make SEARCH the smallest exact block that is still unique in the target file.
- If the same SEARCH appears multiple times, expand it until only one match remains.
- It is okay for a PATCH to replace a larger block when needed; do not artificially keep it under 20 lines.
- If the edit touches one localized region, PATCH is usually still the right choice even when the replacement is 40-80 lines.
- Preserve surrounding formatting and unrelated logic.
- Prefer the editable source file over generated or packaged copies when both exist.

**Use FILE for BROAD rewrites:**
- Creating new files
- Multiple functions changed
- Structural reorganization
- Changes across multiple sections
- Whole-file rewrites
- Cases where an exact PATCH would be brittle or ambiguous
- User asks for complete rewrite

FILE format:
FILE: <exact file path>
\`\`\`
(COMPLETE file content - EVERY line from start to finish)
\`\`\`

**Example PATCH usage:**
User: "Fix the typo in the greeting function"
PATCH: src/app.js
SEARCH:
\`\`\`
function greet(name) {
  return \`Hello, \${nmae}!\`;
}
\`\`\`
REPLACE:
\`\`\`
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

You have access to structured shell actions when needed. Prefer PATCH and FILE actions; use CMD only when file edits alone cannot solve the request.
MKDIR: folder/subfolder
CMD: <single workspace command>
Output ONLY executable PATCH:, FILE:, MKDIR:, or CMD: actions. No explanations, no markdown outside code fences.`;
      case "scan":
        return `${base}
${rules}
Analyze the provided codebase context like a senior production engineer:
- Assess production readiness: deployment risks, monitoring gaps, error handling coverage
- Evaluate architecture: scalability, maintainability, technical debt, design patterns
- Identify security concerns: authentication, authorization, input validation, data exposure
- Review performance: bottlenecks, inefficient queries, resource leaks, caching opportunities
- Check compliance: accessibility, data privacy, security standards
- Prioritize correctness, architecture, behavioral risks, and missing verification
- Ground conclusions in the supplied files and context rather than generic advice
- Be explicit when something is an inference rather than directly shown by the code
- Provide actionable recommendations with priority levels`;
      default:
        return `${base}
${rules}
Answer helpfully and professionally with production-level insights:
- Provide direct, actionable guidance grounded in production best practices
- Consider real-world implications: scalability, security, maintenance, cost
- Reference industry standards and battle-tested patterns
- Highlight potential pitfalls and edge cases
- Suggest monitoring and observability strategies where relevant
Use FILE: or CMD: directives only when the user explicitly asks to create or run something.`;
    }
  }

  _shouldForceStructuredEdit(intent, userMessage) {
    // Only force structured edits when user explicitly asks to change files
    if (intent === "create") return true;
    if (intent === "edit" && this._isEditRequest(userMessage)) return true;
    if (
      (intent === "debug" || intent === "refactor") &&
      this._isEditRequest(userMessage) &&
      /\b(apply|fix|change|update|edit|modify|patch)\b/i.test(userMessage)
    ) {
      return true;
    }
    return false;
  }

  _buildStructuredRetryPrompt(rawResponse) {
    return `Your previous reply was not executable because it did not use structured actions.
Return ONLY executable actions now.

Rules:
- If the user asked you to change code/files, include at least one PATCH: or FILE: action.
- Use PATCH: for small targeted edits with SEARCH:/REPLACE: blocks.
- Use FILE: for new files, broad rewrites, or when PATCH would be brittle.
- Use MKDIR: only for directories (never file paths).
- Use CMD: only when truly needed, and only one command per CMD line (no &&, ||, ;, or pipes).
- Keep commands minimal and directly relevant to the request.
- If a previous command failed, return a corrected command that addresses the failure cause.
- You have access to workspace shell commands through CMD:, but avoid CMD unless file edits alone cannot solve the request.
- Do not give explanations or tutorial steps.
- Do not describe what to click in VS Code.
- Use exact file paths.
- If multiple files are needed, output multiple action blocks.
- For PATCH actions, copy SEARCH exactly from the provided file context and make it unique within that file.
- Prefer source files over generated copies such as \`.tmp-vsix-*\`, \`dist/\`, \`build/\`, or \`out/\` unless the user explicitly asks for those artifacts.

Previous invalid reply:
\`\`\`
${(rawResponse || "").slice(0, 4000)}
\`\`\``;
  }

  _buildFileOnlyRetryPrompt(rawResponse) {
    return `Your previous reply still did not provide executable file edits.
Return FILE actions only.

Hard rules:
- Output one or more FILE: blocks only.
- Do NOT output CMD:.
- Do NOT output MKDIR:.
- Each FILE block must contain complete file content.
- Use exact workspace-relative file paths.
- Do not include explanations or markdown outside code fences.

Previous invalid reply:
\`\`\`
${(rawResponse || "").slice(0, 4000)}
\`\`\``;
  }

  _isClarificationResponse(responseText, intent, userMessage) {
    if (!this._shouldForceStructuredEdit(intent, userMessage)) {
      return false;
    }

    const text = String(responseText || "").trim();
    if (!text) {
      return false;
    }

    if (this._hasMeaningfulActions(this._parseResponse(text).actions)) {
      return false;
    }

    const lower = text.toLowerCase();
    const asksQuestion = text.includes("?");
    const clarificationPatterns = [
      /\b(can you|could you|would you|please)\s+(clarify|share|provide|confirm|specify)\b/i,
      /\bwhich\s+(file|files|path|paths|part|function|component|version)\b/i,
      /\bwhat\s+(exactly|should|do you want|file|path|part)\b/i,
      /\bdo you want me to\b/i,
      /\bshould i\b/i,
      /\bi need\b.*\b(file|path|details|context|clarification|requirement|requirements)\b/i,
      /\bmissing\b.*\b(file|path|detail|details|context|requirement|requirements)\b/i,
      /\bplease provide\b.*\b(file|path|details|context|requirement|requirements)\b/i,
      /\bnot enough\b.*\b(context|information|detail|details)\b/i
    ];

    const soundsLikeClarification = clarificationPatterns.some((pattern) =>
      pattern.test(text)
    );

    const refusalPatterns = [
      /\bi cannot\b/i,
      /\bi can'?t\b/i,
      /\bas an ai\b/i,
      /\bi'm unable\b/i,
      /\bi do not have access\b/i
    ];
    const looksLikeRefusal = refusalPatterns.some((pattern) =>
      pattern.test(lower)
    );

    return soundsLikeClarification && asksQuestion && !looksLikeRefusal;
  }

  _hasPatchActions(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return false;
    return actions.some((action) => {
      if (!action || action.type !== "patch") return false;
      return (
        typeof action.search === "string" &&
        action.search.length > 0 &&
        typeof action.replace === "string"
      );
    });
  }

  _hasFileActions(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return false;
    return actions.some((action) => {
      if (!action || action.type !== "file") return false;
      return typeof action.content === "string" && action.content.trim().length > 0;
    });
  }

  _hasEditActions(actions) {
    return this._hasPatchActions(actions) || this._hasFileActions(actions);
  }

  _hasRequiredActions(intent, userMessage, actions) {
    if (!this._hasMeaningfulActions(actions)) {
      return false;
    }

    if (this._shouldForceStructuredEdit(intent, userMessage)) {
      return this._hasEditActions(actions);
    }

    return true;
  }

  _hasMeaningfulActions(actions) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return false;
    }

    return actions.some((action) => {
      if (!action) return false;
      if (action.type === "patch") {
        return (
          typeof action.search === "string" &&
          action.search.length > 0 &&
          typeof action.replace === "string"
        );
      }
      if (action.type === "file") {
        return (
          typeof action.content === "string" && action.content.trim().length > 0
        );
      }
      return action.type === "mkdir" || action.type === "cmd";
    });
  }

  _getEmptyResponseFallback(mode) {
    return mode === "heavy" || mode === "deep"
      ? "I didn't produce a response. Please try again or switch to Fast mode for lighter questions."
      : "I didn't produce a quick reply. Try asking again, switch to Heavy mode for code-heavy tasks, or use /heavy.";
  }

  _isRepoWideScanRequest(message) {
    const text = (message || "").toLowerCase();
    if (!text) {
      return false;
    }

    const hasScanVerb =
      /\b(scan|read|overview|summari[sz]e|describe|review|analy[sz]e|audit|inspect|map out|walk through|walkthrough)\b/i.test(
        text
      );
    const hasRepoScope =
      /\b(all files|entire|whole|codebase|repo|repository|project|workspace|directory|directories|folder|folders|architecture)\b/i.test(
        text
      );
    const hasSpecificPathHint = this._extractPathHints(text).length > 0;
    const singularFileScope =
      /\bfile\b/i.test(text) && !/\bfiles\b/i.test(text);

    return (
      hasScanVerb &&
      hasRepoScope &&
      !hasSpecificPathHint &&
      !singularFileScope
    );
  }

  _shouldUseRepoContextInFastMode(message, provider = "") {
    const text = message || "";
    const wantsRepoWideContext =
      /\b(scan|read|codebase|repo|repository|project|workspace|files|entire|all files|overview|summarize|audit|architecture|graph|graphify|readme)\b/i.test(
        text
      );
    const mentionsSpecificPath =
      /[/\\]|\.[a-z0-9]{1,5}\b/i.test(text) ||
      this._extractPathHints(text).length > 0;

    if (provider === "nvidia") {
      return wantsRepoWideContext || mentionsSpecificPath;
    }

    return (
      wantsRepoWideContext ||
      (/\b(error|issue|bug|broken|not working|failing|cannot|can't|why)\b/i.test(
        text
      ) &&
        /\b(repo|repository|project|workspace|codebase|across|multiple files|all files)\b/i.test(
          text
        ))
    );
  }

  _shouldSearchContent(query, pathHints) {
    const text = (query || "").toLowerCase();
    if (Array.isArray(pathHints) && pathHints.length > 0) return true;
    if (
      /\b(codebase|repo|repository|project|workspace|all files|entire|whole|scan|overview|summari[sz]e|analy[sz]e|audit|review)\b/i.test(
        text
      )
    )
      return true;
    if (this._mentionsEditorFiles(text)) return false;
    return false;
  }

  _isLikelyActiveFileFollowUp(message) {
    const text = (message || "").trim();
    if (!text) {
      return false;
    }

    if (
      this._mentionsEditorFiles(text) ||
      this._extractPathHints(text).length > 0
    ) {
      return false;
    }

    if (
      /\b(codebase|repo|repository|project|workspace|all files?)\b/i.test(text)
    ) {
      return false;
    }

    return (
      /\b(find|check|inspect|analy[sz]e|review|look(?:\s+for)?|explain|summari[sz]e|debug)\b/i.test(
        text
      ) ||
      /\b(issue|issues|problem|problems|bug|bugs|error|errors|wrong|fix)\b/i.test(
        text
      ) ||
      /\b(this|it|that)\b/i.test(text)
    );
  }

  _buildRelevantFileContext(
    relevantFiles,
    maxSnippetChars = MAX_FILE_SNIPPET,
    maxContextChars = MAX_CONTEXT_CHARS
  ) {
    if (!Array.isArray(relevantFiles) || relevantFiles.length === 0) {
      return "";
    }

    let context = "Relevant workspace files:\n";
    for (const file of relevantFiles) {
      const snippet = (file.content || "").slice(0, maxSnippetChars);
      const block = `File: ${file.path}\n\`\`\`\n${snippet}\n\`\`\`\n\n`;
      if ((context + block).length > maxContextChars) {
        break;
      }
      context += block;
    }

    return context.trim();
  }

  _isRepeatingResponse(text, mode = "fast") {
    const window =
      mode === "heavy" || mode === "deep"
        ? REPETITION_WINDOW_HEAVY
        : REPETITION_WINDOW;
    if (!text || text.length < window * 2) {
      return false;
    }

    const tail = text.slice(-window);
    const previousText = text.slice(0, -window);
    return previousText.includes(tail);
  }

  _extractPathHints(query) {
    const matches = query.match(
      /(?:[A-Za-z]:\\[^\s"'`]+|(?:[\w.-]+[\\/])+[\w.-]+(?:\.[\w]+)?|[\w.-]+\.[A-Za-z0-9]+)/g
    );

    return (matches || []).map((value) =>
      value
        .replace(/^["'`]|["'`]$/g, "")
        .replace(/\\/g, "/")
        .toLowerCase()
    );
  }

  _isGeneratedArtifactPath(filePath) {
    const normalizedPath = String(filePath || "")
      .replace(/\\/g, "/")
      .toLowerCase();
    return (
      normalizedPath.includes("/dist/") ||
      normalizedPath.includes("/build/") ||
      normalizedPath.includes("/out/") ||
      normalizedPath.startsWith("dist/") ||
      normalizedPath.startsWith("build/") ||
      normalizedPath.startsWith("out/") ||
      normalizedPath.includes("/.tmp-vsix-") ||
      normalizedPath.startsWith(".tmp-vsix-")
    );
  }

  _preferSourcePathMatches(paths) {
    if (!Array.isArray(paths) || paths.length <= 1) {
      return Array.isArray(paths) ? paths : [];
    }

    const sourceLike = paths.filter(
      (candidate) => !this._isGeneratedArtifactPath(candidate)
    );
    return sourceLike.length > 0 ? sourceLike : paths;
  }

  _matchPathsFromHints(pathHints) {
    const matches = new Set();

    for (const hint of pathHints) {
      const normalizedHint = hint.replace(/\\/g, "/").toLowerCase();
      const hintedBaseName = path.basename(normalizedHint);
      const hintMatches = [];

      for (const relativePath of this.codebaseContext.keys()) {
        const normalizedPath = relativePath.replace(/\\/g, "/").toLowerCase();
        const baseName = path.basename(normalizedPath);

        if (
          normalizedPath === normalizedHint ||
          normalizedPath.endsWith(`/${normalizedHint}`) ||
          baseName === hintedBaseName
        ) {
          hintMatches.push(relativePath.replace(/\\/g, "/"));
        }
      }

      for (const candidate of this._preferSourcePathMatches(hintMatches)) {
        matches.add(candidate);
      }
    }

    return Array.from(matches).sort();
  }

  _preferActivePathMatches(paths, activePath) {
    if (!Array.isArray(paths) || paths.length <= 1 || !activePath) {
      return Array.isArray(paths) ? paths : [];
    }

    const normalizedActivePath = activePath.replace(/\\/g, "/").toLowerCase();
    const activeBaseName = path.basename(normalizedActivePath);
    const sameBaseMatches = paths.filter(
      (candidate) =>
        path.basename(candidate.replace(/\\/g, "/").toLowerCase()) ===
        activeBaseName
    );

    if (sameBaseMatches.length <= 1) {
      return paths;
    }

    const exactActiveMatch = sameBaseMatches.find(
      (candidate) =>
        candidate.replace(/\\/g, "/").toLowerCase() === normalizedActivePath
    );
    if (exactActiveMatch) {
      return [exactActiveMatch];
    }

    const activeTopLevel = normalizedActivePath.split("/")[0];
    const sameTopLevelMatches = sameBaseMatches.filter((candidate) =>
      candidate
        .replace(/\\/g, "/")
        .toLowerCase()
        .startsWith(`${activeTopLevel}/`)
    );
    if (sameTopLevelMatches.length > 0) {
      return sameTopLevelMatches;
    }

    return sameBaseMatches;
  }

  _resolveEditableTargets(userMessage, workspaceFolder, editorState) {
    const message = userMessage || "";
    const explicitPaths = this._preferActivePathMatches(
      this._matchPathsFromHints(this._extractPathHints(message)),
      editorState.activeTabPath
    );
    const targetPaths = new Set(explicitPaths);
    const isEditRequest = this._isEditRequest(message);
    const intent = this._detectIntent(message);

    // For scan/create intent, don't auto-add active tab
    if (intent === "scan" || intent === "create") {
      return {
        scope: targetPaths.size > 0 ? "restricted" : "workspace",
        paths: Array.from(targetPaths).sort()
      };
    }

    if (
      /\b(active|current)\s+(tab|file|editor)\b/i.test(message) &&
      editorState.activeTabPath
    ) {
      targetPaths.add(editorState.activeTabPath);
    }

    if (/\bvisible\s+tabs?\b/i.test(message)) {
      for (const tabPath of editorState.visibleTabs) targetPaths.add(tabPath);
    }

    if (
      /\b(all\s+)?open\s+tabs?\b/i.test(message) ||
      /\bthese\s+tabs?\b/i.test(message)
    ) {
      for (const tabPath of editorState.allOpenTabs) targetPaths.add(tabPath);
    }

    if (
      isEditRequest &&
      targetPaths.size === 0 &&
      editorState.activeTabPath &&
      !/\bworkspace\b/i.test(message)
    ) {
      targetPaths.add(editorState.activeTabPath);
    }

    const paths = Array.from(targetPaths).sort();
    return { scope: paths.length > 0 ? "restricted" : "workspace", paths };
  }

  _buildEditableTargetsContext(editableTargets) {
    if (editableTargets.scope !== "restricted") {
      return "Editable targets: workspace-wide. You may edit any indexed workspace file only when the user clearly asks for it.\n";
    }

    return `Editable targets (only edit these files):\n${editableTargets.paths
      .map((filePath) => `File: ${filePath}`)
      .join("\n")}\n`;
  }

  getDeterministicEditorStateResponse(userMessage, workspaceFolder) {
    const message = (userMessage || "").trim().toLowerCase();
    if (!this._isTabQuestion(message) || this._isEditRequest(message)) {
      return null;
    }

    const editorState = this._getEditorState(workspaceFolder);
    if (!editorState.available) {
      return null;
    }

    const wantsVisibleTabs = /\bvisible\s+tabs?\b/.test(message);
    const wantsOpenTabs =
      /\b(all\s+)?open\s+tabs?\b/.test(message) ||
      /\bcurrent\s+open\s+tabs?\b/.test(message);
    const wantsActiveTab =
      /\bactive\s+tabs?\b/.test(message) ||
      /\bactive\s+file\b/.test(message) ||
      /\bcurrent\s+tab\b/.test(message);

    if (wantsVisibleTabs) {
      return this._formatDeterministicFileList(
        editorState.visibleTabs,
        "I do not have access to the current open tabs."
      );
    }

    if (wantsOpenTabs) {
      return this._formatDeterministicFileList(
        editorState.allOpenTabs,
        "I do not have access to the current open tabs."
      );
    }

    if (wantsActiveTab || /\btabs?\b/.test(message)) {
      return editorState.activeTabPath
        ? `File: ${editorState.activeTabPath}`
        : "I do not have access to the current open tabs.";
    }

    return null;
  }

  _formatDeterministicFileList(filePaths, emptyMessage) {
    if (!filePaths || filePaths.length === 0) {
      return emptyMessage;
    }

    return filePaths.map((filePath) => `File: ${filePath}`).join("\n");
  }

  _getSyntaxCheckCommand(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const rel = filePath.replace(/\\/g, "/");
    if ([".js", ".jsx", ".ts", ".tsx"].includes(ext))
      return `node --check ${rel}`;
    if (ext === ".py") return `python -m py_compile ${rel}`;
    if (ext === ".java") return `javac ${rel}`;
    if ([".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".ino"].includes(ext))
      return `node -e "process.exit(0)" && echo "C/C++ syntax check requires a compiler - run: gcc -fsyntax-only ${rel}"`;
    if (ext === ".json") return `node -e "JSON.parse(require('fs').readFileSync('${rel}', 'utf8'))"`;
    if (ext === ".html") return null; // HTML checked via parse5 in agent
    return null;
  }

  async _runSyntaxCheck(relPath, workspaceFolder, fileContent = null) {
    const cmd = this._getSyntaxCheckCommand(relPath);
    const ext = path.extname(relPath).toLowerCase();
    
    // Special handling for HTML - use parse5
    if (ext === ".html") {
      try {
        const parse5 = require("parse5");
        const fullPath = workspaceFolder ? path.join(workspaceFolder, relPath) : relPath;
        const content = fileContent || await require("fs").promises.readFile(fullPath, "utf8");
        parse5.parse(content, { sourceCodeLocationInfo: true });

        // parse5 is very forgiving and does not expose strict HTML "syntax errors"
        // in the way a compiler would. Successfully parsing here means the document
        // is structurally readable HTML, so avoid flagging normal nodes like
        // #documentType or #text as malformed tags.
        return { success: true, output: "" };
      } catch (err) {
        return { success: false, error: `HTML parse error: ${err.message}`, output: err.message };
      }
    }
    
    if (!cmd) return null;

    // C/C++ — just report the command to run, can't execute compiler here
    if (cmd.includes("gcc -fsyntax-only")) {
      const msg = `C/C++ syntax check: run \`gcc -fsyntax-only ${relPath}\` in your terminal.`;
      return { success: true, output: msg, skipped: true };
    }

    if (!this.validateCommand(cmd).allowed) return null;
    
    // If fileContent provided, write to temp file for syntax check
    if (fileContent) {
      const os = require("os");
      const fsSync = require("fs");
      const tempExt = path.extname(relPath);
      const tempName = `code-janitor-syntax-${Date.now()}-${Math.random().toString(16).slice(2)}${tempExt}`;
      const tempPath = path.join(os.tmpdir(), tempName);
      try {
        fsSync.writeFileSync(tempPath, fileContent, "utf8");
        const tempCmd = this._getSyntaxCheckCommand(tempPath.replace(/\\/g, "/"));
        const result = await this.executeCommand(tempCmd, workspaceFolder);
        try { fsSync.unlinkSync(tempPath); } catch (_) {}
        
        // FIXED: Only consider it an error if the command failed (non-zero exit)
        // Don't treat stdout/stderr output as errors - many tools print to stdout on success
        return {
          success: result.success,
          output: result.output || result.error || "",
          error: result.success ? null : (result.error || result.output || "Syntax check failed")
        };
      } catch (err) {
        try { fsSync.unlinkSync(tempPath); } catch (_) {}
        return { success: false, error: `Temp file syntax check failed: ${err.message}`, output: err.message };
      }
    }
    
    const result = await this.executeCommand(cmd, workspaceFolder);
    
    // FIXED: Only consider it an error if the command failed (non-zero exit)
    // For syntax checks, success = command exited with code 0
    // Python py_compile, node --check, javac all exit with 0 on success
    return {
      success: result.success,
      output: result.output || result.error || "",
      error: result.success ? null : (result.error || result.output || "Syntax check failed")
    };
  }

  _buildRelevantFilesCacheKey(query, workspaceFolder, options = {}) {
    const activeEditor =
      vscode.window.activeTextEditor || this._lastActiveEditor;
    const activePath =
      activeEditor && workspaceFolder
        ? path
            .relative(workspaceFolder, activeEditor.document.fileName)
            .replace(/\\/g, "/")
        : "";
    return [
      workspaceFolder || "",
      this.scanVersion,
      activePath,
      Number.isFinite(options.maxResults) ? options.maxResults : MAX_RELEVANT_FILES,
      Number.isFinite(options.snippetChars) ? options.snippetChars : MAX_FILE_SNIPPET,
      this._extractKeywords(query).join(","),
      this._extractPathHints(query).join(",")
    ].join("::");
  }

  _findRelevantFiles(query, workspaceFolder, options = {}) {
    const cacheKey = this._buildRelevantFilesCacheKey(
      query,
      workspaceFolder,
      options
    );
    if (this._relevantFileCache.has(cacheKey)) {
      return this._relevantFileCache.get(cacheKey).map((entry) => ({ ...entry }));
    }

    const snippetChars =
      Number.isFinite(options.snippetChars) && options.snippetChars > 0
        ? options.snippetChars
        : MAX_FILE_SNIPPET;
    const maxResults =
      Number.isFinite(options.maxResults) && options.maxResults > 0
        ? options.maxResults
        : MAX_RELEVANT_FILES;
    const keywords = this._extractKeywords(query);
    const pathHints = this._extractPathHints(query);
    const relevant = [];
    const allowContentSearch = this._shouldSearchContent(query, pathHints);
    const activeRelativePath = this._getActiveRelativePath(workspaceFolder);
    const preferredHintMatches = new Set(
      this._preferActivePathMatches(
        this._matchPathsFromHints(pathHints),
        activeRelativePath
      ).map((candidate) => candidate.replace(/\\/g, "/").toLowerCase())
    );
    const preferredGraphMatches = new Set(
      this._preferActivePathMatches(
        matchGraphPathsFromHints(
          this._getCachedKnowledgeGraphData(workspaceFolder),
          pathHints
        ),
        activeRelativePath
      ).map((candidate) => candidate.replace(/\\/g, "/").toLowerCase())
    );

    for (const [relativePath, fileData] of this.codebaseContext.entries()) {
      const normalizedPath = relativePath.replace(/\\/g, "/").toLowerCase();
      const fileContent = fileData.content.toLowerCase();
      const fileName = fileData.fileName;
      const directory = fileData.directory;

      let score = 0;

      if (activeRelativePath && normalizedPath === activeRelativePath) {
        score += 40;
      }

      if (preferredHintMatches.has(normalizedPath)) {
        score += 120;
      }

      if (preferredGraphMatches.has(normalizedPath)) {
        score += 140;
      }

      for (const hint of pathHints) {
        if (normalizedPath === hint || fileName === path.basename(hint)) {
          score += 80;
        } else if (normalizedPath.includes(hint) || hint.includes(fileName)) {
          score += 30;
        }
      }

      let contentHits = 0;
      for (const keyword of keywords) {
        if (fileName.includes(keyword)) score += 10;
        if (directory.includes(keyword)) score += 5;
        if (normalizedPath.includes(keyword)) score += 4;
        if (
          allowContentSearch &&
          !CONTENT_NOISE_WORDS.has(keyword) &&
          fileContent.includes(keyword)
        ) {
          contentHits += 1;
        }
      }

      if (allowContentSearch && contentHits > 0) {
        score += Math.min(6, contentHits * 2);
      }

      if (score > 0) {
        relevant.push({
          path: relativePath,
          score,
          content: fileData.content.slice(0, snippetChars)
        });
      }
    }

    const result = relevant
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (activeRelativePath) {
          const aActive =
            a.path.replace(/\\/g, "/").toLowerCase() === activeRelativePath
              ? 1
              : 0;
          const bActive =
            b.path.replace(/\\/g, "/").toLowerCase() === activeRelativePath
              ? 1
              : 0;
          if (bActive !== aActive) return bActive - aActive;
        }
        return a.path.localeCompare(b.path);
      })
      .slice(0, maxResults);

    this._relevantFileCache.set(
      cacheKey,
      result.map((entry) => ({ ...entry }))
    );
    if (this._relevantFileCache.size > RELEVANT_FILE_CACHE_LIMIT) {
      const oldestKey = this._relevantFileCache.keys().next().value;
      if (oldestKey) this._relevantFileCache.delete(oldestKey);
    }

    return result;
  }

  _buildPrompt(
    userMessage,
    relevantFiles,
    activeFileContext,
    editorStateContext,
    openTabSnippetContext,
    isTabQuestion,
    editableTargets,
    mode,
    knowledgeGraphContext = ""
  ) {
    const history = this._buildPromptHistoryContext(isTabQuestion);

    const intent = this._detectIntent(userMessage);
      const systemInstruction = this._buildSystemInstruction(
        intent,
        this.workspaceRoot,
        mode,
        this.showThinking
      );
    const isCreateIntent = intent === "create";
    const MAX_PROMPT_CHARS =
      intent === "edit" || intent === "debug" || intent === "refactor"
        ? 18_000
        : 12_000;

    let context = "";
    if (!isCreateIntent) {
      for (const file of relevantFiles) {
        const block = `File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
        if ((context + block).length > MAX_PROMPT_CHARS) break;
        context += block;
      }
      if (!context) {
        const allFiles = Array.from(this.codebaseContext.keys())
          .map((p) => p.replace(/\\/g, "/"))
          .sort();
        if (allFiles.length > 0) {
          if (intent === "scan") {
            let snippetContext = "";
            for (const [
              relativePath,
              fileData
            ] of this.codebaseContext.entries()) {
              const block = `File: ${relativePath.replace(/\\/g, "/")}\n\`\`\`\n${fileData.content.slice(0, 500)}\n\`\`\`\n\n`;
              if ((snippetContext + block).length > MAX_PROMPT_CHARS) break;
              snippetContext += block;
            }
            context =
              snippetContext ||
              `Workspace files:\n${allFiles.map((f) => `- ${f}`).join("\n")}\n`;
          } else if (this._shouldUseRepoContextInFastMode(userMessage)) {
            context = `Workspace files:\n${allFiles.map((f) => `- ${f}`).join("\n")}\n`;
          } else {
            context = "No additional workspace file context was included.\n";
          }
        } else {
          context = "No indexed files found.\n";
        }
      }
    }

    const editableTargetsContext =
      this._buildEditableTargetsContext(editableTargets);
    const effectiveEditorState = isCreateIntent ? "" : editorStateContext;
    const effectiveActiveFile = isCreateIntent ? "" : activeFileContext;
    const effectiveTabContext = isCreateIntent ? "" : openTabSnippetContext;
    const effectiveKnowledgeGraph = isCreateIntent ? "" : knowledgeGraphContext;

    return `${systemInstruction}
Indexed files: ${this.codebaseContext.size}
${effectiveKnowledgeGraph}${effectiveEditorState ? `${effectiveEditorState}\n` : ""}${editableTargetsContext}${effectiveActiveFile ? `${effectiveActiveFile}\n\n` : ""}${effectiveTabContext}${context}
${history ? `${history}\n\n` : ""}
### USER_MESSAGE ###
${userMessage}`;
  }

  _parseResponse(response) {
    const actions = [];
    const warnings = [];
    const normalizeActionPath = (rawPath) => {
      const input = (rawPath || "").trim();
      if (!input) return { path: "", outsideWorkspace: false };

      const normalizedRaw = input.replace(/\\/g, "/");
      const looksAbsolute =
        path.isAbsolute(input) || /^[a-z]:\//i.test(normalizedRaw);
      if (!looksAbsolute) {
        return { path: normalizedRaw, outsideWorkspace: false };
      }

      const probe = this._resolveWorkspacePath(input);
      if (probe.noWorkspace || !probe.fullPath) {
        return { path: normalizedRaw, outsideWorkspace: false };
      }

      const normalizedFullPath = probe.fullPath.replace(/\\/g, "/");
      if (probe.outsideWorkspace) {
        return { path: normalizedFullPath, outsideWorkspace: true };
      }

      const relativePath = path
        .relative(probe.workspaceRoot, probe.fullPath)
        .replace(/\\/g, "/");
      return { path: relativePath, outsideWorkspace: false };
    };
    const isAllowedMkdirTarget = (dirPath) => {
      if (!this.currentEditableTargets) return true;
      const normalizedDir = (dirPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
      if (!normalizedDir) return false;
      for (const targetPath of this.currentEditableTargets) {
        const normalizedTarget = targetPath.replace(/\\/g, "/");
        if (normalizedTarget.startsWith(`${normalizedDir}/`)) {
          return true;
        }
      }
      return false;
    };

    // Match PATCH: actions for targeted edits
    const patchRegex = /PATCH:\s*([^\r\n`]+)\r?\nSEARCH:\s*\r?\n```[\w]*\r?\n?([\s\S]*?)```\s*\r?\nREPLACE:\s*\r?\n```[\w]*\r?\n?([\s\S]*?)```/g;
    let match;
    while ((match = patchRegex.exec(response)) !== null) {
      const pathInfo = normalizeActionPath(match[1]);
      const normalizedPath = pathInfo.path;
      const searchContent = match[2] || "";
      const replaceContent = match[3] || "";

      if (!normalizedPath || normalizedPath.includes("\n")) continue;

      if (
        this.currentEditableTargets &&
        !this.currentEditableTargets.has(normalizedPath)
      ) {
        warnings.push(`Blocked edit outside allowed targets: ${normalizedPath}`);
        continue;
      }

      actions.push({
        type: "patch",
        path: normalizedPath,
        search: searchContent,
        replace: replaceContent
      });
    }

    // Match FILE: with flexible code block format
    const fileRegex = /FILE:\s*([^\r\n`]+)\r?\n```[\w]*\r?\n?([\s\S]*?)```/g;
    while ((match = fileRegex.exec(response)) !== null) {
      const pathInfo = normalizeActionPath(match[1]);
      const normalizedPath = pathInfo.path;
      const content = match[2] || "";

      if (!normalizedPath || normalizedPath.includes("\n")) continue;

      if (
        this.currentEditableTargets &&
        !this.currentEditableTargets.has(normalizedPath)
      ) {
        warnings.push(`Blocked edit outside allowed targets: ${normalizedPath}`);
        continue;
      }

      actions.push({
        type: "file",
        path: normalizedPath,
        language: "text",
        content
      });
    }

    // Fallback: also try matching FILE: followed by content without code fences
    if (actions.length === 0) {
      const looseFIleRegex =
        /FILE:\s*([^\r\n`]+)\r?\n([\s\S]*?)(?=\r?\n(?:FILE|File|MKDIR|CMD):|$)/g;
      while ((match = looseFIleRegex.exec(response)) !== null) {
        const pathInfo = normalizeActionPath(match[1]);
        const normalizedPath = pathInfo.path;
        const content = match[2].replace(/^```[\w]*\n?|```$/gm, "").trim();
        if (!normalizedPath || normalizedPath.includes("\n") || !content)
          continue;
        if (
          this.currentEditableTargets &&
          !this.currentEditableTargets.has(normalizedPath)
        ) {
          warnings.push(
            `Blocked edit outside allowed targets: ${normalizedPath}`
          );
          continue;
        }
        actions.push({
          type: "file",
          path: normalizedPath,
          language: "text",
          content
        });
      }
    }

    const cmdRegex = /^CMD:\s*(.+)$/gm;
    while ((match = cmdRegex.exec(response)) !== null) {
      const cmd = match[1].trim();
      if (
        cmd.startsWith("/") ||
        cmd.startsWith("FILE:") ||
        cmd.startsWith("MKDIR:")
      )
        continue;
      actions.push({ type: "cmd", command: cmd });
    }

    const mkdirRegex = /MKDIR:\s*(.+)/g;
    while ((match = mkdirRegex.exec(response)) !== null) {
      const pathInfo = normalizeActionPath(match[1]);
      const normalizedPath = pathInfo.path;
      if (!normalizedPath) continue;
      if (!isAllowedMkdirTarget(normalizedPath)) {
        warnings.push(`Blocked folder outside allowed targets: ${normalizedPath}`);
        continue;
      }
      actions.push({ type: "mkdir", path: normalizedPath });
    }

    // Match only explicit GRAPHIFY actions to avoid accidental triggers
    if (/GRAPHIFY\s*:\s*open/i.test(response)) {
      actions.push({ type: "graphify" });
    }

    if (/LINT\s*:\s*active/i.test(response)) {
      actions.push({ type: "lint" });
    }

    if (/VALIDATE\s*:\s*frontend/i.test(response)) {
      actions.push({ type: "validate_frontend" });
    }

    if (/PREVIEW\s*:\s*inspect/i.test(response)) {
      actions.push({ type: "preview_inspect" });
    }

    if (/PREVIEW\s*:\s*open/i.test(response)) {
      actions.push({ type: "preview" });
    }

    if (/PERFORMANCE\s*:\s*show/i.test(response)) {
      actions.push({ type: "performance" });
    }

    // Match FETCH: actions for web requests
    const fetchRegex = /FETCH:\s*(.+)/g;
    while ((match = fetchRegex.exec(response)) !== null) {
      const url = match[1].trim();
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        actions.push({ type: "fetch", url });
      }
    }

    // YouTube searches are handled separately via the YouTube button in the UI.
    // Intentionally do not parse YOUTUBE: actions from AI responses.

    return { text: response, actions, warnings };
  }

  _resolveWorkspacePath(inputPath) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
      return {
        workspaceRoot: null,
        fullPath: null,
        outsideWorkspace: true,
        noWorkspace: true
      };
    }

    const resolved = path.resolve(
      path.isAbsolute(inputPath)
        ? inputPath
        : path.join(workspaceRoot, inputPath)
    );
    const relative = path.relative(workspaceRoot, resolved);
    const outsideWorkspace =
      relative.startsWith("..") || path.isAbsolute(relative);

    return { workspaceRoot, fullPath: resolved, outsideWorkspace };
  }

  validateCommand(command) {
    const normalized = command.trim().toLowerCase();

    if (!normalized) {
      return { allowed: false, reason: "Empty command" };
    }

    const blockedPatterns = [
      /\bnpm\s+install\s+-g\b/,
      /\bnpm\s+i\s+-g\b/,
      /\bpip(?:3)?\s+install\b/,
      /\bcargo\s+install\b/,
      /\bgo\s+install\b/,
      /\byarn\s+global\b/,
      /\bpnpm\s+add\s+-g\b/,
      /\bchoco\s+install\b/,
      /\bwinget\s+install\b/,
      /\bapt(?:-get)?\s+install\b/,
      /\bcurl\b/,
      /\bwget\b/,
      /\binvoke-webrequest\b/,
      /\birm\b/,
      /\bgit\s+clone\b/,
      /\bdel\b/,
      /\brm\b/,
      /\brmdir\b/,
      /^format(?:\s|$)/
    ];

    if (blockedPatterns.some((pattern) => pattern.test(normalized))) {
      return {
        allowed: false,
        reason: "Blocked unsafe, global, or network command"
      };
    }

    if (/[|;&]|&&|\|\|/.test(normalized)) {
      return {
        allowed: false,
        reason: "Use one project-scoped command per CMD line (no chaining)"
      };
    }

    const allowedPrefixes = [
      "mkdir ",
      "md ",
      "findstr ",
      "rg ",
      "grep ",
      "ls",
      "dir",
      "cat ",
      "type ",
      "get-content ",
      "gc ",
      "head ",
      "tail ",
      "echo ",
      "pwd",
      "cd ",
      "tree ",
      "find ",
      "which ",
      "where ",
      "get-childitem ",
      "gci ",
      "select-string ",
      "sls ",
      "npm install",
      "npm i",
      "npm run",
      "npm test",
      "npm start",
      "npm build",
      "npm list",
      "npm outdated",
      "npm audit",
      "npx ",
      "yarn install",
      "yarn add",
      "yarn remove",
      "yarn run",
      "yarn test",
      "yarn build",
      "pnpm install",
      "pnpm add",
      "pnpm remove",
      "pnpm run",
      "pnpm test",
      "node --check",
      "node -e",
      "node ",
      "git status",
      "git diff",
      "git log",
      "git show",
      "git branch",
      "git checkout",
      "git add",
      "git commit",
      "git pull",
      "git fetch",
      "git merge",
      "git rebase",
      "git stash",
      "git tag",
      "git remote",
      "git rev-parse",
      "git push",
      "python -m py_compile",
      "python -m flake8",
      "python -m pylint",
      "python -m pytest",
      "python -m unittest",
      "pip list",
      "pip3 list",
      "python ",
      "python3 -m py_compile",
      "python3 -m flake8",
      "python3 -m pylint",
      "python3 -m pytest",
      "python3 -m unittest",
      "python3 ",
      "pytest",
      "eslint ",
      "tsc ",
      "javac ",
      "java ",
      "mvn clean",
      "mvn compile",
      "mvn test",
      "mvn package",
      "gradle build",
      "gradle test",
      "gradle clean",
      "cargo build",
      "cargo test",
      "cargo check",
      "cargo run",
      "go build",
      "go test",
      "go run",
      "dotnet build",
      "dotnet test",
      "dotnet run",
      "arduino-cli lib list",
      "arduino-cli lib search",
      ".\\node_modules\\.bin\\",
      "./node_modules/.bin/"
    ];

    if (!allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
      return {
        allowed: false,
        reason: "Only project-scoped commands are allowed"
      };
    }

    return { allowed: true };
  }

  _summarizeLineChanges(oldContent, newContent) {
    const oldLines = (oldContent || "").split(/\r?\n/);
    const newLines = (newContent || "").split(/\r?\n/);

    if ((oldContent || "") === "") {
      const addedPreview = newLines.slice(0, 12).join("\n");
      return {
        changed: true,
        summary: `Created file with ${newLines.length} line(s).\n+ ${addedPreview}`
      };
    }

    let start = 0;
    while (
      start < oldLines.length &&
      start < newLines.length &&
      oldLines[start] === newLines[start]
    ) {
      start += 1;
    }

    if (start === oldLines.length && start === newLines.length) {
      return { changed: false, summary: "No line changes." };
    }

    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (
      oldEnd >= start &&
      newEnd >= start &&
      oldLines[oldEnd] === newLines[newEnd]
    ) {
      oldEnd -= 1;
      newEnd -= 1;
    }

    const removedLines = oldLines.slice(start, oldEnd + 1);
    const addedLines = newLines.slice(start, newEnd + 1);
    const removedStartLine = start + 1;
    const addedStartLine = start + 1;
    const removedEndLine = removedStartLine + removedLines.length - 1;
    const addedEndLine = addedStartLine + addedLines.length - 1;

    const formatRange = (startLine, endLine, count) =>
      count <= 0
        ? "none"
        : startLine === endLine
          ? `${startLine}`
          : `${startLine}-${endLine}`;

    const removedBlock = removedLines.length
      ? removedLines
          .slice(0, 12)
          .map((line) => `- ${line}`)
          .join("\n")
      : "- <none>";
    const addedBlock = addedLines.length
      ? addedLines
          .slice(0, 12)
          .map((line) => `+ ${line}`)
          .join("\n")
      : "+ <none>";

    return {
      changed: true,
      summary:
        `Replaced old line(s) ${formatRange(removedStartLine, removedEndLine, removedLines.length)} ` +
        `with new line(s) ${formatRange(addedStartLine, addedEndLine, addedLines.length)}.\n` +
        `${removedBlock}\n${addedBlock}`
    };
  }

  _isDocFile(filePath) {
    const normalized = (filePath || "").replace(/\\/g, "/").toLowerCase();
    return (
      normalized.endsWith(".md") ||
      normalized.endsWith(".markdown") ||
      normalized.endsWith(".txt") ||
      normalized.endsWith(".rst") ||
      normalized.endsWith(".adoc")
    );
  }

  async applyChanges(
    filePath,
    newContent,
    allowOutsideWorkspace = false,
    options = {}
  ) {
    const context = {
      type: "file",
      filePath,
      newContent,
      allowOutsideWorkspace,
      ...options
    };
    
    // Use self-diagnosing retry
    return await this.errorHandler.retryWithAutoFix(
      async (ctx) => this._applyChangesInternal(ctx),
      context,
      3
    );
  }
  
  async _applyChangesInternal(context) {
    const { filePath, newContent, allowOutsideWorkspace, allowEmpty, allowDocTruncate } = context;
    
    try {
      const { workspaceRoot, fullPath, outsideWorkspace } =
        this._resolveWorkspacePath(filePath);

      // If outside workspace and not explicitly allowed, ask for permission
      if (outsideWorkspace && !allowOutsideWorkspace) {
        return { success: false, error: "outside_workspace", path: fullPath };
      }

      let oldContent = "";
      let created = false;
      try {
        oldContent = await fs.readFile(fullPath, "utf8");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        created = true;
      }

      const isReadme =
        typeof fullPath === "string" &&
        path.basename(fullPath).toLowerCase() === "readme.md";
      const trimmedNewContent = (newContent || "").trim();

      if (!created && trimmedNewContent.length === 0 && !allowEmpty) {
        return {
          success: false,
          error: "Refusing to empty an existing file without explicit user request."
        };
      }

      if (isReadme && trimmedNewContent.length === 0) {
        return {
          success: false,
          error: "Refusing to delete or empty README.md without explicit user request."
        };
      }

      if (!created && this._isDocFile(fullPath) && !allowDocTruncate) {
        const oldTrimmedLength = (oldContent || "").trim().length;
        const newTrimmedLength = trimmedNewContent.length;
        const looksLikeMajorTruncate =
          oldTrimmedLength > 240 &&
          newTrimmedLength < Math.max(120, Math.floor(oldTrimmedLength * 0.2));

        if (looksLikeMajorTruncate) {
          return {
            success: false,
            error:
              "Refusing to heavily truncate documentation without explicit user request."
          };
        }
      }

      const changeSummary = this._summarizeLineChanges(oldContent, newContent);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, newContent, "utf8");

      const relativePath = workspaceRoot
        ? path.relative(workspaceRoot, fullPath)
        : fullPath;

      if (workspaceRoot && !outsideWorkspace) {
        this.codebaseContext.set(relativePath, {
          content: newContent,
          fullPath,
          fileName: path.basename(relativePath).toLowerCase(),
          directory: path.dirname(relativePath).toLowerCase()
        });
      }

      return {
        success: true,
        path: fullPath,
        relativePath,
        created,
        changeSummary: changeSummary.summary,
        changed: changeSummary.changed,
        syntaxCheckCmd: this._getSyntaxCheckCommand(
          relativePath.replace(/\\/g, "/")
        )
      };
    } catch (error) {
      // Let error handler diagnose
      throw error;
    }
  }

  async createFolder(folderPath, allowOutsideWorkspace = false) {
    const context = {
      type: "mkdir",
      filePath: folderPath,
      allowOutsideWorkspace
    };
    
    // Use self-diagnosing retry
    return await this.errorHandler.retryWithAutoFix(
      async (ctx) => this._createFolderInternal(ctx),
      context,
      3
    );
  }
  
  async _createFolderInternal(context) {
    const { filePath: folderPath, allowOutsideWorkspace } = context;
    
    try {
      const normalizedFolderPath = (folderPath || "").replace(/\\/g, "/").trim();
      let targetPath = normalizedFolderPath;

      // If model gives MKDIR for a file path (e.g., "src/app.js"), use parent directory.
      if (path.extname(normalizedFolderPath)) {
        targetPath = path.dirname(normalizedFolderPath);
      }

      const { fullPath, outsideWorkspace } = this._resolveWorkspacePath(targetPath);
      
      // If outside workspace and not explicitly allowed, return error for chat panel to handle
      if (outsideWorkspace && !allowOutsideWorkspace) {
        return { success: false, error: "outside_workspace", path: fullPath };
      }
      if (!fullPath) {
        return { success: false, error: "Invalid folder path" };
      }

      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
          return { success: true, path: path.dirname(fullPath), skipped: true };
        }
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }

      await fs.mkdir(fullPath, { recursive: true });
      return { success: true, path: fullPath, skipped: false };
    } catch (error) {
      // Let error handler diagnose
      throw error;
    }
  }

  async executeCommand(command, workspaceFolder) {
    const validation = this.validateCommand(command);
    if (!validation.allowed) {
      // Log blocked command to performance monitor
      if (global.performanceMonitor) {
        global.performanceMonitor.recordIssue("blocked_command", {
          command,
          reason: validation.reason,
          workspace: workspaceFolder
        });
      }
      return { success: false, error: validation.reason };
    }

    return new Promise((resolve) => {
      const { exec } = require("child_process");
      exec(
        command,
        { cwd: workspaceFolder, maxBuffer: MAX_COMMAND_BUFFER_BYTES },
        (error, stdout, stderr) => {
          const rawOutput = [stdout, stderr].filter(Boolean).join("\n");
          const outputInfo = this._truncateCommandOutput(rawOutput);
          const hitMaxBuffer =
            !!error &&
            ((error.code || "").toString() === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
              /maxbuffer/i.test(error.message || ""));

          if (hitMaxBuffer) {
            if (global.performanceMonitor) {
              global.performanceMonitor.recordIssue("command_error", {
                command,
                error: "Buffer limit exceeded"
              });
            }
            resolve({
              success: false,
              error:
                "Command output exceeded the buffer limit. Output has been truncated.",
              output: outputInfo.text,
              outputTruncated: true
            });
            return;
          }

          if (error) {
            if (global.performanceMonitor) {
              global.performanceMonitor.recordIssue("command_error", {
                command,
                error: error.message
              });
            }
            resolve({
              success: false,
              error: error.message,
              output: outputInfo.text,
              outputTruncated: outputInfo.truncated
            });
            return;
          }

          resolve({
            success: true,
            output: outputInfo.text,
            outputTruncated: outputInfo.truncated
          });
        }
      );
    });
  }

  _truncateCommandOutput(rawOutput) {
    const text = typeof rawOutput === "string" ? rawOutput : "";
    if (text.length <= MAX_COMMAND_OUTPUT_CHARS) {
      return { text, truncated: false };
    }

    const truncatedText =
      text.slice(0, MAX_COMMAND_OUTPUT_CHARS) +
      `\n...[output truncated to ${MAX_COMMAND_OUTPUT_CHARS} characters]`;
    return { text: truncatedText, truncated: true };
  }

  async fetchFromWeb(url, options = {}) {
    const maxSize = options.maxSize || 500_000;
    const timeout = options.timeout || 10_000;

    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
      headers: {
        "User-Agent": "Code-Janitor/1.0 (+VS Code Extension)",
        Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const data = await response.text();
      return {
        success: true,
        data,
        size: Buffer.byteLength(data),
        contentType: response.headers.get("content-type") || "",
        finalUrl: response.url,
        redirected: response.url !== url
      };
    }

    const chunks = [];
    let size = 0;

    let streamDone = false;
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }

      size += value.byteLength;
      if (size > maxSize) {
        try {
          reader.cancel();
        } catch (_) {
          // Ignore cancel failures after size limit is exceeded.
        }
        throw new Error(`Response too large (>${maxSize} bytes)`);
      }

      chunks.push(Buffer.from(value));
    }

    const buffer = Buffer.concat(chunks);
    return {
      success: true,
      data: buffer.toString("utf8"),
      size,
      contentType: response.headers.get("content-type") || "",
      finalUrl: response.url,
      redirected: response.url !== url
    };
  }

  async _buildFetchedWebContext(userMessage, reportStatus) {
    const urls = extractUrls(userMessage, MAX_FETCHED_URLS);
    if (urls.length === 0) {
      return "";
    }

    reportStatus?.(
      urls.length === 1
        ? `Fetching referenced link: ${urls[0]}`
        : `Fetching ${urls.length} referenced links...`
    );

    const sections = [
      "[SYSTEM: The user provided web links. Use the fetched content below when answering. If the page fetch succeeded, analyze the content directly instead of saying you cannot access the link.]"
    ];

    for (const url of urls) {
      try {
        const fetchResult = await this.fetchFromWeb(url, {
          maxSize: 750_000,
          timeout: 15_000
        });
        const readable = extractReadableContent(
          fetchResult.data,
          fetchResult.contentType,
          MAX_FETCHED_CONTENT_CHARS
        );

        sections.push(
          [
            `URL: ${fetchResult.finalUrl || url}`,
            fetchResult.redirected && fetchResult.finalUrl
              ? `Redirected from: ${url}`
              : "",
            fetchResult.contentType
              ? `Content-Type: ${fetchResult.contentType}`
              : "",
            readable.title ? `Title: ${readable.title}` : "",
            "Fetched content:",
            readable.text || "[No readable text extracted]"
          ]
            .filter(Boolean)
            .join("\n")
        );
      } catch (error) {
        sections.push(`URL: ${url}\nFetch error: ${error.message}`);
      }
    }

    return sections.join("\n\n");
  }

  clearHistory() {
    const session = this._touchCurrentSession();
    session.history = [];
    session.summary = "";
    session.compactedCount = 0;
    this._syncCurrentSessionReferences();
    this._persistChatState();
  }
}

module.exports = AIAgent;
