const vscode = require("vscode");
const fs = require("fs").promises;
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const AIAgent = require("./agent");
const {
  buildGStackEditGateOverlay,
  buildGStackHelpText,
  parseGStackCommand
} = require("./gstack");
const { formatFetchedPreview } = require("./web-content-utils");
const PerformanceMonitor = require("../self-healing/performance-monitor");
const { buildFixInsights } = require("../core/fix-insights");
const FrontendValidator = require("../core/frontend-validator");
const { computeMinimalReplacement } = require("../utils/minimal-diff");
const GSTACK_GATE_MAX_FILE_REVIEW_CHARS = 2200;
const MAX_AGENTIC_INSPECTION_ROUNDS = 2;
const MAX_INSPECTION_RESULT_CHARS = 16000;
const MAX_INSPECTION_MATCHES = 25;

const MODELS_BY_PROVIDER = {
  groq: ["llama-3.1-8b-instant","llama-3.1-70b-versatile","llama3-8b-8192","llama3-70b-8192","mixtral-8x7b-32768","gemma2-9b-it"],
  openrouter: ["qwen/qwen-2.5-coder-32b-instruct","qwen/qwen3-coder:free","qwen/qwen3-coder","qwen/qwen3-32b","qwen/qwen3-14b","qwen/qwen3-8b","qwen/qwq-32b","qwen/qwen2.5-coder-7b-instruct","qwen/qwen-2.5-72b-instruct","deepseek/deepseek-r1-distill-qwen-32b","meta-llama/llama-3.3-70b-instruct","meta-llama/llama-3.1-8b-instruct:free","google/gemini-2.0-flash-exp:free","mistralai/mistral-7b-instruct:free"],
  anthropic: ["claude-opus-4-5","claude-sonnet-4-5","claude-3-5-sonnet-20241022","claude-3-5-haiku-20241022","claude-3-opus-20240229"],
  nvidia: ["meta/llama-3.1-8b-instruct","nvidia/nvidia-nemotron-nano-9b-v2","minimaxai/minimax-m2.7","mistralai/mistral-nemotron","meta/llama-3.1-70b-instruct","nvidia/llama-3.3-nemotron-super-49b-v1.5"]
};
const OLLAMA_FALLBACK_MODELS = [
  "qwen2.5-coder:7b",
  "qwen2.5-coder:3b",
  "qwen2.5-coder:1.5b",
  "codellama:latest",
  "llama3:latest"
];
const BUILT_IN_PROVIDERS = new Set(["ollama", "groq", "openrouter", "anthropic", "nvidia"]);

class ChatPanel {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.sidebarView = null;
    this.agent = new AIAgent(context);
    this.performanceMonitor = new PerformanceMonitor(context);
    this.abortController = null;
    this.lastActiveEditor = vscode.window.activeTextEditor || null;
    this.chatMode = "fast";
    this.showThinking = !!this.context.globalState.get(
      "codeJanitor.ai.showThinking",
      false
    );
    this._confirmResolve = null;
    this._boundWebviews = new WeakSet();
    this._queuedModeOverride = null;
    this._userStoppedGeneration = false;
    this._undoStack = [];
    this._undoIdCounter = 0;

    this.agent.setActiveEditor(this.lastActiveEditor);
    this.agent.showThinking = this.showThinking;
    this.performanceMonitor.onStateChange = () => {
      this._postAutoHealState();
    };
    this.performanceMonitor.loadMetrics();
    
    // Expose performance monitor globally for agent to log issues
    global.performanceMonitor = this.performanceMonitor;

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === "file") this.lastActiveEditor = editor;
    }, null, context.subscriptions);
  }

  async _setThinkingMode(enabled) {
    this.showThinking = !!enabled;
    this.agent.showThinking = this.showThinking;
    await this.context.globalState.update(
      "codeJanitor.ai.showThinking",
      this.showThinking
    );
    this._postMessage({
      type: "thinkingState",
      enabled: this.showThinking
    });
  }

  _shouldSuppressInternalStatus(text) {
    const value = String(text || "");
    return (
      /replied with prose/i.test(value) ||
      /model output looked incomplete/i.test(value) ||
      /structured edits still looked incomplete/i.test(value) ||
      /retrying with strict edit format/i.test(value) ||
      /retrying with file-only format/i.test(value)
    );
  }

  _shouldSuppressGStackGateStatus(text) {
    const value = String(text || "");
    return (
      this._shouldSuppressInternalStatus(value) ||
      /fetching\s+\d+\s+referenced links/i.test(value) ||
      /scanning\s+(active files|workspace)/i.test(value) ||
      /contacting\s+[a-z0-9._:/ -]+/i.test(value) ||
      /studying workspace before responding/i.test(value) ||
      /active file in focus:/i.test(value) ||
      /relevant files:/i.test(value)
    );
  }

  _queueModeOverride(mode) {
    this._queuedModeOverride = mode || null;
  }

  _getRequestMode() {
    return this._queuedModeOverride || this.chatMode || "fast";
  }

  _consumeQueuedModeOverride() {
    const queued = this._queuedModeOverride || null;
    this._queuedModeOverride = null;
    return queued;
  }

  _getInteractionStyleForRequest(isEditLikeIntent) {
    return isEditLikeIntent ? "agent_loop" : undefined;
  }

  _findStructuredActionStart(text) {
    const value = String(text || "");
    const match = /(^|\n)(FILE|PATCH|READ|GREP|MKDIR|CMD|GRAPHIFY|LINT|VALIDATE|PREVIEW|PERFORMANCE|FETCH|YOUTUBE)\s*:/i.exec(
      value
    );
    if (!match) {
      return -1;
    }
    return match.index + (match[1] ? match[1].length : 0);
  }

  _createStreamDisplayController(options = {}) {
    let bufferedText = "";
    let emittedContent = false;
    let visibleText = "";

    const emit = (text, options = {}) => {
      const value = String(text || "");
      if (!value) {
        return;
      }
      emittedContent = true;
      visibleText += value;
      const message = { type: "stream", text: value };
      if (typeof options.rawText === "string") {
        message.rawText = options.rawText;
      }
      this._postMessage(message);
    };

    const replace = (text, options = {}) => {
      const value = String(text || "");
      if (!value) {
        return;
      }
      emittedContent = true;
      visibleText = value;
      const message = { type: "streamReplace", text: value };
      if (typeof options.rawText === "string") {
        message.rawText = options.rawText;
      }
      this._postMessage(message);
    };

    return {
      push: (chunk) => {
        const value = String(chunk || "");
        if (!value) {
          return;
        }
        bufferedText += value;
        emit(value);
      },
      ensureFinalTextVisible: (text, options = {}) => {
        const rawText =
          typeof options.rawText === "string" ? options.rawText : "";
        const value = String(text || "").trim() ? String(text || "") : rawText;
        if (!value.trim()) {
          return;
        }
        const finalRawText = rawText || value;
        const alreadyBufferedFinalText =
          !!bufferedText &&
          (bufferedText === value || bufferedText === finalRawText);
        if (!emittedContent) {
          emit(value);
          return;
        }
        if (alreadyBufferedFinalText) {
          return;
        }
        if (value !== visibleText) {
          replace(value);
        }
      },
      hasEmittedContent: () => emittedContent
    };
  }

  _stripStructuredActionsFromText(text) {
    let cleaned = String(text || "");

    if (!cleaned.trim()) {
      return "";
    }

    const blockPatterns = [
      /PATCH:\s*[^\r\n`]+\r?\nSEARCH:\s*\r?\n```[\w-]*\r?\n?[\s\S]*?```\s*\r?\nREPLACE:\s*\r?\n```[\w-]*\r?\n?[\s\S]*?```/gi,
      /FILE:\s*[^\r\n`]+\r?\n```[\w-]*\r?\n?[\s\S]*?```/gi
    ];

    for (const pattern of blockPatterns) {
      cleaned = cleaned.replace(pattern, "");
    }

    const linePatterns = [
      /^\s*(READ|GREP)\s*:\s*.+$/gim,
      /^\s*(CMD|MKDIR)\s*:\s*.+$/gim,
      /^\s*GRAPHIFY\s*:\s*open\s*$/gim,
      /^\s*LINT\s*:\s*active\s*$/gim,
      /^\s*VALIDATE\s*:\s*frontend\s*$/gim,
      /^\s*PREVIEW\s*:\s*(open|inspect)\s*$/gim,
      /^\s*PERFORMANCE\s*:\s*show\s*$/gim,
      /^\s*FETCH\s*:\s*https?:\/\/\S+\s*$/gim
    ];

    for (const pattern of linePatterns) {
      cleaned = cleaned.replace(pattern, "");
    }

    // If any structured-action token remains after removing complete blocks,
    // treat it as an incomplete trailing action and hide it from the chat bubble.
    const trailingStructuredStart = this._findStructuredActionStart(cleaned);
    if (trailingStructuredStart !== -1) {
      cleaned = cleaned.slice(0, trailingStructuredStart);
    }

    return cleaned
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  _buildStructuredActionDisplaySummary(actions = []) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return "";
    }

    const counts = {
      patch: 0,
      file: 0,
      read: 0,
      grep: 0,
      mkdir: 0,
      cmd: 0,
      other: 0
    };

    for (const action of actions) {
      if (!action || !action.type) continue;
      if (Object.prototype.hasOwnProperty.call(counts, action.type)) {
        counts[action.type] += 1;
      } else {
        counts.other += 1;
      }
    }

    const parts = [];
    if (counts.patch) {
      parts.push(`${counts.patch} patch${counts.patch === 1 ? "" : "es"}`);
    }
    if (counts.file) {
      parts.push(`${counts.file} file update${counts.file === 1 ? "" : "s"}`);
    }
    if (counts.read) {
      parts.push(`${counts.read} file read${counts.read === 1 ? "" : "s"}`);
    }
    if (counts.grep) {
      parts.push(`${counts.grep} workspace search${counts.grep === 1 ? "" : "es"}`);
    }
    if (counts.mkdir) {
      parts.push(`${counts.mkdir} folder change${counts.mkdir === 1 ? "" : "s"}`);
    }
    if (counts.cmd) {
      parts.push(`${counts.cmd} command${counts.cmd === 1 ? "" : "s"}`);
    }
    if (counts.other) {
      parts.push(`${counts.other} action${counts.other === 1 ? "" : "s"}`);
    }

    if (parts.length === 0) {
      return "";
    }

    const lines = ["Model prepared executable changes."];
    const previewableActions = actions
      .filter((action) => action && action.type)
      .slice(0, 4);

    for (const action of previewableActions) {
      if (action.type === "patch") {
        lines.push(`- Patch ${action.path || "the active file"}`);
      } else if (action.type === "file") {
        lines.push(`- Update ${action.path || "a file"}`);
      } else if (action.type === "read") {
        lines.push(`- Read ${action.path || "a file"}`);
      } else if (action.type === "grep") {
        lines.push(`- Search ${action.query || "the workspace"}`);
      } else if (action.type === "mkdir") {
        lines.push(`- Create folder ${action.path || "(unnamed)"}`);
      } else if (action.type === "cmd") {
        lines.push(`- Run ${action.command || "a command"}`);
      } else {
        lines.push(`- ${action.type} action`);
      }
    }

    if (actions.length > previewableActions.length) {
      const remaining = actions.length - previewableActions.length;
      lines.push(`- ${remaining} more action${remaining === 1 ? "" : "s"}`);
    }

    lines.push(`Applying ${parts.join(", ")} now.`);
    return lines.join("\n");
  }

  _buildVisibleAssistantText(response, options = {}) {
    return String(response?.text || "");
  }

  _postAssistantImages(images = []) {
    const safeImages = Array.isArray(images)
      ? images.filter((url) => typeof url === "string" && /^data:image\//i.test(url))
      : [];
    if (safeImages.length === 0) {
      return;
    }
    this._postMessage({
      type: "assistantImages",
      images: safeImages
    });
  }

  _buildInterruptedStreamMessage(error) {
    if (error?.name === "AbortError") {
      return "Code Janitor hid a partial response because generation stopped before completion. Retry with a faster model or increase the timeout in settings.";
    }

    return "Code Janitor hid a partial response because the AI stream ended before completion. Retry the request to get a complete answer.";
  }

  _handleChatStreamFailure(error, streamController) {
    const userStopped = this._userStoppedGeneration === true;
    this._userStoppedGeneration = false;

    if (userStopped) {
      return { suppressed: true };
    }

    const errorMsg =
      error?.name === "AbortError"
        ? "Generation stopped or timed out. Try a faster model or increase timeout in settings."
        : `AI error: ${error.message}`;

    this._postMessage({ type: "error", text: errorMsg });
    this._postMessage({ type: "done" });
    return { suppressed: false, errorMsg };
  }

  _resolveGStackRequest(message) {
    return parseGStackCommand(message);
  }

  async runBugScan(editor) {
    // If the chat is already open in the sidebar, do NOT create a separate
    // webview panel — that would split the trigger to a panel the user
    // isn't looking at. Only call show() (which creates a panel) when no
    // sidebar view is bound yet.
    if (!this.sidebarView?.webview) {
      await this.show();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));

    const targetWebview =
      this.sidebarView?.webview || this.panel?.webview || null;

    if (!editor || !editor.document) {
      if (targetWebview) {
        targetWebview.postMessage({
          type: "stream",
          text: "⚠️ No active file detected. Open a file and try again."
        });
        targetWebview.postMessage({ type: "done" });
      } else {
        vscode.window.showInformationMessage(
          "Code Janitor: No active file detected. Open a file and try again."
        );
      }
      return;
    }

    this._queueModeOverride("bugfix");
    this.lastActiveEditor = editor;

    const filePath = editor.document.fileName;
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).slice(1) || "";
    const fullText = editor.document.getText();
    const truncated = fullText.length > 30000;
    const bodyText = truncated ? fullText.slice(0, 30000) : fullText;

    const triggerMessage = [
      "Alt+B bug scan triggered. Run the bug fix loop on the file below (active file only).",
      `File: ${fileName}`,
      truncated ? "(File truncated to first 30000 characters.)" : "",
      "",
      "```" + ext,
      bodyText,
      "```"
    ]
      .filter(Boolean)
      .join("\n");

    if (targetWebview) {
      targetWebview.postMessage({ type: "prefillAndSend", message: triggerMessage });
    } else {
      vscode.window.showWarningMessage(
        "Code Janitor: chat view is not ready. Open the Code Janitor sidebar and press Alt+B again."
      );
    }
  }

  async _appendAuditRefusalLog(workspaceFolder, userMessage, modelResponse) {
    if (!workspaceFolder) {
      this._postMessage({
        type: "status",
        text: "Audit refusal not logged: no workspace folder is open."
      });
      return;
    }
    try {
      const logPath = path.join(workspaceFolder, ".janitor-audit-log");
      const entry = [
        `--- ${new Date().toISOString()} ---`,
        `User request: ${(userMessage || "").slice(0, 500)}`,
        "",
        modelResponse.trim(),
        "",
        ""
      ].join("\n");
      await fs.appendFile(logPath, entry, "utf8");
      this._postMessage({
        type: "status",
        text: "Audit refusal logged to .janitor-audit-log"
      });
    } catch (err) {
      this._postMessage({
        type: "status",
        text: `Audit refusal log write failed: ${err.message}`
      });
    }
  }

  // Push a recently-applied edit onto the undo stack and return an id the
  // webview can use to trigger a revert. Returns null if there is nothing
  // worth undoing (no real change, or no before-snapshot available).
  _registerEditForUndo({ filePath, before, after, label }) {
    if (typeof before !== "string" || typeof after !== "string") return null;
    if (before === after) return null;
    const sessionId = this._getCurrentChatSessionId();
    const id = `undo-${++this._undoIdCounter}-${Date.now()}`;
    this._undoStack.push({
      id,
      sessionId: sessionId || null,
      filePath: String(filePath || ""),
      before,
      after,
      label: label || "edit",
      ts: Date.now()
    });
    // Bound the stack so a long session does not retain unbounded buffers
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._postUndoState();
    return id;
  }

  _getCurrentChatSessionId() {
    return this.agent?.getSessionState?.().currentSessionId || null;
  }

  _getLatestUndoEntry(targetSessionId = this._getCurrentChatSessionId()) {
    for (let idx = this._undoStack.length - 1; idx >= 0; idx -= 1) {
      const entry = this._undoStack[idx];
      if (
        !targetSessionId ||
        !entry?.sessionId ||
        entry.sessionId === targetSessionId
      ) {
        return { entry, idx };
      }
    }
    return { entry: null, idx: -1 };
  }

  _discardUndoEntriesForSession(sessionId) {
    if (!sessionId) return;
    this._undoStack = this._undoStack.filter(
      (entry) => !entry?.sessionId || entry.sessionId !== sessionId
    );
  }

  _findEditorForFile(filePath) {
    if (!filePath) return null;
    const target = String(filePath).replace(/\\/g, "/").toLowerCase();
    for (const editor of vscode.window.visibleTextEditors || []) {
      const docPath = editor?.document?.uri?.fsPath || editor?.document?.fileName || "";
      const norm = String(docPath).replace(/\\/g, "/").toLowerCase();
      if (norm === target) return editor;
    }
    return null;
  }

  // Revert the matching entry (by id) or the most recent edit (when id is
  // omitted). On success, the entry is removed from the stack. On failure,
  // it is restored so the user can retry.
  async _undoEdit(id) {
    const currentSessionId = this._getCurrentChatSessionId();
    const latestForSession = this._getLatestUndoEntry(currentSessionId);
    if (this._undoStack.length === 0 || (!id && !latestForSession.entry)) {
      this._postUndoState();
      this._postMessage({
        type: "status",
        text: currentSessionId
          ? "Nothing to undo in this chat."
          : "Nothing to undo."
      });
      return { success: false, error: "empty_stack" };
    }

    let idx = -1;
    if (id) {
      idx = this._undoStack.findIndex((e) => e.id === id);
      if (idx < 0) {
        const sessionEntries = this._undoStack.filter(
          (entry) =>
            !currentSessionId ||
            !entry?.sessionId ||
            entry.sessionId === currentSessionId
        );
        if (sessionEntries.length === 1 && latestForSession.idx >= 0) {
          idx = latestForSession.idx;
        } else {
          this._postUndoState();
          this._postMessage({
            type: "status",
            text: "That edit has already been undone."
          });
          return { success: false, error: "not_found" };
        }
      }
    } else {
      idx = latestForSession.idx;
    }

    const entry = this._undoStack.splice(idx, 1)[0];
    const baseName = entry.filePath ? path.basename(entry.filePath) : "file";

    let result;
    const editor = this._findEditorForFile(entry.filePath);
    if (editor) {
      result = await this._applyToEditor(editor, entry.before);
    } else {
      result = await this.agent.applyChanges(
        entry.filePath,
        entry.before,
        true,
        { allowEmpty: true, allowDocTruncate: true }
      );
    }

    if (result && result.success) {
      this._postUndoState();
      this._postMessage({
        type: "editUndone",
        id: entry.id
      });
      this._postMessage({
        type: "applied",
        filePath: result.path || entry.filePath,
        text: `↶ Undid edit to ${baseName}`
      });
      return { success: true };
    }

    // Restore the entry so the user can retry the undo.
    this._undoStack.splice(idx, 0, entry);
    this._postUndoState();
    this._postMessage({
      type: "error",
      text: `Undo failed for ${baseName}: ${result?.error || "unknown error"}`
    });
    return { success: false, error: result?.error || "unknown" };
  }

  // Detect a user typing a free-form undo request such as "undo that",
  // "revert the last edit", "undo last change". /undo handled separately.
  _isUndoRequest(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return false;
    if (/^undo\b/.test(t)) return true;
    if (/^(revert|rollback|roll back|take back|take that back)\b/.test(t)) return true;
    if (/\b(undo|revert|rollback|roll back)\b.*\b(that|last|previous|recent|edit|change|fix|patch|rectif)/.test(t)) return true;
    return false;
  }

  async show() {
    try {
      console.log("[ChatPanel] show() called");
      this.lastActiveEditor = vscode.window.activeTextEditor || this.lastActiveEditor;
      this.agent.setActiveEditor(this.lastActiveEditor);

      if (this.panel) {
        console.log("[ChatPanel] Panel already exists, revealing");
        this.panel.reveal();
        return;
      }

      console.log("[ChatPanel] Creating new panel");
      // CRITICAL FIX: Force provider to ollama if no API keys are configured
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const currentProvider = this._getSelectedProviderId() || cfg.get("provider", "ollama");
    const groqKey = cfg.get("groqApiKey", "");
    const openrouterKey = cfg.get("openrouterApiKey", "");
    const anthropicKey = cfg.get("anthropicApiKey", "");
    const nvidiaKey = cfg.get("nvidiaApiKey", "");

    // If using a cloud provider but no API key is set, force to ollama
    if (currentProvider === "groq" && !groqKey) {
      console.log("[ChatPanel] No Groq API key found, forcing provider to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
    } else if (currentProvider === "openrouter" && !openrouterKey) {
      console.log("[ChatPanel] No OpenRouter API key found, forcing provider to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
    } else if (currentProvider === "anthropic" && !anthropicKey) {
      console.log("[ChatPanel] No Anthropic API key found, forcing provider to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
    } else if (currentProvider === "nvidia" && !nvidiaKey) {
      console.log("[ChatPanel] No NVIDIA API key found, forcing provider to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
    }

    // Show setup guide on first ever open
    const hasSeenSetup = this.context.globalState.get("codeJanitor.seenSetup", false);
    if (!hasSeenSetup) {
      this.context.globalState.update("codeJanitor.seenSetup", true);
      vscode.window.showInformationMessage(
        "New to Code Janitor? Check the setup guide to configure AI models and API keys.",
        "Open Setup Guide"
      ).then(selection => {
        if (selection === "Open Setup Guide") {
          vscode.env.openExternal(vscode.Uri.parse("https://code-janitor-web.vercel.app"));
        }
      });
    }

    console.log("[ChatPanel] Creating webview panel");
    this.panel = vscode.window.createWebviewPanel(
      "codeJanitorChat",
      "Code Janitor AI",
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this._attachWebviewHost(this.panel, { kind: "panel" });
    
    console.log("[ChatPanel] Setting up dispose handler");
    this.panel.onDidDispose(() => { 
      console.log("[ChatPanel] Panel disposed");
      this.panel = null; 
    });
    
    console.log("[ChatPanel] Panel created successfully");
    } catch (error) {
      console.error("[ChatPanel] CRITICAL ERROR in show():", error);
      console.error("[ChatPanel] Error stack:", error.stack);
      vscode.window.showErrorMessage(`Failed to open AI Chat: ${error.message}`);
      throw error;
    }
  }

  async _runSyntaxScan(workspaceFolder, specificFiles) {
    if (!workspaceFolder) {
      this._postMessage({ type: "status", text: "No workspace open." });
      return;
    }
    this._postMessage({ type: "thinking" });
    await this.agent.ensureCodebaseScanned(workspaceFolder);
    const files = specificFiles || Array.from(this.agent.codebaseContext.keys()).filter(f =>
      /\.(js|jsx|ts|tsx|py|java)$/i.test(f)
    );
    let reply = `Scanning ${files.length} file(s) for syntax errors...\n`;
    this._postMessage({ type: "stream", text: reply });
    let errorCount = 0;
    const dirtyOpen = new Map();
    for (const editor of vscode.window.visibleTextEditors || []) {
      const doc = editor.document;
      if (!doc || doc.uri.scheme !== "file" || !doc.isDirty) continue;
      const rel = path.relative(workspaceFolder, doc.fileName).replace(/\\/g, "/");
      if (rel) dirtyOpen.set(rel, doc);
    }
    for (const f of files) {
      const normalized = f.replace(/\\/g, "/");
      let result = null;
      let tempPath = "";
      const dirtyDoc = dirtyOpen.get(normalized);
      const shouldUseTemp = !!dirtyDoc;

      if (shouldUseTemp) {
        const ext = path.extname(dirtyDoc.fileName);
        const tmpName = `code-janitor-scan-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
        tempPath = path.join(os.tmpdir(), tmpName);
        try {
          fsSync.writeFileSync(tempPath, dirtyDoc.getText(), "utf8");
          const cmd = this.agent._getSyntaxCheckCommand(tempPath.replace(/\\/g, "/"));
          result = cmd ? await this.agent.executeCommand(cmd, workspaceFolder) : null;
          if (result && result.success) {
            result = { success: true };
          } else if (result) {
            result = {
              success: false,
              error: result.error || result.output || "Syntax check failed",
              output: result.output || result.error || ""
            };
          }
        } finally {
          if (tempPath) {
            try { fsSync.unlinkSync(tempPath); } catch (_) {}
          }
        }
      } else {
        result = await this.agent._runSyntaxCheck(normalized, workspaceFolder, null);
      }

      if (!result) {
        // File type not supported for syntax checking
        continue;
      }
      if (result.skipped) {
        // C/C++ files that need manual checking
        const msg = `\n\u26a0\ufe0f ${normalized}: ${result.output}`;
        this._postMessage({ type: "stream", text: msg });
        reply += msg;
        continue;
      }
      if (!result.success) {
        // Syntax error found
        const errorMsg = result.error || result.output || "Unknown syntax error";
        const msg = `\n\u274c ${normalized}:\n${errorMsg}`;
        this._postMessage({ type: "stream", text: msg });
        reply += msg;
        errorCount++;
      }
    }
    const summary = errorCount > 0 
      ? `\n\n\u274c Found ${errorCount} file(s) with syntax errors.` 
      : "\n\n\u2705 No syntax errors found.";
    this._postMessage({ type: "stream", text: summary });
    this._postMessage({ type: "done" });
  }

  async _runLibraryAudit(workspaceFolder) {
    if (!workspaceFolder) {
      this._postMessage({
        type: "error",
        text: "Open a workspace first so imports and installed libraries can be audited."
      });
      this._postMessage({ type: "done" });
      return;
    }

    this._postMessage({ type: "thinking" });
    this._postMessage({
      type: "status",
      text: "Auditing libraries across all supported languages..."
    });

    const importMap = await this._collectLibraryImports(workspaceFolder);
    const importsByLanguage = new Map();
    
    for (const [filePath, imports] of importMap.entries()) {
      const ext = path.extname(filePath).toLowerCase();
      let lang = "unknown";
      if ([".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".ino", ".pde"].includes(ext)) lang = "C/C++";
      else if (ext === ".py") lang = "Python";
      else if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) lang = "JavaScript/TypeScript";
      else if (ext === ".java") lang = "Java";
      else if (ext === ".go") lang = "Go";
      else if (ext === ".rs") lang = "Rust";
      else if (ext === ".rb") lang = "Ruby";
      else if (ext === ".php") lang = "PHP";
      
      if (!importsByLanguage.has(lang)) importsByLanguage.set(lang, new Set());
      imports.forEach(imp => importsByLanguage.get(lang).add(imp));
    }

    if (importsByLanguage.size === 0) {
      this._postMessage({
        type: "stream",
        text: "No library imports found in supported languages."
      });
      this._postMessage({ type: "done" });
      return;
    }

    let report = "Library Audit Report\n\n";
    report += `Languages detected: ${Array.from(importsByLanguage.keys()).join(", ")}\n\n`;

    // Check C/C++ libraries with arduino-cli
    if (importsByLanguage.has("C/C++")) {
      const importedHeaders = importsByLanguage.get("C/C++");
      report += "=== C/C++/Arduino Libraries ===\n";
      report += `Imported headers: ${importedHeaders.size}\n\n`;

      const installedResult = await this.agent.executeCommand("arduino-cli lib list --format json", workspaceFolder);
      if (!installedResult.success) {
        report += "Warning: Could not check installed Arduino libraries. Install arduino-cli to enable this check.\n\n";
      } else {

        const installedLibraries = this._parseInstalledLibraries(installedResult.output);
        const installedTokens = new Set(
          installedLibraries.map((name) => this._normalizeLibraryToken(name)).filter(Boolean)
        );

        const matched = [];
        const missing = [];
        const ignoredCore = [];

        for (const header of Array.from(importedHeaders).sort((a, b) => a.localeCompare(b))) {
          if (this._isCoreOrSystemHeader(header)) {
            ignoredCore.push(header);
            continue;
          }

          const baseName = path.basename(header).replace(/\.(h|hpp)$/i, "");
          const token = this._normalizeLibraryToken(baseName);
          const isInstalled = Array.from(installedTokens).some((installedToken) =>
            installedToken.includes(token) || token.includes(installedToken)
          );

          if (isInstalled) {
            matched.push(header);
          } else {
            missing.push(header);
          }
        }

        report += `Installed libraries: ${installedLibraries.length}\n`;
        report += `Matched imports: ${matched.length}\n`;
        report += `Missing imports: ${missing.length}\n`;

        if (matched.length > 0) {
          report += "\nMatched imports:\n";
          for (const header of matched.slice(0, 10)) report += `- ${header}\n`;
        }

        if (ignoredCore.length > 0) {
          report += "\nIgnored core/system headers:\n";
          for (const header of ignoredCore.slice(0, 10)) report += `- ${header}\n`;
        }

        if (missing.length === 0) {
          report += "\nAll C/C++ libraries are installed.\n\n";
        } else {

          report += "\nMissing C/C++ library candidates:\n";
          for (const header of missing.slice(0, 5)) {
            const baseName = path.basename(header).replace(/\.(h|hpp)$/i, "");
            report += `\n- ${header}\n`;
            report += `  Install: arduino-cli lib install "${baseName}"\n`;
            report += `  Search: arduino-cli lib search "${baseName}"\n`;
          }
          if (missing.length > 5) report += `\n... and ${missing.length - 5} more\n`;
          report += "\nArduino docs: https://support.arduino.cc/hc/en-us/articles/5145457742236\n\n";
        }
      }
    }

    // Check Python packages
    if (importsByLanguage.has("Python")) {
      const imports = importsByLanguage.get("Python");
      report += "=== Python Packages ===\n";
      report += `Imported modules: ${imports.size}\n`;
      const pipResult = await this.agent.executeCommand("pip list --format=json", workspaceFolder);
      if (pipResult.success) {
        try {
          const installed = JSON.parse(pipResult.output).map(p => p.name.toLowerCase());
          const missing = Array.from(imports).filter(m => !installed.includes(m.toLowerCase()));
          report += `Installed packages: ${installed.length}\n`;
          report += `Missing packages: ${missing.length}\n`;
          if (missing.length > 0) {
            report += "\nInstall missing packages:\n";
            for (const pkg of missing.slice(0, 10)) report += `  pip install ${pkg}\n`;
          } else {
            report += "All Python packages are installed.\n";
          }
        } catch (_) {
          report += "Warning: Could not parse pip output.\n";
        }
      } else {
        report += "Warning: Could not check installed packages. Run 'pip list' manually.\n";
      }
      report += "\n";
    }

    // Check Node.js packages
    if (importsByLanguage.has("JavaScript/TypeScript")) {
      const imports = importsByLanguage.get("JavaScript/TypeScript");
      report += "=== Node.js Packages ===\n";
      report += `Imported modules: ${imports.size}\n`;
      const pkgJsonPath = path.join(workspaceFolder, "package.json");
      if (fsSync.existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(fsSync.readFileSync(pkgJsonPath, "utf8"));
          const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
          const missing = Array.from(imports).filter(m => !deps[m]);
          report += `Declared in package.json: ${Object.keys(deps).length}\n`;
          report += `Missing from package.json: ${missing.length}\n`;
          if (missing.length > 0) {
            report += "\nAdd missing packages:\n";
            for (const pkg of missing.slice(0, 10)) report += `  npm install ${pkg}\n`;
          } else {
            report += "All imports are in package.json.\n";
          }
        } catch (_) {
          report += "Warning: Could not parse package.json.\n";
        }
      } else {
        report += "Warning: No package.json found.\n";
      }
      report += "\n";
    }

    // Check Java packages
    if (importsByLanguage.has("Java")) {
      const imports = importsByLanguage.get("Java");
      report += "=== Java Packages ===\n";
      report += `Imported packages: ${imports.size}\n`;
      report += `Top imports: ${Array.from(imports).slice(0, 10).join(", ")}\n`;
      report += "\nCheck Maven/Gradle dependencies manually.\n\n";
    }

    // Check Go modules
    if (importsByLanguage.has("Go")) {
      const imports = importsByLanguage.get("Go");
      report += "=== Go Modules ===\n";
      report += `Imported packages: ${imports.size}\n`;
      const goModPath = path.join(workspaceFolder, "go.mod");
      if (fsSync.existsSync(goModPath)) {
        report += "go.mod found. Run 'go mod tidy' to sync dependencies.\n";
      } else {
        report += "go.mod found. Run 'go mod tidy' to sync dependencies.\n";
      }
      report += "\n";
    }

    // Check Rust crates
    if (importsByLanguage.has("Rust")) {
      const imports = importsByLanguage.get("Rust");
      report += "=== Rust Crates ===\n";
      report += `Imported crates: ${imports.size}\n`;
      const cargoPath = path.join(workspaceFolder, "Cargo.toml");
      if (fsSync.existsSync(cargoPath)) {
        report += "Cargo.toml found. Run 'cargo build' to fetch dependencies.\n";
      } else {
        report += "Cargo.toml found. Run 'cargo build' to fetch dependencies.\n";
      }
      report += "\n";
    }

    // Check Ruby gems
    if (importsByLanguage.has("Ruby")) {
      const imports = importsByLanguage.get("Ruby");
      report += "=== Ruby Gems ===\n";
      report += `Required gems: ${imports.size}\n`;
      const gemfilePath = path.join(workspaceFolder, "Gemfile");
      if (fsSync.existsSync(gemfilePath)) {
        report += "Gemfile found. Run 'bundle install' to install gems.\n";
      } else {
        report += "Gemfile found. Run 'bundle install' to install gems.\n";
      }
      report += "\n";
    }

    // Check PHP packages
    if (importsByLanguage.has("PHP")) {
      const imports = importsByLanguage.get("PHP");
      report += "=== PHP Packages ===\n";
      report += `Imported namespaces: ${imports.size}\n`;
      const composerPath = path.join(workspaceFolder, "composer.json");
      if (fsSync.existsSync(composerPath)) {
        report += "composer.json found. Run 'composer install' to install packages.\n";
      } else {
        report += "composer.json found. Run 'composer install' to install packages.\n";
      }
      report += "\n";
    }

    this._postMessage({ type: "stream", text: report });
    this._postMessage({ type: "done" });
  }

  async _collectLibraryImports(workspaceFolder) {
    const files = await vscode.workspace.findFiles(
      "**/*.{ino,pde,h,hpp,c,cpp,cc,cxx,py,js,jsx,ts,tsx,java,go,rs,rb,php}",
      "**/{.git,node_modules,build,dist,out,.arduinoIDE,.pio,__pycache__,target,vendor}/**"
    );
    const imports = new Map();
    for (const uri of files) {
      if (uri.scheme !== "file") continue;
      const relativePath = path.relative(workspaceFolder, uri.fsPath).replace(/\\/g, "/");
      try {
        const content = await fs.readFile(uri.fsPath, "utf8");
        const ext = path.extname(uri.fsPath).toLowerCase();
        imports.set(relativePath, this._extractImports(content, ext));
      } catch (_) {
        // Ignore unreadable files so the audit can continue.
      }
    }
    return imports;
  }

  _extractImports(content, ext) {
    const imports = new Set();
    const text = content || "";
    
    if ([".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".ino", ".pde"].includes(ext)) {
      // C/C++/Arduino: #include <Library.h> or #include "Library.h"
      const includeRegex = /^\s*#include\s*[<"]([^">]+)[">]/gm;
      let match;
      while ((match = includeRegex.exec(text)) !== null) {
        const header = (match[1] || "").trim();
        if (header) imports.add(header);
      }
    } else if (ext === ".py") {
      // Python: import module, from module import x, import module as alias
      const importRegex = /^\s*(?:from\s+([\w.]+)\s+)?import\s+([\w.,\s*]+)/gm;
      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const fromModule = (match[1] || "").trim();
        const importedItems = (match[2] || "").trim();
        if (fromModule) imports.add(fromModule.split(".")[0]);
        if (importedItems && !fromModule) {
          importedItems.split(",").forEach(item => {
            const module = item.trim().split(/\s+as\s+/)[0].trim();
            if (module && module !== "*") imports.add(module);
          });
        }
      }
    } else if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
      // JavaScript/TypeScript: import x from 'module', require('module')
      const importRegex = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(['"]([^'"]+)['"]\))/g;
      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const module = (match[1] || match[2] || "").trim();
        if (module && !module.startsWith(".") && !module.startsWith("/")) {
          imports.add(module.split("/")[0]);
        }
      }
    } else if (ext === ".java") {
      // Java: import package.Class;
      const importRegex = /^\s*import\s+([\w.]+);/gm;
      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const pkg = (match[1] || "").trim();
        if (pkg && !pkg.startsWith("java.")) {
          imports.add(pkg.split(".")[0]);
        }
      }
    } else if (ext === ".go") {
      // Go: import "package" or import ("package1" "package2")
      const importRegex = /import\s+(?:\(([^)]+)\)|"([^"]+)")/g;
      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const block = match[1];
        const single = match[2];
        if (block) {
          block.split("\n").forEach(line => {
            const pkgMatch = line.match(/"([^"]+)"/);
            if (pkgMatch) imports.add(pkgMatch[1].split("/").pop());
          });
        } else if (single) {
          imports.add(single.split("/").pop());
        }
      }
    } else if (ext === ".rs") {
      // Rust: use crate::module or extern crate name
      const useRegex = /(?:use\s+([\w:]+)|extern\s+crate\s+(\w+))/g;
      let match;
      while ((match = useRegex.exec(text)) !== null) {
        const module = (match[1] || match[2] || "").trim();
        if (module) imports.add(module.split("::")[0]);
      }
    } else if (ext === ".rb") {
      // Ruby: require 'gem' or gem 'name'
      const requireRegex = /(?:require|gem)\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = requireRegex.exec(text)) !== null) {
        const gem = (match[1] || "").trim();
        if (gem) imports.add(gem.split("/")[0]);
      }
    } else if (ext === ".php") {
      // PHP: use Namespace\Class or require/include
      const useRegex = /(?:use\s+([\w\\]+)|(?:require|include)(?:_once)?\s*\(?['"]([^'"]+)['"])/g;
      let match;
      while ((match = useRegex.exec(text)) !== null) {
        const ns = (match[1] || match[2] || "").trim();
        if (ns) imports.add(ns.split("\\")[0].split("/")[0]);
      }
    }
    
    return Array.from(imports);
  }

  _parseInstalledLibraries(listOutput) {
    const names = new Set();
    const raw = (listOutput || "").trim();
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      const queue = Array.isArray(parsed) ? parsed.slice() : [parsed];
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;
        if (Array.isArray(item)) {
          queue.push(...item);
          continue;
        }
        if (typeof item === "object") {
          const candidateName =
            item.name ||
            item.library?.name ||
            item.Library?.Name ||
            item.Name;
          if (candidateName && typeof candidateName === "string") {
            names.add(candidateName.trim());
          }
          for (const value of Object.values(item)) {
            if (value && typeof value === "object") queue.push(value);
          }
        }
      }
    } catch (_) {
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || /^name\s+/i.test(trimmed) || /^[-=]{3,}/.test(trimmed)) continue;
        const columnSplit = trimmed.split(/\s{2,}/);
        const candidate = columnSplit[0]?.trim();
        if (candidate && !/^library$/i.test(candidate)) names.add(candidate);
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  _normalizeLibraryToken(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  _isCoreOrSystemHeader(header) {
    const normalized = String(header || "").trim().toLowerCase();
    const base = path.basename(normalized).replace(/\.(h|hpp)$/i, "");
    const coreHeaders = new Set([
      "arduino",
      "binary",
      "ctype",
      "errno",
      "float",
      "limits",
      "math",
      "new",
      "pgmspace",
      "pins_arduino",
      "stdbool",
      "stdint",
      "stdio",
      "stdlib",
      "stream",
      "string",
      "time",
      "utility",
      "vector",
      "wiring_private"
    ]);
    return (
      coreHeaders.has(base) ||
      normalized.startsWith("avr/") ||
      normalized.startsWith("sys/") ||
      normalized.startsWith("bits/")
    );
  }

  async _searchArduinoLibraryCandidates(workspaceFolder, term) {
    const safeTerm = String(term || "").replace(/"/g, "").trim();
    if (!safeTerm) return [];
    const searchCommand = `arduino-cli lib search "${safeTerm}" --format json`;
    const result = await this.agent.executeCommand(searchCommand, workspaceFolder);
    if (!result.success) return [];

    try {
      const parsed = JSON.parse(result.output || "{}");
      const items = Array.isArray(parsed?.libraries)
        ? parsed.libraries
        : Array.isArray(parsed)
          ? parsed
          : [];
      return items
        .map((entry) => entry?.name || entry?.library?.name || entry?.Name)
        .filter((name) => typeof name === "string" && name.trim().length > 0)
        .slice(0, 3);
    } catch (_) {
      return [];
    }
  }

  _looksLikeConfidentLibraryMatch(header, candidateName) {
    const baseName = path.basename(String(header || "")).replace(/\.(h|hpp)$/i, "");
    const headerToken = this._normalizeLibraryToken(baseName);
    const candidateToken = this._normalizeLibraryToken(candidateName || "");
    if (!headerToken || !candidateToken) return false;
    return candidateToken.includes(headerToken) || headerToken.includes(candidateToken);
  }

  async _fetchInternetLibraryGuidance(libraryOrHeader) {
    if (typeof fetch !== "function") return null;
    const baseName = path.basename(String(libraryOrHeader || "")).replace(/\.(h|hpp)$/i, "");
    if (!baseName) return null;
    const query = `Arduino IDE 2 install library ${baseName}`;
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    try {
      const timeoutSignal =
        typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(12000)
          : undefined;
      const response = await fetch(url, {
        headers: { "User-Agent": "Code-Janitor/1.0" },
        signal: timeoutSignal
      });
      if (!response.ok) return null;
      const data = await response.json();
      const summary = (data?.AbstractText || "").trim();
      const sourceUrl = (data?.AbstractURL || "").trim();
      const related = [];
      const collectRelated = (items) => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (!item) continue;
          if (Array.isArray(item.Topics)) {
            collectRelated(item.Topics);
            continue;
          }
          const text = (item.Text || "").trim();
          const link = (item.FirstURL || "").trim();
          if (text && link) related.push({ text, link });
          if (related.length >= 3) return;
        }
      };
      collectRelated(data?.RelatedTopics);
      if (!summary && !sourceUrl && related.length === 0) return null;
      return { summary, sourceUrl, related };
    } catch (_) {
      return null;
    }
  }


  _getEffectiveWorkspaceFolder() {
    const activeEditor = this._getCurrentFileEditor() || vscode.window.activeTextEditor;
    if (activeEditor?.document?.uri?.scheme === "file") {
      const activeFilePath = activeEditor.document.fileName;
      const activeWorkspace = vscode.workspace.getWorkspaceFolder?.(
        activeEditor.document.uri
      )?.uri?.fsPath;
      if (activeWorkspace) {
        return activeWorkspace;
      }
      if (activeFilePath) {
        return path.dirname(activeFilePath);
      }
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
  }

  _withWorkspaceRoot(writeOptions = {}, workspaceFolder) {
    return workspaceFolder
      ? { ...writeOptions, workspaceRoot: workspaceFolder }
      : writeOptions;
  }

  async _findGitRoot(startPath) {
    if (!startPath) return null;

    let currentPath = startPath;
    try {
      const stat = await fs.stat(currentPath);
      if (stat.isFile()) {
        currentPath = path.dirname(currentPath);
      }
    } catch {
      currentPath = path.dirname(currentPath);
    }

    let probePath = currentPath;
    const filesystemRoot = path.parse(probePath).root;

    while (probePath) {
      try {
        const gitStat = await fs.stat(path.join(probePath, ".git"));
        if (gitStat.isDirectory() || gitStat.isFile()) {
          return probePath;
        }
      } catch {
        // Keep walking upward.
      }

      if (probePath === filesystemRoot) {
        break;
      }
      probePath = path.dirname(probePath);
    }

    return null;
  }

  async _isGitRepository(workspaceFolder, filePath = null) {
    return !!(await this._findGitRoot(filePath || workspaceFolder));
  }
  _getCurrentFileEditor() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.scheme === "file") {
      this.lastActiveEditor = activeEditor;
      return activeEditor;
    }
    if (this.lastActiveEditor && this.lastActiveEditor.document.uri.scheme === "file") {
      return this.lastActiveEditor;
    }
    return null;
  }

  _looksLikePlaceholderGeneratedContent(content) {
    const candidate = String(content || "");
    const normalizedCandidate = candidate
      // Allow normal HTML/CSS placeholder usage such as
      // `placeholder="Email"` and `input::placeholder`.
      .replace(/\bplaceholder\s*=\s*(["'])[\s\S]*?\1/gi, " ")
      .replace(/::placeholder\b/gi, " ");
    const placeholderPatterns = [
      /\.\.\.\s*\(unchanged/i,
      /unchanged\s+(html|css|javascript|js|content|code)/i,
      /\bplaceholder\s+(text|content|copy|markup|html|css|javascript|js|code)\b/i,
      /\b(?:replace|fill in|insert|add)\s+(?:the|your)\s+(?:rest of the\s+)?(html|css|javascript|js|content|code)\b/i,
      /\b(?:existing|your)\s+(html|css|javascript|js|content|code)\s+(?:here|goes here)\b/i,
      /\[\s*(?:placeholder|existing [^\]]+|your [^\]]+)\s*\]/i,
      /your code here/i,
      /existing (html|css|javascript|js|code)(?:\s+here|\s+goes\s+here)?/i
    ];

    return placeholderPatterns.some((pattern) => pattern.test(normalizedCandidate));
  }

  _assessAiReplacementSafety(originalContent, nextContent, relativePath = "") {
    const candidate = typeof nextContent === "string" ? nextContent : "";
    const original = typeof originalContent === "string" ? originalContent : "";
    const targetLabel = relativePath || "the file";
    const trimmedCandidate = candidate.trim();

    if (!trimmedCandidate) {
      return { ok: false, reason: "AI returned an empty file." };
    }

    if (this._looksLikePlaceholderGeneratedContent(trimmedCandidate)) {
      return {
        ok: false,
        reason: `AI returned placeholder content for ${targetLabel} instead of a complete file.`
      };
    }

    if (original.trim() && trimmedCandidate === original.trim()) {
      return { ok: false, reason: "AI did not produce any file changes." };
    }

    const isCodeLikeTarget =
      /\.(js|jsx|ts|tsx|py|java|c|cpp|cc|cxx|h|hpp|html?|json|css|scss|sass|less)$/i.test(
        targetLabel
      );
    if (!isCodeLikeTarget) {
      return { ok: true };
    }

    const originalTrimmed = original.trim();
    if (
      originalTrimmed.length > 120 &&
      trimmedCandidate.length < Math.max(80, Math.floor(originalTrimmed.length * 0.5))
    ) {
      return {
        ok: false,
        reason: `AI output for ${targetLabel} is much shorter than the existing code and may be truncated.`
      };
    }

    const originalNonEmptyLines = original
      .split(/\r?\n/)
      .filter((line) => line.trim()).length;
    const candidateNonEmptyLines = candidate
      .split(/\r?\n/)
      .filter((line) => line.trim()).length;
    if (
      originalNonEmptyLines >= 8 &&
      candidateNonEmptyLines < Math.max(3, Math.floor(originalNonEmptyLines * 0.5))
    ) {
      return {
        ok: false,
        reason: `AI output for ${targetLabel} removes too much non-empty code and may be incomplete.`
      };
    }

    return { ok: true };
  }

  async _assessEditSafetyBeforeApply(
    workspaceFolder,
    filePath,
    originalContent,
    nextContent
  ) {
    const replacementSafety = this._assessAiReplacementSafety(
      originalContent,
      nextContent,
      filePath
    );
    if (!replacementSafety.ok) {
      return replacementSafety;
    }

    const syntaxCheck = await this.agent._runSyntaxCheck(
      filePath,
      workspaceFolder,
      nextContent
    );
    if (syntaxCheck && !syntaxCheck.success && !syntaxCheck.skipped) {
      return {
        ok: false,
        reason: `Refusing to apply syntax-invalid update to ${filePath}: ${syntaxCheck.error || syntaxCheck.output || "Syntax check failed"}`
      };
    }

    return { ok: true };
  }

  _hasExecutableFileAction(actions) {
    if (!Array.isArray(actions)) {
      return false;
    }

    return actions.some((action) => {
      if (!action) return false;
      if (action.type === "file") {
        return typeof action.content === "string" && action.content.trim().length > 0;
      }
      if (action.type === "patch") {
        return typeof action.search === "string" && typeof action.replace === "string";
      }
      return false;
    });
  }

  _shouldBlockIncompleteStructuredExecution(response) {
    if (!this._hasExecutableFileAction(response?.actions)) {
      return false;
    }

    return !!this.agent?._hasIncompleteStructuredEditWarning?.(response?.warnings);
  }

  _validateGeneratedFileContent(originalContent, nextContent, language, relativePath) {
    const replacementSafety = this._assessAiReplacementSafety(
      originalContent,
      nextContent,
      relativePath
    );
    if (!replacementSafety.ok) {
      return replacementSafety;
    }
    const candidate = typeof nextContent === "string" ? nextContent.trim() : "";

    if (language === "html") {
      const hasHtmlShell =
        /<!doctype html>/i.test(candidate) &&
        /<html[\s>]/i.test(candidate) &&
        /<body[\s>]/i.test(candidate);

      if (!hasHtmlShell) {
        return {
          ok: false,
          reason: "AI response does not look like a complete HTML document."
        };
      }
    }

    return { ok: true };
  }

  _sanitizeSyntaxErrorOutput(errorOutput) {
    return String(errorOutput || "")
      .replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g, "")
      .replace(/\d{2}:\d{2}:\d{2}/g, "")
      .replace(/\d{2}\/\d{2}\/\d{4}/g, "")
      .replace(/\[\d{4}-\d{2}-\d{2}.*?\]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  _getSyntaxFixLanguage(fileName) {
    const ext = path.extname(String(fileName || "")).toLowerCase();
    const langMap = {
      ".js": "javascript",
      ".jsx": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".py": "python",
      ".java": "java",
      ".c": "c",
      ".cpp": "cpp",
      ".h": "c",
      ".hpp": "cpp",
      ".html": "html",
      ".htm": "html"
    };
    return langMap[ext] || "code";
  }

  _buildSyntaxFixPrompt(relativePath, fileName, fileContent, syntaxCheck) {
    const language = this._getSyntaxFixLanguage(fileName);
    const rawError = syntaxCheck?.error || syntaxCheck?.output || "Unknown syntax error";
    const errorOutput = this._sanitizeSyntaxErrorOutput(rawError);
    const prompt = `Fix the syntax errors in this ${language} file. Return exactly one FILE action with the complete corrected file.\n\nFile: ${relativePath}\n\nSyntax errors:\n${errorOutput}\n\nCurrent file content:\n\`\`\`${language}\n${fileContent}\n\`\`\``;
    return { prompt, language, errorOutput };
  }

  async _requestSyntaxFixAction(
    fileName,
    relativePath,
    fileContent,
    syntaxCheck,
    workspaceFolder,
    runtimeConfig,
    streamCallback = null
  ) {
    const { prompt, language, errorOutput } = this._buildSyntaxFixPrompt(
      relativePath,
      fileName,
      fileContent,
      syntaxCheck
    );

    const response = await this.agent.chat(
      prompt,
      workspaceFolder,
      streamCallback,
      null,
      { mode: "heavy", runtimeConfig }
    );

    if (response.error) {
      return { success: false, error: response.error, errorOutput };
    }

    const fileAction = (response.actions || []).find(
      (action) => action.type === "file" && action.content
    );
    if (!fileAction) {
      return {
        success: false,
        error:
          "AI did not generate a file fix. Try rephrasing your request or use a different AI model.",
        errorOutput
      };
    }

    const generatedContentCheck = this._validateGeneratedFileContent(
      fileContent,
      fileAction.content,
      language,
      relativePath
    );
    if (!generatedContentCheck.ok) {
      return {
        success: false,
        error: generatedContentCheck.reason,
        errorOutput
      };
    }

    return {
      success: true,
      fileAction,
      language,
      errorOutput
    };
  }

  async _repairSyntaxForWorkspaceFile(
    relativePath,
    workspaceFolder,
    syntaxCheck,
    writeOptions = {},
    runtimeConfig = null
  ) {
    const fullPath = path.join(workspaceFolder, relativePath);
    let fileContent = "";
    try {
      fileContent = await fs.readFile(fullPath, "utf8");
    } catch (error) {
      return {
        success: false,
        error: `Unable to read ${relativePath} for syntax repair: ${error.message}`
      };
    }

    const repairPlan = await this._requestSyntaxFixAction(
      fullPath,
      relativePath,
      fileContent,
      syntaxCheck,
      workspaceFolder,
      runtimeConfig
    );
    if (!repairPlan.success) {
      return repairPlan;
    }

    const applyResult = await this.agent.applyChanges(
      relativePath,
      repairPlan.fileAction.content,
      false,
      this._withWorkspaceRoot(writeOptions, workspaceFolder)
    );
    if (!applyResult.success) {
      return {
        success: false,
        error: applyResult.error || `Failed to apply syntax repair to ${relativePath}`
      };
    }

    const verifyCheck = await this.agent._runSyntaxCheck(
      fullPath,
      workspaceFolder,
      applyResult.newContent || repairPlan.fileAction.content
    );
    const verificationPassed =
      !verifyCheck || verifyCheck.success || verifyCheck.skipped;

    if (!verificationPassed) {
      let rollbackNote = "";
      if (
        applyResult.success &&
        !applyResult.created &&
        typeof applyResult.previousContent === "string"
      ) {
        const rollbackResult = await this.agent.applyChanges(
          relativePath,
          applyResult.previousContent,
          false,
          this._withWorkspaceRoot(
            { ...writeOptions, allowEmpty: true, allowDocTruncate: true },
            workspaceFolder
          )
        );
        rollbackNote = rollbackResult.success
          ? " Restored the previous file contents."
          : ` Failed to restore the previous file contents: ${rollbackResult.error}`;
      }

      return {
        success: false,
        applyResult,
        verification: verifyCheck,
        error: `Syntax repair did not fully resolve ${relativePath}: ${verifyCheck.error || verifyCheck.output || "Unknown syntax error"}.${rollbackNote}`
      };
    }

    return {
      success: true,
      applyResult,
      verification: verifyCheck,
      error: null
    };
  }

  async _runActiveSyntaxFix(workspaceFolder) {
    const activeEditor = this._getCurrentFileEditor();
    if (!activeEditor || activeEditor.document.uri.scheme !== "file") {
      this._postMessage({
        type: "error",
        text: "Open the file you want to repair, then ask me to fix its syntax errors."
      });
      this._postMessage({ type: "done" });
      return;
    }

    const fileName = activeEditor.document.fileName;
    const fileContent = activeEditor.document.getText();
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder, fileName).replace(/\\/g, "/")
      : path.basename(fileName);

    this._postMessage({
      type: "status",
      text: `Analyzing ${relativePath} for syntax errors...`
    });
    this._postMessage({ type: "thinking" });

    // Run syntax check first
    const syntaxCheck = await this.agent._runSyntaxCheck(
      fileName.replace(/\\/g, "/"),
      workspaceFolder,
      fileContent
    );

    if (!syntaxCheck) {
      this._postMessage({
        type: "error",
        text: "Syntax checking is not supported for this file type."
      });
      this._postMessage({ type: "done" });
      return;
    }

    if (syntaxCheck.skipped) {
      this._postMessage({
        type: "status",
        text: syntaxCheck.output
      });
      this._postMessage({ type: "done" });
      return;
    }

    if (syntaxCheck.success) {
      this._postMessage({
        type: "stream",
        text: `No syntax errors found in ${relativePath}.`
      });
      this._postMessage({ type: "done" });
      return;
    }

    // Syntax errors found - use AI to fix
    const { errorOutput } = this._buildSyntaxFixPrompt(
      relativePath,
      fileName,
      fileContent,
      syntaxCheck
    );

    this._postMessage({
      type: "stream",
      text: `Syntax errors detected:\n${errorOutput}\n\nGenerating fix...`
    });

    const runtimeConfig = await this._getEffectiveAiConfig();
    const repairPlan = await this._requestSyntaxFixAction(
      fileName,
      relativePath,
      fileContent,
      syntaxCheck,
      workspaceFolder,
      runtimeConfig,
      (chunk) => {
        this._postMessage({ type: "stream", text: chunk });
      }
    );

    if (!repairPlan.success) {
      this._postMessage({
        type: "error",
        text: repairPlan.error
      });
      this._postMessage({ type: "done" });
      return;
    }

    // Apply the fix surgically and register it on the undo stack so the user
    // can revert via the chat Undo button, /undo, or Ctrl+Z.
    const applyResult = await this._applyToEditor(
      activeEditor,
      repairPlan.fileAction.content
    );
    if (!applyResult.success) {
      this._postMessage({
        type: "error",
        text: applyResult.error || "Failed to apply the fix to the editor."
      });
      this._postMessage({ type: "done" });
      return;
    }

    const undoId = this._registerEditForUndo({
      filePath: applyResult.path,
      before: applyResult.previousContent,
      after: applyResult.newContent,
      label: "syntax-fix"
    });
    this._postMessage({
      type: "applied",
      filePath: applyResult.path,
      undoId,
      text: `✅ Fixed syntax in ${applyResult.relativePath || path.basename(applyResult.path)}`
    });

    await activeEditor.document.save();

    // Verify the fix
    const verifyCheck = await this.agent._runSyntaxCheck(
      fileName.replace(/\\/g, "/"),
      workspaceFolder,
      activeEditor.document.getText()
    );
    const verificationPassed = !!(verifyCheck && verifyCheck.success);
    if (verificationPassed) {
      this._postMessage({
        type: "stream",
        text: "\n\nSyntax errors fixed successfully!"
      });
    } else {
      this._postMessage({
        type: "stream",
        text: "\n\nWarning: Fix applied, but some syntax issues may remain. Please review the changes."
      });
    }

    this._postFixInsights(
      applyResult.path,
      applyResult.previousContent,
      applyResult.newContent,
      {
        syntaxErrorOutput: errorOutput,
        verificationPassed,
        knownSyntaxBefore: false,
        knownSyntaxAfter: verificationPassed
      }
    );

    this._postMessage({ type: "done" });
  }

  _getHtmlContent(webview) {
    try {
      const htmlPath = this._getChatPanelHtmlPath();
      console.log("[ChatPanel] Loading HTML from:", htmlPath);
      const html = fsSync.readFileSync(htmlPath, "utf8");
      const nonce = this._createNonce();
      const logoPath = this._getLogoAssetPath();
      const logoUri = logoPath && webview
        ? webview.asWebviewUri(vscode.Uri.file(logoPath)).toString()
        : "";
      const hydratedHtml = html
        .replace(/__CSP_SOURCE__/g, webview?.cspSource || "")
        .replace(/__CSP_NONCE__/g, nonce)
        .replace(/__LOGO_URI__/g, logoUri);
      console.log("[ChatPanel] HTML loaded, length:", html.length);
      return hydratedHtml;
    } catch (error) {
      console.error("[ChatPanel] Failed to load HTML:", error);
      const attemptedPaths = this._getChatPanelHtmlCandidates().join(" | ");
      return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { 
      background: #1e1e1e; 
      color: #fff; 
      font-family: sans-serif; 
      padding: 20px; 
    }
  </style>
</head>
<body>
  <h1>Error Loading Chat Panel</h1>
  <p>Failed to load chat-panel.html: ${error.message}</p>
  <p>Attempted paths: ${attemptedPaths}</p>
</body>
</html>`;
    }
  }

  resolveWebviewView(webviewView) {
    console.log("[ChatPanel] Resolving sidebar chat view");
    this.sidebarView = webviewView;
    this.lastActiveEditor = vscode.window.activeTextEditor || this.lastActiveEditor;
    this.agent.setActiveEditor(this.lastActiveEditor);
    this._attachWebviewHost(webviewView, { kind: "sidebar" });
    webviewView.onDidDispose(() => {
      if (this.sidebarView === webviewView) {
        console.log("[ChatPanel] Sidebar view disposed");
        this.sidebarView = null;
      }
    });
  }

  _attachWebviewHost(host, { kind }) {
    if (!host || !host.webview) return;
    console.log(`[ChatPanel] Attaching ${kind} webview host`);
    host.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, "src", "ai-agent")),
        vscode.Uri.file(__dirname)
      ]
    };
    this._setupMessageHandler(host.webview);
    host.webview.html = this._getHtmlContent(host.webview);
  }

  _postMessage(message) {
    const targets = [this.panel?.webview, this.sidebarView?.webview].filter(Boolean);
    const seen = new Set();
    for (const webview of targets) {
      if (seen.has(webview)) continue;
      seen.add(webview);
      webview.postMessage(message);
    }
  }

  _getChatPanelHtmlPath() {
    const candidates = this._getChatPanelHtmlCandidates();
    const existingPath = candidates.find(candidate => fsSync.existsSync(candidate));
    if (existingPath) return existingPath;

    throw new Error(`chat-panel.html not found. Attempted paths: ${candidates.join(", ")}`);
  }

  _getChatPanelHtmlCandidates() {
    return [
      path.join(this.context.extensionPath, "src", "ai-agent", "chat-panel.html"),
      path.join(__dirname, "chat-panel.html")
    ];
  }

  _getLogoAssetPath() {
    const candidates = [
      path.join(this.context.extensionPath, "src", "ai-agent", "logo.png"),
      path.join(__dirname, "logo.png")
    ];
    return candidates.find((candidate) => fsSync.existsSync(candidate)) || null;
  }

  _createNonce() {
    return crypto.randomBytes(16).toString("base64");
  }

  _sanitizeExternalUrl(value, { allowHttp = true, allowHttps = true } = {}) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (!/^https?:\/\//i.test(raw)) return "";

    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "http:" && allowHttp) return parsed.toString();
      if (parsed.protocol === "https:" && allowHttps) return parsed.toString();
    } catch (_) {
      return "";
    }

    return "";
  }

  _getApiKeyConfigKey(provider) {
    if (provider === "groq") return "groqApiKey";
    if (provider === "openrouter") return "openrouterApiKey";
    if (provider === "anthropic") return "anthropicApiKey";
    if (provider === "nvidia") return "nvidiaApiKey";
    return null;
  }

  _getApiSecretKey(provider) {
    return `codeJanitor.ai.${provider}.apiKey`;
  }

  _getCustomProvidersStateKey() {
    return "codeJanitor.ai.customProviders";
  }

  _getSelectedProviderStateKey() {
    return "codeJanitor.ai.selectedProvider";
  }

  _isBuiltInProvider(provider) {
    return BUILT_IN_PROVIDERS.has(provider);
  }

  _slugifyProviderName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  _normalizeCustomProvider(input) {
    const name = String(input?.name || "").trim();
    const baseUrl = this
      ._sanitizeExternalUrl(String(input?.baseUrl || "").trim(), {
        allowHttp: true,
        allowHttps: true
      })
      .replace(/\/+$/, "");
    const defaultModel = String(input?.defaultModel || input?.model || "").trim();
    const apiKeyLink = this._sanitizeExternalUrl(String(input?.apiKeyLink || "").trim(), {
      allowHttp: true,
      allowHttps: true
    });
    const extraModels = Array.isArray(input?.models)
      ? input.models
      : String(input?.models || "")
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean);
    const models = Array.from(new Set([defaultModel, ...extraModels].filter(Boolean)));
    const slugBase = this._slugifyProviderName(name);

    if (!name || !baseUrl || !defaultModel || !slugBase) {
      return null;
    }

    return {
      id: input?.id || `custom:${slugBase}`,
      name,
      baseUrl,
      defaultModel,
      models,
      apiKeyLink,
      protocol: "openai"
    };
  }

  _getCustomProviders() {
    const providers = this.context.globalState.get(this._getCustomProvidersStateKey(), []);
    return Array.isArray(providers) ? providers.filter(Boolean) : [];
  }

  async _saveCustomProviders(providers) {
    await this.context.globalState.update(this._getCustomProvidersStateKey(), providers);
  }

  _getCustomProviderById(providerId) {
    return this._getCustomProviders().find((provider) => provider.id === providerId) || null;
  }

  _getSelectedProviderId() {
    return this.context.globalState.get(this._getSelectedProviderStateKey(), "");
  }

  async _setSelectedProviderId(provider) {
    await this.context.globalState.update(this._getSelectedProviderStateKey(), provider || "");
  }

  _resolveCustomProviderChatUrl(baseUrl) {
    const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!normalized) return "";
    if (/\/chat\/completions$/i.test(normalized)) return normalized;
    if (/\/v1$/i.test(normalized)) return `${normalized}/chat/completions`;
    return `${normalized}/v1/chat/completions`;
  }

  async _getProviderPresence() {
    const builtInPresence = await this._restoreApiKeys();
    const customPresence = {};
    for (const provider of this._getCustomProviders()) {
      const key = this._sanitizeApiKey(
        await this.context.secrets.get(this._getApiSecretKey(provider.id))
      );
      customPresence[provider.id] = !!key;
    }
    return { ...builtInPresence, ...customPresence };
  }

  _buildProviderCatalog() {
    return [
      { id: "ollama", name: "Ollama", builtin: true, requiresKey: false, models: [] },
      { id: "groq", name: "Groq", builtin: true, requiresKey: true, models: MODELS_BY_PROVIDER.groq || [] },
      { id: "openrouter", name: "OpenRouter", builtin: true, requiresKey: true, models: MODELS_BY_PROVIDER.openrouter || [] },
      { id: "anthropic", name: "Anthropic", builtin: true, requiresKey: true, models: MODELS_BY_PROVIDER.anthropic || [] },
      { id: "nvidia", name: "NVIDIA NIM", builtin: true, requiresKey: true, models: MODELS_BY_PROVIDER.nvidia || [] },
      ...this._getCustomProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        builtin: false,
        requiresKey: true,
        apiKeyLink: provider.apiKeyLink || "",
        models: provider.models || [],
        defaultModel: provider.defaultModel,
        protocol: provider.protocol || "openai"
      }))
    ];
  }

  _postSessionState(extra = {}) {
    this._postMessage({
      type: "sessionState",
      ...this.agent.getSessionState(),
      ...this._getUndoState(),
      ...extra
    });
  }

  _getUndoState() {
    const latestEntry = this._getLatestUndoEntry().entry;
    return {
      canUndo: !!latestEntry,
      latestUndoId: latestEntry?.id || null
    };
  }

  _postUndoState() {
    this._postMessage({
      type: "undoState",
      ...this._getUndoState()
    });
  }

  _deleteSessionAndRefresh(sessionId) {
    if (!sessionId) return false;
    this._discardUndoEntriesForSession(sessionId);
    this.agent.deleteSession(sessionId);
    this._outsideWorkspaceAllowed = false;
    this._postSessionState();
    this._postMessage({
      type: "status",
      text: "Chat deleted."
    });
    return true;
  }

  _getFallbackModelsForProvider(provider) {
    if (provider === "ollama") return OLLAMA_FALLBACK_MODELS.slice();

    const customProvider = this._getCustomProviderById(provider);
    if (customProvider?.models?.length) return customProvider.models.slice();

    const providerModels = MODELS_BY_PROVIDER[provider];
    return Array.isArray(providerModels) ? providerModels.slice() : [];
  }

  _sanitizeApiKey(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return "";
    if (
      (raw.startsWith("\"") && raw.endsWith("\"")) ||
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith("`") && raw.endsWith("`"))
    ) {
      return raw.slice(1, -1).trim();
    }
    return raw;
  }

  async _getStoredApiKey(provider) {
    const configKey = this._getApiKeyConfigKey(provider);
    if (!configKey) {
      return this._sanitizeApiKey(
        await this.context.secrets.get(this._getApiSecretKey(provider))
      );
    }

    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const configValue = this._sanitizeApiKey(cfg.get(configKey, ""));
    const secretValue = this._sanitizeApiKey(
      await this.context.secrets.get(this._getApiSecretKey(provider))
    );

    if (secretValue) return secretValue;
    return configValue;
  }

  async _getEffectiveAiConfig() {
    const config = this.agent.getConfig();
    const selectedProvider = this._getSelectedProviderId() || config.provider;
    const customProvider = this._isBuiltInProvider(selectedProvider)
      ? null
      : this._getCustomProviderById(selectedProvider);
    console.log("[ChatPanel] Base config from agent:", {
      provider: selectedProvider,
      model: config.model,
      hasGroqKey: !!config.groqApiKey,
      hasOpenrouterKey: !!config.openrouterApiKey,
      hasAnthropicKey: !!config.anthropicApiKey,
      hasNvidiaKey: !!config.nvidiaApiKey
    });

    const [groqApiKey, openrouterApiKey, anthropicApiKey, nvidiaApiKey] = await Promise.all([
      this._getStoredApiKey("groq"),
      this._getStoredApiKey("openrouter"),
      this._getStoredApiKey("anthropic"),
      this._getStoredApiKey("nvidia")
    ]);

    console.log("[ChatPanel] Retrieved API key presence:", {
      groq: !!groqApiKey,
      openrouter: !!openrouterApiKey,
      anthropic: !!anthropicApiKey,
      nvidia: !!nvidiaApiKey
    });

    // CRITICAL FIX: If using cloud provider without API key, force to ollama
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    if (selectedProvider === "groq" && !groqApiKey) {
      console.log("[ChatPanel] CRITICAL: Groq selected but no API key! Forcing to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
      await this._setSelectedProviderId("ollama");
      config.provider = "ollama";
      config.model = this._getDefaultModelForProvider("ollama");
    } else if (selectedProvider === "openrouter" && !openrouterApiKey) {
      console.log("[ChatPanel] CRITICAL: OpenRouter selected but no API key! Forcing to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
      await this._setSelectedProviderId("ollama");
      config.provider = "ollama";
      config.model = this._getDefaultModelForProvider("ollama");
    } else if (selectedProvider === "anthropic" && !anthropicApiKey) {
      console.log("[ChatPanel] CRITICAL: Anthropic selected but no API key! Forcing to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
      await this._setSelectedProviderId("ollama");
      config.provider = "ollama";
      config.model = this._getDefaultModelForProvider("ollama");
    } else if (selectedProvider === "nvidia" && !nvidiaApiKey) {
      console.log("[ChatPanel] CRITICAL: NVIDIA selected but no API key! Forcing to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
      await this._setSelectedProviderId("ollama");
      config.provider = "ollama";
      config.model = this._getDefaultModelForProvider("ollama");
    }

    if (customProvider) {
      const customApiKey = await this._getStoredApiKey(customProvider.id);
      const savedModel = this._getSavedProviderModel(customProvider.id);
      return {
        ...config,
        provider: customProvider.id,
        model: savedModel || customProvider.defaultModel,
        customProvider: {
          ...customProvider,
          apiKey: customApiKey,
          chatCompletionsUrl: this._resolveCustomProviderChatUrl(customProvider.baseUrl)
        }
      };
    }

    const effectiveConfig = {
      ...config,
      provider: selectedProvider,
      groqApiKey,
      openrouterApiKey,
      anthropicApiKey,
      nvidiaApiKey
    };

    console.log("[ChatPanel] Effective config for provider", config.provider, ":", {
      hasKey: config.provider === "groq" ? !!groqApiKey :
              config.provider === "openrouter" ? !!openrouterApiKey :
              config.provider === "anthropic" ? !!anthropicApiKey :
              config.provider === "nvidia" ? !!nvidiaApiKey : false
    });

    return effectiveConfig;
  }

  async _persistApiKey(provider, apiKey) {
    try {
      const configKey = this._getApiKeyConfigKey(provider);
      const sanitized = this._sanitizeApiKey(apiKey);
      if (!sanitized) {
        console.log(`[ChatPanel] Skipping persist for ${provider}: no API key provided`);
        return;
      }

      console.log(`[ChatPanel] Persisting API key for ${provider} in SecretStorage`);
      await this.context.secrets.store(this._getApiSecretKey(provider), sanitized);
      if (!configKey) {
        return;
      }

      const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");

      try {
        const currentValue = this._sanitizeApiKey(cfg.get(configKey, ""));
        if (currentValue) {
          const target = this._getConfigTargetForKey(configKey);
          await cfg.update(configKey, "", target);
          console.log(`[ChatPanel] Cleared plaintext ${configKey} after migrating to SecretStorage`);
        }
      } catch (readError) {
        console.warn("[ChatPanel] Failed to scrub plaintext API key from settings:", readError);
      }
    } catch (error) {
      console.error(`[ChatPanel] Error persisting API key for ${provider}:`, error);
      throw error;
    }
  }

  async _restoreApiKeys() {
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const providers = ["groq", "openrouter", "anthropic", "nvidia"];
    const presence = {
      groq: false,
      openrouter: false,
      anthropic: false,
      nvidia: false
    };

    for (const provider of providers) {
      const configKey = this._getApiKeyConfigKey(provider);
      const configValue = this._sanitizeApiKey(cfg.get(configKey, ""));
      const secretValue = this._sanitizeApiKey(
        await this.context.secrets.get(this._getApiSecretKey(provider))
      );
      let effectiveValue = secretValue;

      console.log(`[ChatPanel] Restoring ${provider}: config=${!!configValue}, secret=${!!secretValue}`);

      if (!secretValue && configValue) {
        await this.context.secrets.store(this._getApiSecretKey(provider), configValue);
        effectiveValue = configValue;
      }

      if (configValue) {
        try {
          const target = this._getConfigTargetForKey(configKey);
          await cfg.update(configKey, "", target);
        } catch (error) {
          console.warn(`[ChatPanel] Failed to remove plaintext ${configKey} from settings:`, error);
        }
      }

      presence[provider] = !!effectiveValue;
    }

    return presence;
  }

  async _addCustomProvider(definition, apiKey) {
    const normalized = this._normalizeCustomProvider(definition);
    const sanitizedKey = this._sanitizeApiKey(apiKey);
    if (!normalized) {
      throw new Error("Provider name, base URL, and default model are required.");
    }
    if (!sanitizedKey) {
      throw new Error("An API key is required for a custom provider.");
    }

    const providers = this._getCustomProviders().filter((provider) => provider.id !== normalized.id);
    providers.push(normalized);
    await this._saveCustomProviders(providers);
    await this._persistApiKey(normalized.id, sanitizedKey);
    await this._setSelectedProviderId(normalized.id);
    this._saveProviderModel(normalized.id, normalized.defaultModel);
    return normalized;
  }

  _getLanguageIdForPath(filePath) {
    const ext = path.extname(filePath || "").toLowerCase();
    const mapping = {
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".json": "json",
      ".html": "html",
      ".css": "css",
      ".md": "markdown",
      ".py": "python",
      ".java": "java",
      ".c": "c",
      ".h": "c",
      ".cpp": "cpp",
      ".hpp": "cpp",
      ".sh": "shellscript",
      ".yml": "yaml",
      ".yaml": "yaml"
    };
    return mapping[ext] || "plaintext";
  }

  async _openDraftFile(filePath, content) {
    const suggested = (filePath || "untitled.txt").replace(/\\/g, "/").replace(/^\/+/, "");
    const uri = vscode.Uri.parse(`untitled:${encodeURI(suggested)}`);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    await editor.edit((editBuilder) => {
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      editBuilder.replace(fullRange, content);
    });
    await vscode.languages.setTextDocumentLanguage(
      editor.document,
      this._getLanguageIdForPath(filePath)
    );
    return { success: true, path: suggested };
  }

  async _revealWorkspaceFile(filePath) {
    if (!filePath) return;
    try {
      const document = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (_) {
      // Ignore reveal failures so edits still succeed.
    }
  }

  async _applyToEditor(editor, content) {
    if (!editor || editor.document.uri.scheme !== "file") {
      return { success: false, error: "No editable file is currently open." };
    }

    const document = editor.document;
    const currentText = document.getText();

    if (currentText === content) {
      return {
        success: true,
        path: document.fileName,
        relativePath: path.basename(document.fileName)
      };
    }

    const diff = computeMinimalReplacement(currentText, content);
    const applied = await editor.edit((editBuilder) => {
      if (diff) {
        const range = new vscode.Range(
          document.positionAt(diff.startOffset),
          document.positionAt(diff.endOffset)
        );
        editBuilder.replace(range, diff.replacement);
      } else {
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(currentText.length)
        );
        editBuilder.replace(fullRange, content);
      }
    });

    if (!applied) {
      return { success: false, error: "Failed to update the open file." };
    }

    return {
      success: true,
      path: document.fileName,
      relativePath: path.basename(document.fileName),
      previousContent: currentText,
      newContent: content
    };
  }

  _postFixInsights(filePath, beforeCode, afterCode, options = {}) {
    if (
      typeof beforeCode !== "string" ||
      typeof afterCode !== "string" ||
      beforeCode === afterCode
    ) {
      return;
    }

    try {
      const insights = buildFixInsights({
        filePath,
        beforeCode,
        afterCode,
        syntaxErrorOutput: options.syntaxErrorOutput || "",
        verificationPassed:
          typeof options.verificationPassed === "boolean"
            ? options.verificationPassed
            : null,
        knownSyntaxBefore:
          typeof options.knownSyntaxBefore === "boolean"
            ? options.knownSyntaxBefore
            : null,
        knownSyntaxAfter:
          typeof options.knownSyntaxAfter === "boolean"
            ? options.knownSyntaxAfter
            : null
      });

      if (!insights) {
        return;
      }

      this._postMessage({
        type: "fixInsights",
        insights
      });
    } catch (error) {
      console.warn("Could not generate fix insights:", error.message);
    }
  }

  _shouldInspectPreviewRequest(message) {
    const text = String(message || "");
    return /\b(preview|render|runtime|page|ui)\b/i.test(text) &&
      /\b(inspect|study|analy[sz]e|check|debug|fix|issue|problem|error|broken)\b/i.test(text);
  }

  _previewDiagnosticsHasIssues(diagnostics) {
    if (!diagnostics) return false;
    return (
      (diagnostics.errors?.length || 0) > 0 ||
      (diagnostics.warnings?.length || 0) > 0 ||
      (diagnostics.resourceFailures?.length || 0) > 0
    );
  }

  _summarizePreviewDiagnostics(diagnostics) {
    if (!diagnostics) {
      return "Preview inspection finished, but no diagnostics were returned.";
    }

    const parts = [];
    if (diagnostics.ready) {
      parts.push("preview loaded");
    } else {
      parts.push("preview did not confirm readiness");
    }

    if (diagnostics.title) {
      parts.push(`title: ${diagnostics.title}`);
    }

    if (diagnostics.bodyTextExcerpt) {
      parts.push(`content sample: ${diagnostics.bodyTextExcerpt}`);
    }

    const errorCount = diagnostics.errors?.length || 0;
    const warningCount = diagnostics.warnings?.length || 0;
    const resourceCount = diagnostics.resourceFailures?.length || 0;
    parts.push(
      `issues: ${errorCount} error(s), ${warningCount} warning(s), ${resourceCount} resource failure(s)`
    );

    const samples = [
      ...(diagnostics.errors || []).slice(0, 2).map((entry) => entry.message || entry.stack || "Unknown error"),
      ...(diagnostics.resourceFailures || []).slice(0, 2).map((entry) => entry.url ? `${entry.message}: ${entry.url}` : entry.message)
    ].filter(Boolean);

    if (samples.length > 0) {
      parts.push(`sample: ${samples.join(" | ")}`);
    }

    return `Preview inspection summary: ${parts.join(". ")}.`;
  }

  async _fixActiveFileFromPreviewDiagnostics(userRequest, workspaceFolder, diagnostics, runtimeConfig) {
    const activeEditor = this.lastActiveEditor || vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.document.uri.scheme !== "file") {
      return { success: false, error: "Open the file you want me to repair before preview inspection." };
    }

    const document = activeEditor.document;
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder, document.fileName).replace(/\\/g, "/")
      : path.basename(document.fileName);
    const language = this._getLanguageIdForPath(document.fileName);
    const diagnosticsJson = JSON.stringify(diagnostics, null, 2).slice(0, 8000);

    const fixPrompt = `The user asked: "${userRequest}".

You inspected the live preview for "${relativePath}" and collected runtime/render diagnostics. Fix the active file so the preview loads cleanly and preserves the user's intent. Return exactly one FILE action for "${relativePath}" with the complete updated file. Do not output explanations.

Preview diagnostics:
\`\`\`json
${diagnosticsJson}
\`\`\`

Current file content:
\`\`\`${language}
${document.getText()}
\`\`\``;

    const response = await this.agent.chat(
      fixPrompt,
      workspaceFolder,
      null,
      null,
      { mode: "heavy", runtimeConfig, skipHistory: true }
    );

    if (response.error) {
      return { success: false, error: response.error };
    }

    const fileAction = (response.actions || []).find((action) =>
      action.type === "file" &&
      typeof action.content === "string" &&
      action.content.trim().length > 0
    );

    if (!fileAction) {
      return {
        success: false,
        error: "AI did not return a file update after preview inspection."
      };
    }

    const safetyCheck = await this._assessEditSafetyBeforeApply(
      workspaceFolder,
      relativePath,
      document.getText(),
      fileAction.content
    );
    if (!safetyCheck.ok) {
      return { success: false, error: safetyCheck.reason };
    }

    const result = await this._applyToEditor(activeEditor, fileAction.content);
    if (!result.success) {
      return result;
    }

    await document.save();

    let verification = null;
    try {
      verification = await vscode.commands.executeCommand("codeJanitor.inspectLivePreview");
    } catch (error) {
      verification = { success: false, error: error.message };
    }

    return {
      success: true,
      path: relativePath,
      applyResult: result,
      verification
    };
  }

  _summarizeGitStatus(output) {
    const lines = (output || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return "Git status: working tree clean.";
    }

    const preview = lines
      .slice(0, 5)
      .map((line) => line.replace(/^\S+\s+/, ""))
      .join(", ");
    const suffix = lines.length > 5 ? ` +${lines.length - 5} more` : "";
    return `Git status: ${lines.length} changed path(s) detected. ${preview}${suffix}`;
  }

  _summarizePlannedActions(actions, insideActions, outsideFiles) {
    const fileSummaries = [];
    for (const { action, result } of insideActions) {
      if (action.type === "patch") {
        fileSummaries.push(`patch ${action.path}`);
        continue;
      }
      if (action.type !== "file" || !result?.success) continue;
      fileSummaries.push(`${result.created ? "add" : "edit"} ${action.path}`);
    }
    for (const { action } of outsideFiles) {
      if (action.type === "file") fileSummaries.push(`edit ${action.path}`);
      if (action.type === "patch") fileSummaries.push(`patch ${action.path}`);
      if (action.type === "mkdir") fileSummaries.push(`mkdir ${action.path}`);
    }

    const cmdCount = actions.filter((action) => action.type === "cmd").length;
    const parts = [];
    if (fileSummaries.length > 0) {
      const preview = fileSummaries.slice(0, 5).join(", ");
      parts.push(`Files: ${preview}${fileSummaries.length > 5 ? ` +${fileSummaries.length - 5} more` : ""}`);
    }
    if (cmdCount > 0) {
      parts.push(`Commands: ${cmdCount}`);
    }
    return parts.length > 0 ? `Plan ready. ${parts.join(" | ")}` : null;
  }

  _resolveActionFilePath(workspaceFolder, filePath) {
    const targetPath = String(filePath || "").trim();
    if (!targetPath) {
      return "";
    }
    const baseRoot = workspaceFolder || this._getEffectiveWorkspaceFolder();
    if (!baseRoot) {
      return path.resolve(targetPath);
    }
    return path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(baseRoot, targetPath);
  }

  _normalizeActionPathForMatch(filePath) {
    return String(filePath || "").replace(/\\/g, "/").trim().toLowerCase();
  }

  _findEditActionForPath(actions, targetPath, type = null) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return null;
    }

    const candidates = actions.filter((action) => {
      if (!action || (action.type !== "patch" && action.type !== "file")) {
        return false;
      }
      return type ? action.type === type : true;
    });

    if (candidates.length === 0) {
      return null;
    }

    const normalizedTarget = this._normalizeActionPathForMatch(targetPath);
    if (!normalizedTarget) {
      return candidates[0] || null;
    }

    const exactMatch = candidates.find(
      (action) =>
        this._normalizeActionPathForMatch(action.path) === normalizedTarget
    );
    if (exactMatch) {
      return exactMatch;
    }

    return (
      candidates.find((action) => {
        const normalizedPath = this._normalizeActionPathForMatch(action.path);
        return (
          normalizedPath.endsWith(`/${normalizedTarget}`) ||
          normalizedTarget.endsWith(`/${normalizedPath}`)
        );
      }) || null
    );
  }

  _buildRecoveryFileContext(actionPath, currentContent, maxChars = 12_000) {
    const content = String(currentContent || "");
    if (!content) {
      return `Current file content for ${actionPath} was unavailable.`;
    }

    if (content.length <= maxChars) {
      return `Current file content for ${actionPath}:\n\`\`\`\n${content}\n\`\`\``;
    }

    const headChars = Math.max(Math.floor(maxChars * 0.6), 2_000);
    const tailChars = Math.max(maxChars - headChars, 1_500);
    const head = content.slice(0, headChars);
    const tail = content.slice(-tailChars);

    return `Current file content for ${actionPath} (truncated, preserve unaffected code):\n\`\`\`\n${head}\n...\n[truncated ${content.length - head.length - tail.length} chars]\n...\n${tail}\n\`\`\``;
  }

  _buildPatchRecoveryPrompt(originalRequest, action, currentContent) {
    const previousSearch = String(action.search || "").trim();
    const searchContext = previousSearch
      ? `Previous failed SEARCH block:\n\`\`\`\n${previousSearch.slice(0, 2_500)}\n\`\`\`\n\n`
      : "";

    return `The previous PATCH for ${action.path} did not match the current file.
Return executable structured edits only.

Rules:
- Edit ONLY ${action.path}.
- Prefer exactly one PATCH action for ${action.path}.
- Copy SEARCH text exactly from the current file content below.
- Use a larger unique SEARCH anchor, usually 3-12 surrounding lines and up to about 80 replacement lines when needed.
- If the previous SEARCH was too small or matched multiple locations, expand it until it is unique in the file.
- Prefer the editable source file over generated copies when both exist.
- If an exact PATCH would still be brittle, return exactly one FILE action for ${action.path} with the complete updated file content.
- Do not output explanations, CMD, or MKDIR.

Original user request:
${originalRequest}

${searchContext}${this._buildRecoveryFileContext(action.path, currentContent)}`;
  }

  _buildFileFallbackPrompt(originalRequest, action, currentContent, priorReply = "") {
    const priorContext = String(priorReply || "").trim();
    const priorReplyBlock = priorContext
      ? `Previous retry reply:\n\`\`\`\n${priorContext.slice(0, 3_000)}\n\`\`\`\n\n`
      : "";

    return `The PATCH retries for ${action.path} were not reliable.
Return exactly one FILE action for ${action.path} with the COMPLETE updated file content.

Rules:
- Edit ONLY ${action.path}.
- Preserve unrelated code, formatting, and behavior.
- Do not output PATCH, CMD, MKDIR, or explanations.
- The FILE block must contain the full file from start to finish.

Original user request:
${originalRequest}

${priorReplyBlock}${this._buildRecoveryFileContext(action.path, currentContent)}`;
  }

  async _requestEditRecovery(prompt, workspaceFolder, label, runtimeConfig = null) {
    const recoveryMode = this.chatMode === "fast" ? "heavy" : this.chatMode;
    return this.agent.chat(prompt, workspaceFolder, null, null, {
      mode: recoveryMode,
      intentOverride: "edit",
      runtimeConfig,
      skipHistory: true,
      onStatus: (text) => {
        if (this._shouldSuppressInternalStatus(text)) {
          return;
        }
        this._postMessage({
          type: "status",
          text: `${label}: ${text}`
        });
      }
    });
  }

  async _recoverFailedPatch(
    originalRequest,
    workspaceFolder,
    action,
    currentContent,
    outside,
    writeOptions,
    runtimeConfig = null
  ) {
    const effectiveWriteOptions = this._withWorkspaceRoot(
      writeOptions,
      workspaceFolder
    );
    this._postMessage({
      type: "status",
      text: `Patch did not match ${action.path}. Retrying with broader file context...`
    });

    const retryResponse = await this._requestEditRecovery(
      this._buildPatchRecoveryPrompt(originalRequest, action, currentContent),
      workspaceFolder,
      "Patch retry",
      runtimeConfig
    );

    if (retryResponse.error) {
      return {
        success: false,
        error: `Patch retry failed for ${action.path}: ${retryResponse.error}`
      };
    }

    const retryPatch = this._findEditActionForPath(
      retryResponse.actions,
      action.path,
      "patch"
    );
    const retryFile = this._findEditActionForPath(
      retryResponse.actions,
      action.path,
      "file"
    );

    if (retryPatch) {
      const patched = this._buildPatchedContent(
        currentContent,
        retryPatch.search,
        retryPatch.replace
      );
      if (patched.matched) {
        this._postMessage({
          type: "status",
          text: `Applying repaired patch to: ${retryPatch.path}`
        });
        return this.agent.applyChanges(
          retryPatch.path,
          patched.content,
          outside,
          effectiveWriteOptions
        );
      }
    }

    if (retryFile) {
      this._postMessage({
        type: "status",
        text: `Falling back to full-file rewrite for: ${retryFile.path}`
      });
      return this.agent.applyChanges(
        retryFile.path,
        retryFile.content,
        outside,
        effectiveWriteOptions
      );
    }

    this._postMessage({
      type: "status",
      text: `Patch retry was still not reliable for ${action.path}. Requesting a complete file rewrite...`
    });

    const fileFallbackResponse = await this._requestEditRecovery(
      this._buildFileFallbackPrompt(
        originalRequest,
        action,
        currentContent,
        retryResponse.text
      ),
      workspaceFolder,
      "File fallback",
      runtimeConfig
    );

    if (fileFallbackResponse.error) {
      return {
        success: false,
        error: `FILE fallback failed for ${action.path}: ${fileFallbackResponse.error}`
      };
    }

    const fileAction = this._findEditActionForPath(
      fileFallbackResponse.actions,
      action.path,
      "file"
    );

    if (!fileAction) {
      return {
        success: false,
        error: `Automatic recovery for ${action.path} did not produce a valid FILE action.`
      };
    }

    this._postMessage({
      type: "status",
      text: `Applying full-file fallback to: ${fileAction.path}`
    });

    return this.agent.applyChanges(
      fileAction.path,
      fileAction.content,
      outside,
      effectiveWriteOptions
    );
  }

  _buildPatchedContent(currentContent, searchContent, replaceContent) {
    const source = String(currentContent || "");
    const search = String(searchContent || "");
    const replace = String(replaceContent || "");
    const countOccurrences = (haystack, needle) => {
      if (!needle) return 0;
      let count = 0;
      let index = 0;
      while ((index = haystack.indexOf(needle, index)) !== -1) {
        count += 1;
        index += Math.max(needle.length, 1);
      }
      return count;
    };

    if (!search) {
      return { matched: false, reason: "empty_search" };
    }

    // Splice without going through String.prototype.replace, which would
    // interpret $&, $1, $`, $', $$ inside the replacement when the search
    // arg is a string. Real source code can legitimately contain those
    // sequences, so we slice on the matched index instead.
    const literalSplice = (haystack, needle, repl) => {
      const idx = haystack.indexOf(needle);
      return haystack.slice(0, idx) + repl + haystack.slice(idx + needle.length);
    };

    if (source.includes(search)) {
      const exactMatchCount = countOccurrences(source, search);
      if (exactMatchCount !== 1) {
        return {
          matched: false,
          reason: "ambiguous_search",
          matchCount: exactMatchCount
        };
      }
      return {
        matched: true,
        content: literalSplice(source, search, replace)
      };
    }

    const normalizeLineEndings = (text) => text.replace(/\r\n/g, "\n");
    const currentUnix = normalizeLineEndings(source);
    const searchUnix = normalizeLineEndings(search);
    const replaceUnix = normalizeLineEndings(replace);
    const prefersCrlf = source.includes("\r\n");

    if (currentUnix.includes(searchUnix)) {
      const normalizedMatchCount = countOccurrences(currentUnix, searchUnix);
      if (normalizedMatchCount !== 1) {
        return {
          matched: false,
          reason: "ambiguous_search",
          matchCount: normalizedMatchCount
        };
      }
      let content = literalSplice(currentUnix, searchUnix, replaceUnix);
      if (prefersCrlf) {
        content = content.replace(/\n/g, "\r\n");
      }
      return { matched: true, content };
    }

    const normalizeWhitespace = (text) => text.replace(/\s+/g, " ").trim();
    const normalizedCurrent = normalizeWhitespace(source);
    const normalizedSearch = normalizeWhitespace(search);

    if (!normalizedSearch || !normalizedCurrent.includes(normalizedSearch)) {
      return { matched: false, reason: "search_not_found" };
    }

    const whitespaceAwarePattern = new RegExp(
      search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
    );
    const whitespaceAwareMatches =
      source.match(
        new RegExp(
          search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
          "g"
        )
      ) || [];
    if (whitespaceAwareMatches.length !== 1) {
      return {
        matched: false,
        reason: "ambiguous_search",
        matchCount: whitespaceAwareMatches.length
      };
    }
    const content = source.replace(whitespaceAwarePattern, () => replace);

    if (content === source) {
      return { matched: false, reason: "search_not_found" };
    }

    return { matched: true, content };
  }

  _readWorkspaceScripts(workspaceFolder) {
    if (!workspaceFolder) return {};
    const packageJsonPath = path.join(workspaceFolder, "package.json");
    if (!fsSync.existsSync(packageJsonPath)) return {};
    try {
      const raw = fsSync.readFileSync(packageJsonPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.scripts === "object" && parsed.scripts
        ? parsed.scripts
        : {};
    } catch (_) {
      return {};
    }
  }

  _getPostEditVerificationCommands(workspaceFolder) {
    const scripts = this._readWorkspaceScripts(workspaceFolder);
    const ordered = [
      { script: "lint", command: "npm run lint", priority: 1 },
      { script: "typecheck", command: "npm run typecheck", priority: 1 },
      { script: "build", command: "npm run build", priority: 2 },
      { script: "test", command: "npm test", priority: 3 }
    ];

    // Return all available checks, prioritized
    return ordered
      .filter((item) => !!scripts[item.script])
      .sort((a, b) => a.priority - b.priority)
      .map((item) => item.command);
  }

  _summarizeCommandOutput(output) {
    const text = (output || "").trim();
    if (!text) return "";
    const lines = text.split(/\r?\n/).slice(0, 8);
    return lines.join("\n");
  }

  _isEditLikeIntent(intent, message) {
    return !!this.agent?._shouldTreatAsEditIntent?.(intent, message || "");
  }

  _hasExplicitCommandRequest(message) {
    return /\b(run|execute|exec|terminal|shell|command|cmd|powershell|bash|zsh|fish|npm|npx|pnpm|yarn|node|python|pytest|jest|eslint|git|rg|ripgrep|grep|findstr|select-string|get-content|cat|ls|dir)\b/i.test(
      message || ""
    );
  }

  _isContextInspectionCommand(command) {
    const normalized = String(command || "").trim().toLowerCase();
    if (!normalized) return false;
    return /^(rg|grep|findstr|select-string|sls|get-content|gc|get-childitem|gci|get-item|gi|resolve-path|dir|ls|pwd|tree|type|cat|head|tail|find|which|where)\b/.test(
      normalized
    ) || /^(git\s+(status|diff|show|log|branch|rev-parse)\b)/.test(normalized) ||
      /^(npm(\.cmd)?\s+(list|ls|outdated|audit|explain|query|pkg|root|prefix|view)\b)/.test(normalized) ||
      /^(pnpm(\.cmd)?\s+(list|outdated|why)\b)/.test(normalized) ||
      /^(yarn(\.cmd)?\s+(list|why|info)\b)/.test(normalized);
  }

  _isVerificationCommand(command) {
    const normalized = String(command || "").trim().toLowerCase();
    if (!normalized) return false;
    return /^(npm(\.cmd)?\s+(test\b|run\s+(lint|typecheck|build|test|check|verify|validate)\b))/.test(
      normalized
    ) || /^(pnpm(\.cmd)?\s+(test\b|run\s+(lint|typecheck|build|test|check|verify|validate)\b))/.test(
      normalized
    ) || /^(yarn(\.cmd)?\s+(test\b|run\s+(lint|typecheck|build|test|check|verify|validate)\b))/.test(
      normalized
    ) || /^(node\s+--check\b|python3?\s+-m\s+(py_compile|flake8|pylint|pytest|unittest)\b|pytest\b|eslint\b|tsc\b|javac\b)/.test(
      normalized
    ) || /^(mvn\s+(clean|compile|test|package|verify)\b|gradle\s+(clean|build|test)\b|cargo\s+(build|test|check|run)\b|go\s+(build|test|run)\b|dotnet\s+(build|test|run)\b|arduino-cli\s+(compile|lib\s+list|lib\s+search|board\s+list)\b)/.test(
      normalized
    );
  }

  _isInspectionAction(action) {
    if (!action || typeof action.type !== "string") {
      return false;
    }

    if (action.type === "read") {
      return typeof action.path === "string" && action.path.trim().length > 0;
    }

    if (action.type === "grep") {
      return typeof action.query === "string" && action.query.trim().length > 0;
    }

    if (action.type === "cmd") {
      return this._isContextInspectionCommand(action.command);
    }

    return false;
  }

  _hasOnlyInspectionActions(actions = []) {
    return Array.isArray(actions) &&
      actions.length > 0 &&
      actions.every((action) => this._isInspectionAction(action));
  }

  _formatInspectionTranscript(label, content, language = "") {
    const source = String(content || "");
    if (!source.trim()) {
      return `${label}\n\`\`\`${language}\n[no output]\n\`\`\``;
    }

    if (source.length <= MAX_INSPECTION_RESULT_CHARS) {
      return `${label}\n\`\`\`${language}\n${source}\n\`\`\``;
    }

    const headChars = Math.max(6000, Math.floor(MAX_INSPECTION_RESULT_CHARS * 0.6));
    const tailChars = Math.max(3000, MAX_INSPECTION_RESULT_CHARS - headChars);
    const head = source.slice(0, headChars);
    const tail = source.slice(-tailChars);
    const omitted = Math.max(0, source.length - head.length - tail.length);

    return `${label}\n\`\`\`${language}\n${head}\n...\n[truncated ${omitted} chars]\n...\n${tail}\n\`\`\``;
  }

  _buildInspectionMatcher(query) {
    const raw = String(query || "").trim();
    if (!raw) {
      return {
        description: "",
        test: () => false
      };
    }

    const regexMatch = raw.match(/^\/([\s\S]+)\/([dgimsuvy]*)$/);
    if (regexMatch) {
      try {
        const flags = regexMatch[2].replace(/g/g, "");
        const regex = new RegExp(regexMatch[1], flags);
        return {
          description: raw,
          test: (line) => regex.test(line)
        };
      } catch {
        // Fall back to literal matching below.
      }
    }

    const lowered = raw.toLowerCase();
    return {
      description: raw,
      test: (line) => String(line || "").toLowerCase().includes(lowered)
    };
  }

  _displayInspectionPath(workspaceFolder, fullPath, fallbackPath = "") {
    if (!fullPath) {
      return String(fallbackPath || "");
    }
    if (!workspaceFolder) {
      return fullPath.replace(/\\/g, "/");
    }

    const relativePath = path.relative(workspaceFolder, fullPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return fullPath.replace(/\\/g, "/");
    }

    return relativePath.replace(/\\/g, "/");
  }

  async _runReadInspectionAction(action, workspaceFolder) {
    const targetPath = String(action?.path || "").trim();
    if (!targetPath) {
      return {
        success: false,
        transcript: this._formatInspectionTranscript(
          "READ: [invalid path]",
          "Error: READ path was empty."
        )
      };
    }

    const fullPath = this._resolveActionFilePath(workspaceFolder, targetPath);
    const editor = this._findEditorForFile(fullPath) || this._getCurrentFileEditor();
    let content = "";

    try {
      if (
        editor?.document?.uri?.scheme === "file" &&
        path.resolve(editor.document.fileName) === path.resolve(fullPath)
      ) {
        content = editor.document.getText();
      } else {
        content = await fs.readFile(fullPath, "utf8");
      }
    } catch (error) {
      const displayPath = this._displayInspectionPath(
        workspaceFolder,
        fullPath,
        targetPath
      );
      return {
        success: false,
        transcript: this._formatInspectionTranscript(
          `READ: ${displayPath}`,
          `Error: ${error.message}`
        )
      };
    }

    const displayPath = this._displayInspectionPath(
      workspaceFolder,
      fullPath,
      targetPath
    );
    const language = path.extname(displayPath).replace(/^\./, "");
    return {
      success: true,
      transcript: this._formatInspectionTranscript(
        `READ: ${displayPath}`,
        content,
        language
      )
    };
  }

  async _runGrepInspectionAction(action, workspaceFolder) {
    const query = String(action?.query || "").trim();
    if (!query) {
      return {
        success: false,
        transcript: this._formatInspectionTranscript(
          "GREP: [empty query]",
          "Error: GREP query was empty."
        )
      };
    }

    if (!workspaceFolder) {
      return {
        success: false,
        transcript: this._formatInspectionTranscript(
          `GREP: ${query}`,
          "Error: GREP requires an open workspace."
        )
      };
    }

    await this.agent.ensureCodebaseScanned(workspaceFolder);
    const matcher = this._buildInspectionMatcher(query);
    const matches = [];

    for (const [relativePath, fileData] of this.agent.codebaseContext.entries()) {
      const content = String(fileData?.content || "");
      if (!content) continue;

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!matcher.test(line)) continue;

        matches.push(
          `${relativePath}:${index + 1}: ${String(line || "").trim().slice(0, 220)}`
        );
        if (matches.length >= MAX_INSPECTION_MATCHES) {
          break;
        }
      }

      if (matches.length >= MAX_INSPECTION_MATCHES) {
        break;
      }
    }

    const output = matches.length > 0
      ? matches.join("\n")
      : "No matches found in indexed workspace files.";

    return {
      success: matches.length > 0,
      transcript: this._formatInspectionTranscript(
        `GREP: ${matcher.description || query}`,
        output,
        "text"
      )
    };
  }

  async _runInspectionCommandAction(action, workspaceFolder) {
    const command = String(action?.command || "").trim();
    if (!command) {
      return {
        success: false,
        transcript: this._formatInspectionTranscript(
          "CMD: [empty command]",
          "Error: inspection command was empty."
        )
      };
    }

    if (!this._isContextInspectionCommand(command)) {
      return {
        success: false,
        transcript: this._formatInspectionTranscript(
          `CMD: ${command}`,
          "Error: only read-only inspection commands can run in the grounding phase."
        )
      };
    }

    const validation = this.agent.validateCommand(command);
    if (!validation.allowed) {
      return {
        success: false,
        transcript: this._formatInspectionTranscript(
          `CMD: ${command}`,
          `Error: ${validation.reason}`
        )
      };
    }

    const result = await this.agent.executeCommand(command, workspaceFolder);
    const output = result.success
      ? result.output || "Done."
      : `${result.error || "Command failed"}${result.output ? `\n${result.output}` : ""}`;
    return {
      success: result.success,
      transcript: this._formatInspectionTranscript(
        `CMD: ${command}`,
        output,
        "text"
      )
    };
  }

  async _runInspectionAction(action, workspaceFolder) {
    if (action?.type === "read") {
      return this._runReadInspectionAction(action, workspaceFolder);
    }
    if (action?.type === "grep") {
      return this._runGrepInspectionAction(action, workspaceFolder);
    }
    if (action?.type === "cmd") {
      return this._runInspectionCommandAction(action, workspaceFolder);
    }
    return {
      success: false,
      transcript: this._formatInspectionTranscript(
        `UNKNOWN: ${action?.type || "action"}`,
        "Error: unsupported inspection action."
      )
    };
  }

  _buildInspectionFollowUpPrompt(originalRequest, inspectionResults = []) {
    const transcript = inspectionResults
      .map((result) => String(result?.transcript || "").trim())
      .filter(Boolean)
      .join("\n\n");

    return `You are continuing an edit request after a real workspace inspection round.
Return executable structured actions only.

Original user request:
${originalRequest}

Inspection results:
${transcript || "[no inspection output]"}

Now continue the professional edit loop:
- Use the inspection results above as ground truth.
- If you now have enough evidence, return PATCH: or FILE: actions to make the change.
- Prefer PATCH for existing files and keep SEARCH blocks unique.
- Preserve unrelated code, comments, formatting, and behavior.
- Add focused verification CMD: only when it materially proves the fix.
- Do not repeat the same READ:, GREP:, or inspection CMD: actions unless the earlier result failed or was insufficient.
- Do not output explanations.`;
  }

  async _runAgenticInspectionRound(
    originalRequest,
    actions,
    workspaceFolder,
    runtimeConfig,
    requestMode
  ) {
    const inspectionActions = Array.isArray(actions)
      ? actions.filter((action) => this._isInspectionAction(action))
      : [];
    if (inspectionActions.length === 0) {
      return {
        error: "No inspection actions were available to run."
      };
    }

    const inspectionResults = [];
    for (const action of inspectionActions) {
      inspectionResults.push(await this._runInspectionAction(action, workspaceFolder));
    }

    const nextMode = requestMode === "fast" ? "heavy" : requestMode;
    return this.agent.chat(
      this._buildInspectionFollowUpPrompt(originalRequest, inspectionResults),
      workspaceFolder,
      null,
      null,
      {
        mode: nextMode,
        intentOverride: "edit",
        interactionStyle: this._getInteractionStyleForRequest(true),
        runtimeConfig,
        skipHistory: true,
        onStatus: (text) => {
          if (this._shouldSuppressInternalStatus(text)) {
            return;
          }
          this._postMessage({
            type: "status",
            text: `Inspection follow-up: ${text}`
          });
        }
      }
    );
  }

  _shouldSuppressGeneratedCommand(
    isEditLikeIntent,
    hasExplicitCommandRequest,
    actions = [],
    command = ""
  ) {
    if (!isEditLikeIntent || hasExplicitCommandRequest) {
      return false;
    }

    const hasEditAction = Array.isArray(actions)
      ? actions.some(
          (action) => action && (action.type === "file" || action.type === "patch")
        )
      : false;

    if (!hasEditAction) {
      return false;
    }

    return !this._isContextInspectionCommand(command) &&
      !this._isVerificationCommand(command);
  }

  _getGStackGateMode() {
    const rawMode = String(
      vscode.workspace
        .getConfiguration("codeJanitor.ai")
        .get("gstackGateMode", "smart") || "smart"
    )
      .trim()
      .toLowerCase();

    return rawMode === "off" || rawMode === "always" ? rawMode : "smart";
  }

  _normalizeGStackGateMode(mode) {
    const rawMode = String(mode || "")
      .trim()
      .toLowerCase();
    return rawMode === "off" || rawMode === "always" ? rawMode : "smart";
  }

  _postGStackGateModeState(mode = this._getGStackGateMode()) {
    this._postMessage({
      type: "gstackGateModeState",
      value: this._normalizeGStackGateMode(mode)
    });
  }

  _postAutoHealState() {
    this._postMessage({
      type: "autoHealState",
      ...this.performanceMonitor.getAutoHealUiState()
    });
  }

  _getEditableActions(actions = []) {
    return Array.isArray(actions)
      ? actions.filter(
          (action) =>
            action &&
            (action.type === "file" ||
              action.type === "patch" ||
              action.type === "mkdir")
        )
      : [];
  }

  _hasOversizedGateFileAction(actions = []) {
    return this._getEditableActions(actions).some(
      (action) =>
        action?.type === "file" &&
        typeof action.content === "string" &&
        action.content.length > GSTACK_GATE_MAX_FILE_REVIEW_CHARS
    );
  }

  _isRiskyEditPath(filePath) {
    const normalized = String(filePath || "")
      .replace(/\\/g, "/")
      .toLowerCase();

    if (!normalized) {
      return false;
    }

    return /(^|\/)(package(-lock)?\.json|readme\.md|src\/extension\.js|src\/ai-agent\/agent\.js|src\/ai-agent\/chat-panel\.(js|html)|src\/core\/|scripts\/)/i.test(
      normalized
    );
  }

  _isDocumentationPath(filePath) {
    const normalized = String(filePath || "")
      .replace(/\\/g, "/")
      .toLowerCase();

    if (!normalized) {
      return false;
    }

    return (
      normalized.endsWith(".md") ||
      normalized.startsWith("docs/") ||
      /(^|\/)(readme|changelog|contributing|license)(\.[a-z0-9]+)?$/i.test(
        normalized
      )
    );
  }

  _getGStackGateDecision(
    requestText,
    actions = [],
    options = {}
  ) {
    const gateMode =
      typeof options.gateMode === "string" && options.gateMode.trim()
        ? options.gateMode.trim().toLowerCase()
        : this._getGStackGateMode();
    const editableActions = this._getEditableActions(actions);

    if (
      gateMode === "off" ||
      editableActions.length === 0
    ) {
      return {
        enabled: false,
        gateMode,
        editableActions,
        reasons: []
      };
    }

    // The gate prompt intentionally truncates large FILE contents for review.
    // If we let the gate rewrite those actions, it can accidentally replace a
    // full-file plan with a partial one derived from the truncated preview.
    if (this._hasOversizedGateFileAction(actions)) {
      return {
        enabled: false,
        gateMode,
        editableActions,
        reasons: []
      };
    }

    if (gateMode === "always") {
      return {
        enabled: true,
        gateMode,
        editableActions,
        reasons: ["always mode"]
      };
    }

    if (options.requestMode === "bugfix" || options.requestMode === "audit") {
      return {
        enabled: false,
        gateMode,
        editableActions,
        reasons: []
      };
    }

    const touchedFiles = Array.from(
      new Set(
        editableActions
          .map((action) => String(action.path || "").trim())
          .filter(Boolean)
      )
    );
    const isSingleDocEdit =
      touchedFiles.length === 1 &&
      touchedFiles.every((filePath) => this._isDocumentationPath(filePath));
    if (isSingleDocEdit && !actions.some((action) => action?.type === "cmd")) {
      return {
        enabled: false,
        gateMode,
        editableActions,
        reasons: []
      };
    }
    const reasons = [];
    const text = String(requestText || "");

    if (touchedFiles.length > 1) {
      reasons.push("multiple files");
    }
    if (editableActions.some((action) => action.type === "file")) {
      reasons.push("full-file rewrite or creation");
    }
    if (actions.some((action) => action?.type === "cmd")) {
      reasons.push("command execution alongside edits");
    }
    if (touchedFiles.some((filePath) => this._isRiskyEditPath(filePath))) {
      reasons.push("high-impact path");
    }
    if (
      /\b(refactor|rewrite|migrate|architecture|auth|authentication|authorization|database|schema|state management|router|provider|config|deployment|build pipeline|release)\b/i.test(
        text
      )
    ) {
      reasons.push("high-risk request");
    }
    if (
      editableActions.some(
        (action) =>
          action.type === "patch" &&
          Math.max(
            String(action.search || "").length,
            String(action.replace || "").length
          ) > 1800
      )
    ) {
      reasons.push("large patch");
    }

    return {
      enabled: reasons.length > 0,
      gateMode,
      editableActions,
      reasons
    };
  }

  _truncateGateSnippet(text, maxChars = 1800) {
    const value = String(text || "");
    if (value.length <= maxChars) {
      return value;
    }

    const headChars = Math.max(Math.floor(maxChars * 0.7), 900);
    const tailChars = Math.max(maxChars - headChars, 300);
    return `${value.slice(0, headChars)}\n...\n[truncated ${value.length - headChars - tailChars} chars]\n...\n${value.slice(-tailChars)}`;
  }

  async _buildGStackGatePrompt(
    requestText,
    actions,
    workspaceFolder,
    reasons = []
  ) {
    const sections = [
      "Review these planned Code Janitor edits before execution.",
      "Reply with EXACTLY `APPROVE` if the plan is safe and well-scoped.",
      "If changes are required, return a complete replacement set of executable structured actions only.",
      `Original user request:\n${requestText}`
    ];

    if (reasons.length > 0) {
      sections.push(`Why this was gated:\n- ${reasons.join("\n- ")}`);
    }

    const planLines = [];
    for (const action of actions || []) {
      if (!action) continue;
      if (action.type === "file") {
        planLines.push(`FILE ${action.path || "(missing path)"}`);
      } else if (action.type === "patch") {
        planLines.push(`PATCH ${action.path || "(missing path)"}`);
      } else if (action.type === "mkdir") {
        planLines.push(`MKDIR ${action.path || "(missing path)"}`);
      } else if (action.type === "cmd") {
        planLines.push(`CMD ${action.command || "(missing command)"}`);
      }
    }
    if (planLines.length > 0) {
      sections.push(`Planned actions:\n${planLines.map((line) => `- ${line}`).join("\n")}`);
    }

    const detailBlocks = [];
    for (const action of (actions || []).slice(0, 6)) {
      if (!action) continue;
      if (action.type === "file") {
        detailBlocks.push(
          [
            `FILE target: ${action.path}`,
            "Planned content:",
            "```",
            this._truncateGateSnippet(action.content, 2200),
            "```"
          ].join("\n")
        );
        continue;
      }

      if (action.type === "patch") {
        let currentContext = "";
        if (workspaceFolder && action.path) {
          try {
            const fullPath = this._resolveActionFilePath(workspaceFolder, action.path);
            const currentContent = await fs.readFile(fullPath, "utf8");
            currentContext = this._buildRecoveryFileContext(action.path, currentContent);
          } catch (_) {
            currentContext = `Current file content for ${action.path} could not be loaded.`;
          }
        }

        detailBlocks.push(
          [
            `PATCH target: ${action.path}`,
            "SEARCH:",
            "```",
            this._truncateGateSnippet(action.search, 1200),
            "```",
            "REPLACE:",
            "```",
            this._truncateGateSnippet(action.replace, 1600),
            "```",
            currentContext
          ]
            .filter(Boolean)
            .join("\n")
        );
        continue;
      }

      if (action.type === "cmd") {
        detailBlocks.push(`CMD:\n\`\`\`\n${action.command || ""}\n\`\`\``);
      }
    }

    if (detailBlocks.length > 0) {
      sections.push(detailBlocks.join("\n\n"));
    }

    return sections.join("\n\n");
  }

  async _runGStackEditGate(
    requestText,
    response,
    workspaceFolder,
    runtimeConfig,
    options = {}
  ) {
    const decision = this._getGStackGateDecision(requestText, response?.actions, {
      gateMode: options.gateMode,
      requestMode: options.requestMode,
      explicitWorkflowId: options.explicitWorkflowId
    });

    if (!decision.enabled) {
      return {
        response,
        gateApplied: false,
        gateApproved: false,
        gateRevised: false
      };
    }

    const reasonText = decision.reasons.join(", ");
    this._postMessage({
      type: "status",
      text: `GStack edit gate: reviewing plan before execution${reasonText ? ` (${reasonText})` : ""}...`
    });

    const reviewPrompt = await this._buildGStackGatePrompt(
      requestText,
      response.actions,
      workspaceFolder,
      decision.reasons
    );
    const gateResponse = await this.agent.chat(
      reviewPrompt,
      workspaceFolder,
      null,
      null,
      {
        mode: "heavy",
        intentOverride: "edit",
        runtimeConfig,
        systemOverlay: buildGStackEditGateOverlay(),
        skipHistory: true,
        onStatus: (text) => {
          if (this._shouldSuppressGStackGateStatus(text)) {
            return;
          }
          this._postMessage({
            type: "status",
            text: `GStack edit gate: ${text}`
          });
        }
      }
    );

    if (gateResponse.error) {
      this._postMessage({
        type: "status",
        text: `GStack edit gate failed open: ${gateResponse.error}`
      });
      return {
        response,
        gateApplied: true,
        gateApproved: false,
        gateRevised: false
      };
    }

    const gateText = String(gateResponse.text || "").trim();
    const revisedActions = Array.isArray(gateResponse.actions)
      ? gateResponse.actions
      : [];
    const hasRevisedActions = revisedActions.length > 0;
    const approved =
      !hasRevisedActions &&
      /^approve$/i.test(gateText.replace(/[`*_]/g, "").trim());

    if (approved) {
      this._postMessage({
        type: "status",
        text: "GStack edit gate approved the plan."
      });
      return {
        response,
        gateApplied: true,
        gateApproved: true,
        gateRevised: false
      };
    }

    if (hasRevisedActions) {
      this._postMessage({
        type: "status",
        text: `GStack edit gate revised the plan (${revisedActions.length} action(s)).`
      });
      return {
        response: {
          ...response,
          text: gateResponse.text || response.text,
          actions: revisedActions,
          warnings: [
            ...(response.warnings || []),
            "GStack edit gate revised the execution plan before applying changes."
          ]
        },
        gateApplied: true,
        gateApproved: false,
        gateRevised: true
      };
    }

    this._postMessage({
      type: "status",
      text: "GStack edit gate returned non-executable feedback, continuing with the original plan."
    });
    return {
      response,
      gateApplied: true,
      gateApproved: false,
      gateRevised: false
    };
  }

  _isMermaidRequest(message) {
    const text = message || "";
    return /\b(mermaid|flowchart|sequence diagram|class diagram|er diagram|gantt|state diagram|diagram)\b/i.test(text) &&
      /\b(generate|create|make|draw|show|render|build|produce|give me)\b/i.test(text);
  }

  _showMermaidPreview(title, mermaidCode) {
    const panel = vscode.window.createWebviewPanel(
      "codeJanitorMermaid",
      `Diagram: ${title}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const escaped = mermaidCode
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { margin: 0; background: #1e1e1e; color: #d4d4d4; font-family: "Segoe UI", sans-serif; }
    #toolbar { padding: 8px 14px; background: #252526; border-bottom: 1px solid #3c3c3c; display: flex; align-items: center; gap: 10px; }
    #toolbar span { font-size: 12px; color: #9d9d9d; }
    button { padding: 4px 12px; background: #0e639c; color: #fff; border: none; border-radius: 3px; font-size: 11px; cursor: pointer; }
    button:hover { background: #1177bb; }
    #diagram { padding: 24px; display: flex; justify-content: center; min-height: calc(100vh - 42px); }
    .mermaid { background: #fff; border-radius: 8px; padding: 24px; max-width: 100%; }
    #error { display: none; padding: 16px; background: #5a1d1d; color: #f48771; border-radius: 6px; margin: 16px; font-size: 12px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="toolbar">
    <span>${title}</span>
    <button onclick="copyCode()">Copy Code</button>
    <button onclick="downloadSvg()">Download SVG</button>
  </div>
  <div id="error"></div>
  <div id="diagram"><div class="mermaid">${escaped}</div></div>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });
    window.addEventListener("DOMContentLoaded", async () => {
      try {
        await mermaid.run({ nodes: document.querySelectorAll(".mermaid") });
      } catch (e) {
        const err = document.getElementById("error");
        err.style.display = "block";
        err.textContent = "Render error: " + e.message;
      }
    });
    window.copyCode = () => navigator.clipboard.writeText(${JSON.stringify(mermaidCode)});
    window.downloadSvg = () => {
      const svg = document.querySelector(".mermaid svg");
      if (!svg) return;
      const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "diagram.svg";
      a.click();
    };
  </script>
</body>
</html>`;
    return panel;
  }

  _extractMermaidCode(text) {
    // Extract from ```mermaid ... ``` block
    const fenced = text.match(/```mermaid\s*\n([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    // Extract from ``` ... ``` if it starts with a mermaid keyword
    const generic = text.match(/```[\w]*\s*\n((?:graph|flowchart|sequenceDiagram|classDiagram|erDiagram|gantt|stateDiagram|pie|gitGraph)[\s\S]*?)```/);
    if (generic) return generic[1].trim();
    return null;
  }

  _isSyntaxQuestion(message) {
    const text = message || "";
    return (
      /\b(syntax error|syntax errors|syntax issue|syntax issues|parse error|compile error|compile errors)\b/i.test(text) &&
      /\b(is there|are there|check|do we have|does this have|does the file have|any)\b/i.test(text)
    ) || /\b(check|scan|look for|find)\b.*\bsyntax errors?\b/i.test(text);
  }

  _isLibraryAuditRequest(message) {
    const text = message || "";
    return (
      /\b(check|scan|find|compare|audit|verify)\b.*\b(librar(?:y|ies)|#include|import(?:ed|s)?)\b/i.test(text) &&
      /\b(installed|missing|not installed|install|imported|included)\b/i.test(text)
    ) || /\bwhich libraries are installed\b/i.test(text);
  }

  _isSyntaxFixRequest(message) {
    const text = message || "";
    return (
      /\b(fix|repair|resolve|correct|patch)\b/i.test(text) &&
      /\b(syntax error|syntax errors|syntax issue|syntax issues|parse error|compile error|compile errors)\b/i.test(text)
    ) || /\bfix\b.*\b(current|active|open|this)\s+(file|tab|editor)\b/i.test(text);
  }

  _isExplicitBugScanRequest(message) {
    const text = (message || "").trim();
    if (!text) return false;
    if (/^\/bugfix$/i.test(text)) return false;
    return (
      /\b(check|scan|run|do)\b[^\n]*\bbugs?\b/i.test(text) ||
      /\bbug\s+(check|scan)\b/i.test(text) ||
      /\bany\s+bugs\??/i.test(text) ||
      /\bfind\s+bugs?\b/i.test(text) ||
      /\bfix\s+(?:the\s+|all\s+)?bugs?\b/i.test(text) ||
      /^bugs?\??$/i.test(text)
    );
  }

  _shouldPrepareWorkspaceContext(intent, message, mode = this.chatMode) {
    if (mode === "bugfix") return false;
    if (mode === "heavy" || mode === "deep") return true;

    const text = message || "";
    if (intent === "scan") return true;

    return /\b(codebase|repo|repository|project|workspace|all files|multiple files|architecture|graph|graphify|overview|summari[sz]e|audit)\b/i.test(
      text
    );
  }

  _isReadmePath(filePath) {
    return path.basename((filePath || "").toLowerCase()) === "readme.md";
  }

  _isDocTruncateGuardError(errorText) {
    return /Refusing to heavily truncate documentation/i.test(errorText || "");
  }

  async _retryReadmeRewrite(trimmedText, workspaceFolder, writeOptions) {
    const retryPrompt = `The previous README.md update was rejected because it would heavily truncate documentation.
Return exactly one FILE action for README.md with complete file content that preserves existing sections while applying the requested update.
Do not output CMD or MKDIR.

Original request:
${trimmedText}`;

    const response = await this.agent.chat(
      retryPrompt,
      workspaceFolder,
      null,
      null,
      {
        mode: this.chatMode,
        skipHistory: true,
        onStatus: (text) => {
          if (this._shouldSuppressInternalStatus(text)) {
            return;
          }
          this._postMessage({
            type: "status",
            text: `README retry: ${text}`
          });
        }
      }
    );

    if (response.error) {
      return { success: false, error: response.error };
    }

    const readmeAction = (response.actions || []).find(
      (action) =>
        action.type === "file" &&
        this._isReadmePath(action.path) &&
        typeof action.content === "string" &&
        action.content.trim().length > 0
    );

    if (!readmeAction) {
      return {
        success: false,
        error: "README retry did not produce a valid FILE: README.md action."
      };
    }

    return this.agent.applyChanges(
      readmeAction.path,
      readmeAction.content,
      false,
      this._withWorkspaceRoot(writeOptions, workspaceFolder)
    );
  }

  async _runPreEditDiagnostics(workspaceFolder, filePath, actionType = "file") {
    if (!workspaceFolder || !filePath) {
      return { success: true, diagnostics: [] };
    }

    const results = { success: true, diagnostics: [], fileInfo: {} };
    const fullPath = this._resolveActionFilePath(workspaceFolder, filePath);
    const ext = path.extname(filePath).toLowerCase();
    const relativePath = path
      .relative(workspaceFolder, fullPath)
      .replace(/\\/g, "/");
    const isOutsideWorkspace =
      relativePath.startsWith("..") || path.isAbsolute(relativePath);

    // Get file status
    try {
      const stat = await fs.stat(fullPath);
      results.fileInfo = {
        exists: true,
        size: stat.size,
        modified: stat.mtime,
        readable: true
      };
    } catch (err) {
      results.fileInfo = { exists: false, error: err.message };
      if (actionType === "patch") {
        results.diagnostics.push({
          type: "missing",
          message: "Patch target does not exist yet."
        });
        results.success = false;
      }
      return results;
    }

    // Check git status for this file (only show if modified)
    const gitRoot = !isOutsideWorkspace
      ? await this._findGitRoot(fullPath)
      : null;
    const gitRelativePath = gitRoot
      ? path.relative(gitRoot, fullPath).replace(/\\/g, "/")
      : "";
    const gitStatus = gitRoot && gitRelativePath
      ? await this.agent.executeCommand(
          `git status --short "${gitRelativePath}"`,
          gitRoot
        )
      : null;
    if (gitStatus?.success && gitStatus.output.trim()) {
      const status = gitStatus.output.trim();
      // Only report if file has uncommitted changes
      if (status.startsWith('M ') || status.startsWith('A ') || status.startsWith('D ')) {
        results.diagnostics.push({
          type: "git",
          status: status,
          message: `Git: ${status}`
        });
      }
    }

    // Run syntax check only for code files
    if (['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.html', '.htm'].includes(ext)) {
      const syntaxCheck = await this.agent._runSyntaxCheck(fullPath, workspaceFolder, null);
      if (syntaxCheck && !syntaxCheck.skipped && !syntaxCheck.success) {
        // Only report syntax errors, not successes
        results.diagnostics.push({
          type: "syntax",
          passed: false,
          message: `Syntax error: ${(syntaxCheck.error || syntaxCheck.output).substring(0, 200)}`
        });
        results.success = false;
      }
    }

    return results;
  }

  async _runPostEditVerification(
    workspaceFolder,
    changedFiles,
    runtimeConfig = null,
    writeOptions = {}
  ) {
    if (!workspaceFolder || !Array.isArray(changedFiles) || changedFiles.length === 0) {
      return { success: true, checks: [] };
    }

    const results = { success: true, checks: [], errors: [] };

    // Categorize changed files by type
    const fileTypes = {
      js: changedFiles.filter(file => /\.(js|jsx|ts|tsx)$/i.test(file)),
      css: changedFiles.filter(file => /\.(css|scss|sass|less)$/i.test(file)),
      py: changedFiles.filter(file => /\.py$/i.test(file)),
      java: changedFiles.filter(file => /\.java$/i.test(file)),
      html: changedFiles.filter(file => /\.html?$/i.test(file)),
      c: changedFiles.filter(file => /\.(c|cpp|h|hpp)$/i.test(file))
    };

    // Run syntax checks for each file type and auto-repair when we can.
    for (const [lang, files] of Object.entries(fileTypes)) {
      if (files.length === 0 || lang === 'c') continue; // Skip C/C++ (needs compiler)
      
      for (const file of files) {
        const fullPath = path.join(workspaceFolder, file);
        const result = await this.agent._runSyntaxCheck(fullPath, workspaceFolder, null);
        
        if (result && !result.success && !result.skipped) {
          this._postMessage({
            type: "status",
            text: `\u26a0\ufe0f Syntax error in ${file}. Attempting automatic repair...`
          });

          const repairResult = await this._repairSyntaxForWorkspaceFile(
            file,
            workspaceFolder,
            result,
            writeOptions,
            runtimeConfig
          );

          if (repairResult.success && repairResult.applyResult?.success) {
            const syntaxUndoId = !repairResult.applyResult.created
              ? this._registerEditForUndo({
                  filePath: repairResult.applyResult.path || file,
                  before: repairResult.applyResult.previousContent,
                  after: repairResult.applyResult.newContent,
                  label: "syntax-fix"
                })
              : null;
            this._postMessage({
              type: "applied",
              filePath: repairResult.applyResult.path,
              undoId: syntaxUndoId,
              text: `\u2705 Auto-fixed syntax in ${repairResult.applyResult.relativePath || file}\n${repairResult.applyResult.changeSummary || ""}`
            });
            this._postFixInsights(
              repairResult.applyResult.path || file,
              repairResult.applyResult.previousContent,
              repairResult.applyResult.newContent,
              {
                syntaxErrorOutput: result.error || result.output || "",
                verificationPassed: true,
                knownSyntaxBefore: false,
                knownSyntaxAfter: true
              }
            );
            await this._revealWorkspaceFile(repairResult.applyResult.path);
            results.checks.push({
              file,
              check: `${lang}-syntax-auto-fix`,
              passed: true
            });
            continue;
          }

          results.success = false;
          results.errors.push({ 
            file, 
            error: String(
              repairResult.error || result.error || result.output || "Unknown syntax error"
            ).substring(0, 300), 
            type: "syntax" 
          });
          this._postMessage({
            type: "status",
            text: `⚠️ Syntax error in ${file}`
          });
        } else if (result && result.success) {
          results.checks.push({ file, check: `${lang}-syntax`, passed: true });
        }
      }
    }

    const frontendFiles = Array.from(
      new Set([...fileTypes.html, ...fileTypes.css, ...fileTypes.js])
    );
    for (const file of frontendFiles) {
      const verification = await this._runFrontendVerificationForFile(
        workspaceFolder,
        file
      );
      if (!verification.success) {
        results.success = false;
        results.errors.push({
          file,
          error: verification.error,
          type: "frontend"
        });
        this._postMessage({
          type: "status",
          text: `Frontend validation found issues in ${file}`
        });
        continue;
      }

      results.checks.push({
        file,
        check: "frontend-dependencies",
        passed: true
      });
    }

    // Warn about C/C++ files (need manual compilation)
    if (fileTypes.c.length > 0) {
      this._postMessage({
        type: "status",
        text: `⚠️ C/C++ files changed: ${fileTypes.c.join(", ")}. Run compiler to verify.`
      });
    }

    // Run npm scripts only for JS/TS files
    if (fileTypes.js.length === 0) {
      if (results.errors.length === 0) {
        this._postMessage({
          type: "status",
          text: "✅ Verification complete"
        });
      }
      return results;
    }

    const commands = this._getPostEditVerificationCommands(workspaceFolder);
    if (commands.length === 0) {
      if (results.errors.length === 0) {
        this._postMessage({
          type: "status",
          text: "✅ Verification complete (no npm scripts configured)"
        });
      }
      return results;
    }

    this._postMessage({
      type: "status",
      text: `Running ${commands.length} verification check(s)...`
    });

    // Run all checks, don't stop on first failure
    for (const command of commands) {
      const validation = this.agent.validateCommand(command);
      if (!validation.allowed) {
        continue;
      }

      const result = await this.agent.executeCommand(command, workspaceFolder);
      if (result.success) {
        results.checks.push({ command, passed: true });
      } else {
        results.success = false;
        results.errors.push({ 
          command, 
          error: (result.error || result.output).substring(0, 500), 
          type: "npm" 
        });
        this._postMessage({
          type: "status",
          text: `⚠️ ${command} failed`
        });
      }
    }

    // Summary
    if (results.success) {
      this._postMessage({
        type: "status",
        text: `✅ All checks passed (${results.checks.length} checks)`
      });
    } else {
      this._postMessage({
        type: "status",
        text: `⚠️ ${results.errors.length} error(s) found. Review changes before committing.`
      });
    }

    return results;
  }

  async _runFrontendVerificationForFile(workspaceFolder, relativePath) {
    try {
      const fullPath = path.join(workspaceFolder, relativePath);
      const content = await fs.readFile(fullPath, "utf8");
      const validation = new FrontendValidator(fullPath, content).validate();
      if (!validation.hasIssues) {
        return { success: true, issues: [] };
      }

      const summary = validation.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join("; ");

      return {
        success: false,
        issues: validation.issues,
        error: `${validation.issues.length} frontend issue(s): ${summary}`
      };
    } catch (error) {
      return {
        success: false,
        issues: [],
        error: `Frontend validation failed for ${relativePath}: ${error.message}`
      };
    }
  }

  async _fetchAndSendModels(forceProvider = null) {
    let provider = forceProvider || "ollama";
    
    try {
      const config = await this._getEffectiveAiConfig();
      provider = forceProvider || config.provider;

      const customProvider = this._getCustomProviderById(provider);
      const effectiveCustomProvider = config.customProvider || customProvider;
      const keyByProvider = {
        groq: config.groqApiKey,
        openrouter: config.openrouterApiKey,
        anthropic: config.anthropicApiKey,
        nvidia: config.nvidiaApiKey
      };
      const needsKey = provider !== "ollama" && (this._isBuiltInProvider(provider) || customProvider);
      const hasKey = !needsKey || !!(customProvider ? effectiveCustomProvider?.apiKey : keyByProvider[provider]);
      const defaultModels = this._getFallbackModelsForProvider(provider);

      if (defaultModels.length > 0 && this.panel) {
        this._postMessage({
          type: "setModelOptions",
          models: defaultModels,
          provider
        });
      }

      if (!hasKey) {
        console.log(`[ChatPanel] Skipping model discovery for ${provider}: API key is not configured`);
        return;
      }
      
      console.log(`[ChatPanel] Discovering live models from ${provider}...`);
      this.agent.getAvailableModelsForProvider(provider, {
        ollamaUrl: config.ollamaUrl,
        groqApiKey: config.groqApiKey,
        openrouterApiKey: config.openrouterApiKey,
        anthropicApiKey: config.anthropicApiKey,
        nvidiaApiKey: config.nvidiaApiKey,
        timeoutMs: 8_000,
        forceRefresh: true,
        customProvider: effectiveCustomProvider
      }).then(models => {
        if (models.length > 0 && this.panel) {
          console.log(`[ChatPanel] Discovered ${models.length} live models for ${provider}`);
          this._postMessage({ type: "setModelOptions", models, provider });
        } else if (defaultModels.length > 0 && this.panel) {
          this._postMessage({
            type: "setModelOptions",
            models: defaultModels,
            provider
          });
          this._postMessage({
            type: "status",
            text: `Could not discover live ${provider} models. Showing fallback models.`
          });
        }
      }).catch(err => {
        console.warn(`[ChatPanel] Live model discovery failed for ${provider}:`, err.message);
        if (defaultModels.length > 0 && this.panel) {
          this._postMessage({
            type: "setModelOptions",
            models: defaultModels,
            provider
          });
        }
      });
      
    } catch (err) {
      console.error(`[ChatPanel] Critical error in _fetchAndSendModels:`, err);
      // Still send defaults even if config fails
      const defaultModels = this._getFallbackModelsForProvider(provider);
      
      if (this.panel) {
        this._postMessage({
          type: "setModelOptions",
          models: defaultModels,
          provider
        });
      }
    }
  }

  _getModelsForInitialProviderState(provider) {
    const models = this._getFallbackModelsForProvider(provider);
    return models.length > 0 ? models : null;
  }

  _getDefaultModelForProvider(provider) {
    if (provider === "ollama") return OLLAMA_FALLBACK_MODELS[0];
    if (provider === "nvidia") return "meta/llama-3.1-8b-instruct";
    const customProvider = this._getCustomProviderById(provider);
    if (customProvider?.defaultModel) return customProvider.defaultModel;
    const providerModels = MODELS_BY_PROVIDER[provider];
    return Array.isArray(providerModels) && providerModels.length > 0
      ? providerModels[0]
      : OLLAMA_FALLBACK_MODELS[0];
  }

  _getImageInputCapability(provider, model) {
    const customProvider = this._getCustomProviderById(provider);
    const enabled = this.agent._modelSupportsImageInput(
      {
        provider,
        model,
        customProvider
      },
      model
    );

    return {
      imageInputEnabled: enabled,
      imageInputReason: enabled
        ? "Attach images for vision-capable models."
        : "Selected model does not appear to support image input. Switch to a vision-capable model or remove attachments."
    };
  }

  _postImageInputCapability(provider, model) {
    if (!this.panel) return;
    const capability = this._getImageInputCapability(provider, model);

    this._postMessage({
      type: "setImageInputAvailability",
      enabled: capability.imageInputEnabled,
      reason: capability.imageInputReason
    });
  }

  _getProviderModelStateKey(provider) {
    return `codeJanitor.ai.lastModel.${provider || "unknown"}`;
  }

  _saveProviderModel(provider, model) {
    if (!provider || !model) return;
    this.context.globalState.update(this._getProviderModelStateKey(provider), model);
  }

  _getSavedProviderModel(provider) {
    if (!provider) return "";
    return this.context.globalState.get(this._getProviderModelStateKey(provider), "");
  }

  _getConfigTargetForKey(key) {
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const inspected = cfg.inspect(key);
    const hasWorkspaceOverride =
      inspected &&
      (inspected.workspaceValue !== undefined ||
        inspected.workspaceFolderValue !== undefined);

    if (hasWorkspaceOverride && vscode.workspace.workspaceFolders?.length) {
      return vscode.ConfigurationTarget.Workspace;
    }

    return vscode.ConfigurationTarget.Global;
  }

  async _updateAiConfig(key, value) {
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const target = this._getConfigTargetForKey(key);
    await cfg.update(key, value, target);
    return cfg;
  }

  _getModelConfigKey(provider) {
    return provider === "nvidia" ? "nvidiaModel" : "model";
  }

  _normalizeModelForProvider(provider, model) {
    const raw = typeof model === "string" ? model.trim() : "";
    const defaultModel = this._getDefaultModelForProvider(provider);
    if (!raw) return defaultModel;

    if (provider === "nvidia") {
      return this.agent._sanitizeNvidiaModel(raw);
    }

    const customProvider = this._getCustomProviderById(provider);
    const allowedModels = customProvider?.models?.length
      ? customProvider.models
      : MODELS_BY_PROVIDER[provider];
    if (Array.isArray(allowedModels) && allowedModels.length > 0) {
      return allowedModels.includes(raw) ? raw : defaultModel;
    }

    return raw;
  }

  async _setProviderModel(provider, model) {
    const nextModel = this._normalizeModelForProvider(provider, model);
    if (this._isBuiltInProvider(provider)) {
      await this._updateAiConfig(this._getModelConfigKey(provider), nextModel);

      // Keep the generic model in sync so status UI and older code paths stay aligned.
      await this._updateAiConfig("model", nextModel);
    }

    this._saveProviderModel(provider, nextModel);
    return nextModel;
  }

  async _searchYouTube(query) {
    try {
      console.log(`[YouTube] Searching for: ${query}`);
      
      // Scrape YouTube search results page
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      
      try {
        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          const html = await response.text();
          
          // Extract video IDs from YouTube's initial data
          const videoIds = [];
          const videoTitles = [];
          
          // Method 1: Extract from ytInitialData JSON
          const ytDataMatch = html.match(/var ytInitialData = (\{.+?\});/);
          if (ytDataMatch) {
            try {
              const ytData = JSON.parse(ytDataMatch[1]);
              const contents = ytData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
              
              if (contents) {
                for (const section of contents) {
                  const items = section?.itemSectionRenderer?.contents || [];
                  for (const item of items) {
                    const videoRenderer = item?.videoRenderer;
                    if (videoRenderer?.videoId) {
                      videoIds.push(videoRenderer.videoId);
                      videoTitles.push(videoRenderer.title?.runs?.[0]?.text || "YouTube Video");
                      if (videoIds.length >= 5) break;
                    }
                  }
                  if (videoIds.length >= 5) break;
                }
              }
            } catch (parseError) {
              console.log("[YouTube] Failed to parse ytInitialData:", parseError.message);
            }
          }
          
          // Method 2: Regex fallback - extract from watch URLs
          if (videoIds.length === 0) {
            const watchMatches = html.matchAll(/\/watch\?v=([a-zA-Z0-9_-]{11})/g);
            const seenIds = new Set();
            for (const match of watchMatches) {
              if (!seenIds.has(match[1])) {
                videoIds.push(match[1]);
                videoTitles.push("YouTube Video");
                seenIds.add(match[1]);
                if (videoIds.length >= 5) break;
              }
            }
          }
          
          if (videoIds.length > 0) {
            console.log(`[YouTube] Scraped ${videoIds.length} videos from search page`);
            const videos = videoIds.map((id, index) => ({
              videoId: id,
              title: videoTitles[index] || "YouTube Video",
              url: `https://www.youtube.com/watch?v=${id}`
            }));
            return { videos };
          }
        }
      } catch (scrapeError) {
        console.log("[YouTube] Scraping failed:", scrapeError.message);
      }
      
      // Fallback: Try Invidious API
      const instances = ["https://invidious.io.lol", "https://inv.tux.pizza"];
      
      for (const instance of instances) {
        try {
          const apiUrl = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort=relevance`;
          const apiResponse = await fetch(apiUrl, {
            headers: { "User-Agent": "Code-Janitor/1.0" },
            signal: AbortSignal.timeout(2000)
          });

          if (apiResponse.ok) {
            const data = await apiResponse.json();
            if (Array.isArray(data) && data.length > 0) {
              const videos = data.slice(0, 5).map(video => ({
                videoId: video.videoId,
                title: video.title,
                url: `https://www.youtube.com/watch?v=${video.videoId}`
              }));
              return { videos };
            }
          }
        } catch (instanceError) {
          continue;
        }
      }
      
      // Final fallback: Return YouTube search link
      console.log("[YouTube] All methods failed, using search link");
      const videos = [{
        title: `Search "${query}" on YouTube`,
        url: searchUrl,
        isSearchLink: true
      }];
      
      return { videos };
    } catch (error) {
      console.error("[YouTube] Search error:", error);
      const fallbackVideos = this._getFallbackYouTubeVideos(query);
      if (fallbackVideos.length > 0) {
        return { 
          videos: fallbackVideos,
          fallback: true,
          message: "Showing popular videos (search API unavailable)"
        };
      }
      return { error: `Failed to search YouTube: ${error.message}` };
    }
  }

  _getFallbackYouTubeVideos(query) {
    const keywords = query.toLowerCase();
    const fallbackMap = {
      "vscode": [
        { videoId: "B-s71n0dHUk", title: "VS Code Tutorial for Beginners", url: "https://www.youtube.com/watch?v=B-s71n0dHUk" },
        { videoId: "WPqXP_kLzpo", title: "VS Code Crash Course", url: "https://www.youtube.com/watch?v=WPqXP_kLzpo" }
      ],
      "arduino": [
        { videoId: "nL34zDTPkcs", title: "Arduino Tutorial for Beginners", url: "https://www.youtube.com/watch?v=nL34zDTPkcs" },
        { videoId: "fJWR7dBuc18", title: "Arduino Programming Tutorial", url: "https://www.youtube.com/watch?v=fJWR7dBuc18" }
      ],
      "thunder": [
        { videoId: "fKopy74weus", title: "Imagine Dragons - Thunder (Official Music Video)", url: "https://www.youtube.com/watch?v=fKopy74weus" },
        { videoId: "W0DM5lcj6mw", title: "Imagine Dragons - Thunder (Lyrics)", url: "https://www.youtube.com/watch?v=W0DM5lcj6mw" }
      ],
      "imagine dragons": [
        { videoId: "fKopy74weus", title: "Imagine Dragons - Thunder", url: "https://www.youtube.com/watch?v=fKopy74weus" },
        { videoId: "ktvTqknDobU", title: "Imagine Dragons - Radioactive", url: "https://www.youtube.com/watch?v=ktvTqknDobU" },
        { videoId: "7wtfhZwyrcc", title: "Imagine Dragons - Believer", url: "https://www.youtube.com/watch?v=7wtfhZwyrcc" }
      ],
      "javascript": [
        { videoId: "PkZNo7MFNFg", title: "JavaScript Tutorial for Beginners", url: "https://www.youtube.com/watch?v=PkZNo7MFNFg" },
        { videoId: "W6NZfCO5SIk", title: "JavaScript Programming - Full Course", url: "https://www.youtube.com/watch?v=W6NZfCO5SIk" }
      ],
      "python": [
        { videoId: "_uQrJ0TkZlc", title: "Python Tutorial - Full Course", url: "https://www.youtube.com/watch?v=_uQrJ0TkZlc" },
        { videoId: "rfscVS0vtbw", title: "Learn Python - Full Course", url: "https://www.youtube.com/watch?v=rfscVS0vtbw" }
      ],
      "react": [
        { videoId: "Ke90Tje7VS0", title: "React Course - Beginner Tutorial", url: "https://www.youtube.com/watch?v=Ke90Tje7VS0" },
        { videoId: "bMknfKXIFA8", title: "React Tutorial for Beginners", url: "https://www.youtube.com/watch?v=bMknfKXIFA8" }
      ],
      "music": [
        { videoId: "fKopy74weus", title: "Imagine Dragons - Thunder", url: "https://www.youtube.com/watch?v=fKopy74weus" },
        { videoId: "ktvTqknDobU", title: "Imagine Dragons - Radioactive", url: "https://www.youtube.com/watch?v=ktvTqknDobU" }
      ]
    };
    
    // Try exact match first
    for (const [key, videos] of Object.entries(fallbackMap)) {
      if (keywords.includes(key)) {
        return videos;
      }
    }
    
    // Try partial match for programming topics
    if (keywords.includes("tutorial") || keywords.includes("learn") || keywords.includes("course")) {
      if (keywords.includes("js") || keywords.includes("javascript")) {
        return fallbackMap["javascript"];
      }
      if (keywords.includes("py") || keywords.includes("python")) {
        return fallbackMap["python"];
      }
      if (keywords.includes("code") || keywords.includes("vscode") || keywords.includes("vs code")) {
        return fallbackMap["vscode"];
      }
    }
    
    return [];
  }



  _setupMessageHandler(webview) {
    if (!webview || this._boundWebviews.has(webview)) return;
    this._boundWebviews.add(webview);
    webview.onDidReceiveMessage(async (message) => {
      console.log("[ChatPanel] Received message:", message.type);
      const workspaceFolder = this._getEffectiveWorkspaceFolder();

      if (message.type === "chat") {
        try {
          console.log("[ChatPanel] Processing chat message:", message.text?.substring(0, 50));
          const trimmedText = (message.text || "").trim();
        let requestText = trimmedText;
        let requestMode = this._getRequestMode();
        let systemOverlay = "";
        let activeRuntimeConfig = null;

        if (/^\/undo\b/i.test(trimmedText) || this._isUndoRequest(trimmedText)) {
          await this._undoEdit();
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/ollama$/i.test(trimmedText)) {
          await this._updateAiConfig("provider", "ollama");
          await this._updateAiConfig("model", this._getDefaultModelForProvider("ollama"));
          this._postMessage({ type: "status", text: "Provider forced to Ollama. Reloading..." });
          await this._fetchAndSendModels("ollama");
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/fast$/i.test(trimmedText)) {
          this.chatMode = "fast";
          this._postMessage({ type: "status", text: "Mode switched to Fast." });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/heavy$/i.test(trimmedText)) {
          this.chatMode = "heavy";
          this._postMessage({ type: "status", text: "Mode switched to Heavy." });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/deep$/i.test(trimmedText)) {
          this.chatMode = "deep";
          this._postMessage({ type: "status", text: "Mode switched to Deep." });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/audit$/i.test(trimmedText)) {
          // /audit is no longer a mode — the silent preamble runs the audit
          // automatically on every request in every mode. Show a notice so
          // users who type /audit out of habit understand it's already on.
          this._postMessage({
            type: "status",
            text: "Audit runs automatically on every message — no /audit mode needed. Malicious patterns trigger %%AUDIT_HALTED%% in any mode."
          });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/bugfix$/i.test(trimmedText)) {
          this.chatMode = "bugfix";
          this._postMessage({
            type: "status",
            text: "Mode switched to Bug Fixer. Press Alt+B to scan the active file, or just chat — every message runs the scan loop."
          });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/think$/i.test(trimmedText)) {
          await this._setThinkingMode(!this.showThinking);
          this._postMessage({
            type: "status",
            text: `Thinking mode ${this.showThinking ? "enabled" : "disabled"}.`
          });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/scan$/i.test(trimmedText)) {
          this._postMessage({ type: "status", text: "Scanning workspace..." });
          this._postMessage({ type: "thinking" });
          const overview = await this.agent.getCodebaseOverview(workspaceFolder);
          this._postMessage({ type: "stream", text: overview });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/ping$/i.test(trimmedText)) {
          this._postMessage({ type: "status", text: "Testing AI connection..." });
          this._postMessage({ type: "thinking" });
          const config = await this._getEffectiveAiConfig();
          try {
            if (config.provider === "ollama") {
              const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
              if (res.ok) {
                const data = await res.json();
                const models = (data.models || []).map(m => m.name);
                this._postMessage({ 
                  type: "stream", 
                  text: `Ollama is running at ${config.ollamaUrl}\n\nAvailable models: ${models.join(", ") || "none"}\n\nCurrent model: ${config.model}` 
                });
              } else {
                this._postMessage({ type: "error", text: `Ollama returned status ${res.status}` });
              }
            } else {
              this._postMessage({ type: "stream", text: `Provider: ${config.provider}\nModel: ${config.model}\nTimeout: ${config.timeout}ms` });
            }
          } catch (err) {
            this._postMessage({ type: "error", text: `Connection failed: ${err.message}\n\nMake sure Ollama is running: ollama serve` });
          }
          this._postMessage({ type: "done" });
          return;
        }

        const gstackRequest = this._resolveGStackRequest(trimmedText);
        const explicitWorkflowId = gstackRequest?.workflow?.id || "";
        const workflowIntentOverride = gstackRequest?.intentOverride || "";
        const workflowForceStructuredEdits =
          gstackRequest?.forceStructuredEdits === true;
        if (gstackRequest?.type === "help") {
          this._postMessage({ type: "stream", text: buildGStackHelpText() });
          this._postMessage({ type: "done" });
          return;
        }
        if (gstackRequest?.type === "workflow") {
          requestText = gstackRequest.userMessage;
          requestMode = gstackRequest.mode || requestMode;
          systemOverlay = gstackRequest.systemOverlay || "";
          this._postMessage({
            type: "status",
            text: gstackRequest.statusText
          });
        }

        const intent =
          workflowIntentOverride || this.agent._detectIntent(requestText);
        const isEditLikeIntent = this._isEditLikeIntent(intent, requestText);
        let hasExplicitCommandRequest = this._hasExplicitCommandRequest(requestText);
        const wantsActiveFileEdit = /\b(current|open|active)\s+(file|tab|editor)\b/i.test(requestText);
        const hasExplicitDestructiveWriteIntent =
          /\b(delete|remove|clear|empty|truncate|wipe|blank\s*out)\b/i.test(requestText);
        const writeOptions = {
          allowEmpty: hasExplicitDestructiveWriteIntent,
          allowDocTruncate: hasExplicitDestructiveWriteIntent
        };

        // In audit/bugfix modes, skip auto-routing interceptors so the
        // mode-specific system instruction controls the response. Without
        // this guard, the Alt+B trigger ("bug fix loop on the active file")
        // gets caught by _isSyntaxFixRequest and routed to syntax-fix.
        const isModeWithCustomSystemPrompt =
          requestMode === "audit" || requestMode === "bugfix";

        if (!isModeWithCustomSystemPrompt && this._isSyntaxFixRequest(requestText)) {
          await this._runActiveSyntaxFix(workspaceFolder);
          return;
        }

        if (
          !isModeWithCustomSystemPrompt &&
          this._isExplicitBugScanRequest(requestText) &&
          requestMode !== "bugfix"
        ) {
          const editor = this._getCurrentFileEditor() || vscode.window.activeTextEditor;
          await this.runBugScan(editor);
          return;
        }

        if (!isModeWithCustomSystemPrompt && this._isMermaidRequest(requestText)) {
          this._postMessage({ type: "thinking" });
          this._postMessage({ type: "status", text: "Generating diagram..." });
          const runtimeConfig = await this._getEffectiveAiConfig();
          const activeEditor = this._getCurrentFileEditor();
          const fileContext = activeEditor
            ? `\n\nActive file: ${path.basename(activeEditor.document.fileName)}\n\`\`\`\n${activeEditor.document.getText().slice(0, 4000)}\n\`\`\``
            : "";
          const mermaidPrompt = `${requestText}${fileContext}\n\nReturn ONLY a mermaid code block. No explanations outside the code block.`;
          const mermaidResponse = await this.agent.chat(
            mermaidPrompt,
            workspaceFolder,
            (chunk) => { this._postMessage({ type: "stream", text: chunk }); },
            this.abortController?.signal,
            { mode: "fast", runtimeConfig, onStatus: (text) => { this._postMessage({ type: "status", text }); } }
          );
          this._postMessage({ type: "done" });
          if (!mermaidResponse.error) {
            const code = this._extractMermaidCode(mermaidResponse.text || "");
            if (code) {
              const diagramTitle = path.basename(activeEditor?.document?.fileName || "diagram");
              this._showMermaidPreview(diagramTitle, code);
              this._postMessage({ type: "status", text: "✅ Diagram opened in preview panel." });
            }
          }
          return;
        }

        if (!isModeWithCustomSystemPrompt && this._isSyntaxQuestion(requestText)) {
          const activeOnly = /\b(active|current|open|this)\s+(file|tab|editor)\b/i.test(requestText) ||
            !/\b(workspace|repo|repository|project|codebase|all files|entire project)\b/i.test(requestText);
          const activeEditor = this._getCurrentFileEditor();
          const activeFiles =
            activeOnly && workspaceFolder && activeEditor
              ? [path.relative(workspaceFolder, activeEditor.document.fileName).replace(/\\/g, "/")]
              : null;
          await this._runSyntaxScan(
            workspaceFolder,
            activeFiles
          );
          return;
        }

        if (!isModeWithCustomSystemPrompt && this._isLibraryAuditRequest(requestText)) {
          await this._runLibraryAudit(workspaceFolder);
          return;
        }

        const directStructuredResponse = this.agent._parseResponse(requestText);
        if (this.chatMode === "audit" && Array.isArray(directStructuredResponse.actions)) {
          const blockedTypes = new Set(["file", "patch", "cmd", "mkdir"]);
          const stripped = directStructuredResponse.actions.filter((a) => !blockedTypes.has(a?.type));
          if (stripped.length !== directStructuredResponse.actions.length) {
            this._postMessage({
              type: "status",
              text: "Audit mode: ignoring pasted FILE/PATCH/CMD/MKDIR blocks. The pasted code will be audited instead of executed."
            });
          }
          directStructuredResponse.actions = stripped;
        }
        const hasDirectStructuredActions =
          Array.isArray(directStructuredResponse.actions) &&
          directStructuredResponse.actions.length > 0;
        if (
          hasDirectStructuredActions &&
          directStructuredResponse.actions.some((action) => action.type === "cmd")
        ) {
          hasExplicitCommandRequest = true;
        }

        let response = directStructuredResponse;
        let streamController = null;
        if (hasDirectStructuredActions) {
          this._postMessage({
            type: "status",
            text: "Executing structured actions from chat input..."
          });
        } else {
          this.agent.setActiveEditor(this.lastActiveEditor || vscode.window.activeTextEditor);
          if (workspaceFolder && this._shouldPrepareWorkspaceContext(intent, requestText, requestMode)) {
            const forcePrep =
              requestMode === "heavy" ||
              requestMode === "deep" ||
              intent === "scan";
            this._postMessage({ type: "status", text: "Studying workspace before responding..." });
            const prep = await this.agent.prepareWorkspaceContext(requestText, workspaceFolder, { force: forcePrep });
            this._postMessage({
              type: "status",
              text: `Studied workspace: indexed ${prep.indexedFiles} file(s).`
            });
            if (prep.activeFile) {
              this._postMessage({
                type: "status",
                text: `Active file in focus: ${prep.activeFile}`
              });
            }
            if (prep.relevantFiles.length > 0) {
              this._postMessage({
                type: "status",
                text: `Relevant files: ${prep.relevantFiles.slice(0, 5).join(", ")}${prep.relevantFiles.length > 5 ? ` +${prep.relevantFiles.length - 5} more` : ""}`
              });
            }
            if (["edit", "debug", "refactor"].includes(intent)) {
              const gitRoot = await this._findGitRoot(
                this._getCurrentFileEditor()?.document?.fileName || workspaceFolder
              );
              if (gitRoot) {
                const gitStatus = await this.agent.executeCommand("git status --short", gitRoot);
                if (gitStatus.success) {
                  this._postMessage({
                    type: "status",
                    text: this._summarizeGitStatus(gitStatus.output)
                  });
                }
              }
            }
          }
          this._postMessage({ type: "thinking" });
          this._userStoppedGeneration = false;
          this.abortController = new AbortController();

          // Add timeout warning for slow models
          const config = await this._getEffectiveAiConfig();
          activeRuntimeConfig = config;
          const timeoutMs = config.timeout || 300000;
          
          // Warn immediately for known slow models
          if (config.model === "minimaxai/minimax-m2.7") {
            this._postMessage({ 
              type: "status", 
              text: "Warning: MiniMax M2.7 can be slow. Consider switching to meta/llama-3.1-8b-instruct for faster responses." 
            });
          }
          
          const warningTimer = setTimeout(() => {
            if (this.abortController && !this.abortController.signal.aborted) {
              this._postMessage({ 
                type: "status", 
                text: `Model is taking longer than expected. This may be normal for ${config.model}. You can stop generation anytime.` 
              });
            }
          }, 30000); // Warn after 30 seconds

          const startTime = Date.now();
          try {
            console.log("[ChatPanel] Starting agent.chat with config:", {
              provider: config.provider,
              model: config.model,
              timeout: timeoutMs,
              mode: requestMode
            });
            streamController = this._createStreamDisplayController({
              bufferStructuredActions: isEditLikeIntent
            });
            this._consumeQueuedModeOverride();
            response = await this.agent.chat(
              requestText,
              workspaceFolder,
              (chunk) => {
                streamController.push(chunk);
              },
              this.abortController.signal,
              {
                mode: requestMode,
                systemOverlay,
                intentOverride: workflowIntentOverride || undefined,
                interactionStyle: this._getInteractionStyleForRequest(
                  isEditLikeIntent
                ),
                forceStructuredEdits: workflowForceStructuredEdits,
                runtimeConfig: config,
                images: Array.isArray(message.images) ? message.images : [],
                onStatus: (text) => {
                  if (this._shouldSuppressInternalStatus(text)) {
                    return;
                  }
                  this._postMessage({ type: "status", text });
                }
              }
            );
            
            // Record performance
            const duration = Date.now() - startTime;
            this.performanceMonitor.recordResponse(
              config.provider,
              config.model,
              duration,
              !response.error
            );
            this._postAutoHealState();
          } catch (chatError) {
            console.error("[ChatPanel] Error in agent.chat:", chatError);
            this._handleChatStreamFailure(chatError, streamController);
            return;
          } finally {
            clearTimeout(warningTimer);
            this.abortController = null;
            this._userStoppedGeneration = false;
          }
        }

        if (response.error) {
          this._postMessage({ type: "error", text: response.error });
          this._postMessage({ type: "done" });
          return;
        }

        streamController?.ensureFinalTextVisible(
          this._buildVisibleAssistantText(response, {
            preferStructuredSummary: isEditLikeIntent
          }),
          {
            rawText: typeof response.text === "string" ? response.text : ""
          }
        );
        this._postAssistantImages(response.images);

        this._postMessage({ type: "done" });
        this._postSessionState();

        if (this.chatMode === "audit") {
          if (Array.isArray(response.actions) && response.actions.length > 0) {
            const blockedTypes = new Set(["file", "patch", "cmd", "mkdir"]);
            const stripped = response.actions.filter((a) => !blockedTypes.has(a?.type));
            const removed = response.actions.length - stripped.length;
            if (removed > 0) {
              this._postMessage({
                type: "status",
                text: `Audit mode is read-only — blocked ${removed} file/command action(s) from the model output.`
              });
            }
            response.actions = stripped;
          }
          if (typeof response.text === "string" && /⛔\s*AUDIT HALTED/.test(response.text)) {
            await this._appendAuditRefusalLog(workspaceFolder, trimmedText, response.text);
          }
        }

        // Code Janitor Master Protocol: AUDIT_HALTED in ANY mode cancels all
        // pending file/command actions and logs the refusal.
        if (typeof response.text === "string" && /%%AUDIT_HALTED%%/.test(response.text)) {
          if (Array.isArray(response.actions) && response.actions.length > 0) {
            const blockedTypes = new Set(["file", "patch", "cmd", "mkdir"]);
            const stripped = response.actions.filter((a) => !blockedTypes.has(a?.type));
            const removed = response.actions.length - stripped.length;
            if (removed > 0) {
              this._postMessage({
                type: "status",
                text: `⛔ Audit halted — blocked ${removed} file/command action(s) from the model output.`
              });
            }
            response.actions = stripped;
          }
          await this._appendAuditRefusalLog(workspaceFolder, trimmedText, response.text);
        }

        const blockedIncompleteStructuredExecution =
          this._shouldBlockIncompleteStructuredExecution(response);

        if (
          response.warnings &&
          response.warnings.length > 0 &&
          !blockedIncompleteStructuredExecution
        ) {
          for (const warning of response.warnings) {
            this._postMessage({ type: "status", text: warning });
          }
        }

        if (blockedIncompleteStructuredExecution) {
          this._postMessage({
            type: "error",
            text:
              response.text ||
              "Structured edit output was incomplete, so Code Janitor blocked the generated file changes."
          });
          return;
        }

        const debugConfig = vscode.workspace.getConfiguration("codeJanitor.ai");
        const showParsedActionsDebug = debugConfig.get("showParsedActionsDebug", false);

        if (showParsedActionsDebug && response.actions && response.actions.length > 0) {
          const actionSummary = response.actions.map(a => {
            if (a.type === "graphify") return "graphify:open";
            if (a.type === "preview_inspect") return "preview:inspect";
            return `${a.type}:${a.path || a.query || a.command || ""}`;
          }).join(", ");
          this._postMessage({ type: "status", text: `Parsed ${response.actions.length} action(s): ${actionSummary}` });
        }

        if (response.actions && response.actions.length > 0) {
          let inspectionRounds = 0;
          while (
            isEditLikeIntent &&
            this._hasOnlyInspectionActions(response.actions) &&
            inspectionRounds < MAX_AGENTIC_INSPECTION_ROUNDS
          ) {
            inspectionRounds += 1;
            this._postMessage({
              type: "status",
              text: `Inspection round ${inspectionRounds}: gathering workspace evidence before editing...`
            });
            response = await this._runAgenticInspectionRound(
              requestText,
              response.actions,
              workspaceFolder,
              activeRuntimeConfig || (await this._getEffectiveAiConfig()),
              requestMode
            );
            if (!response || response.error) {
              this._postMessage({
                type: "error",
                text: response?.error || "Inspection follow-up failed."
              });
              return;
            }
          }

          if (
            !hasDirectStructuredActions &&
            isEditLikeIntent &&
            !this._hasOnlyInspectionActions(response.actions)
          ) {
            const gateResult = await this._runGStackEditGate(
              requestText,
              response,
              workspaceFolder,
              activeRuntimeConfig || (await this._getEffectiveAiConfig()),
              {
                requestMode,
                explicitWorkflowId
              }
            );
            response = gateResult.response;
          }

          const hasFileAction = response.actions.some(
            (action) =>
              (action.type === "file" &&
              typeof action.content === "string" &&
              action.content.trim().length > 0) ||
              (action.type === "patch" &&
              typeof action.search === "string" &&
              typeof action.replace === "string")
          );
          const hasPreviewInspectionAction = response.actions.some(
            (action) => action.type === "preview_inspect"
          ) || (
            response.actions.some((action) => action.type === "preview") &&
            this._shouldInspectPreviewRequest(requestText)
          );
          if (isEditLikeIntent && !hasFileAction && !hasPreviewInspectionAction) {
            this._postMessage({
              type: "status",
              text: "Blocked execution: edit requests must include at least one PATCH or FILE action."
            });
            this._postMessage({
              type: "error",
              text: "No executable file edits were generated. Please retry with the target file path and expected change."
            });
            return;
          }

          if (!workspaceFolder) {
            this._postMessage({
              type: "status",
              text: "No workspace is open. Generated files will open as drafts and will not be auto-saved."
            });

            for (const action of response.actions) {
              if (action.type === "file") {
                const activeEditor = this.lastActiveEditor || vscode.window.activeTextEditor;
                const shouldApplyToOpenFile =
                  wantsActiveFileEdit &&
                  activeEditor &&
                  activeEditor.document.uri.scheme === "file";
                this._postMessage({
                  type: "status",
                  text: shouldApplyToOpenFile
                    ? `Editing open file: ${path.basename(activeEditor.document.fileName)}`
                    : `Opening draft: ${action.path}`
                });
                const result = shouldApplyToOpenFile
                  ? await this._applyToEditor(activeEditor, action.content)
                  : await this._openDraftFile(action.path, action.content);
                const undoId = result.success && shouldApplyToOpenFile
                  ? this._registerEditForUndo({
                      filePath: result.path || action.path,
                      before: result.previousContent,
                      after: result.newContent,
                      label: "edit"
                    })
                  : null;
                this._postMessage({
                  type: result.success ? "applied" : "error",
                  filePath: result.success ? result.path : undefined,
                  undoId,
                  text: result.success
                    ? shouldApplyToOpenFile
                      ? `\u2705 Updated open file ${result.relativePath || result.path}`
                      : `\u2705 Opened draft ${result.path}`
                    : result.error
                });
                if (result.success && shouldApplyToOpenFile) {
                  this._postFixInsights(
                    result.path || action.path,
                    result.previousContent,
                    result.newContent
                  );
                }
              } else if (action.type === "patch") {
                const activeEditor = this.lastActiveEditor || vscode.window.activeTextEditor;
                const activeFileName = activeEditor?.document?.fileName || "";
                const activeNormalized = activeFileName
                  .replace(/\\/g, "/")
                  .toLowerCase();
                const targetNormalized = String(action.path || "")
                  .replace(/\\/g, "/")
                  .toLowerCase();
                const targetBaseName = path.basename(targetNormalized);
                const canPatchOpenFile =
                  !!activeEditor &&
                  !!activeEditor.document &&
                  (wantsActiveFileEdit ||
                    !targetNormalized ||
                    activeNormalized === targetNormalized ||
                    activeNormalized.endsWith(`/${targetNormalized}`) ||
                    path.basename(activeNormalized) === targetBaseName);

                if (!canPatchOpenFile) {
                  this._postMessage({
                    type: "error",
                    text: `Cannot patch ${action.path}: open the target file or use a workspace so PATCH actions can be applied.`
                  });
                  continue;
                }

                const patchResult = this._buildPatchedContent(
                  activeEditor.document.getText(),
                  action.search,
                  action.replace
                );
                if (!patchResult.matched) {
                  this._postMessage({
                    type: "error",
                    text:
                      patchResult.reason === "empty_search"
                        ? `Cannot patch ${action.path}: SEARCH block is empty.`
                        : patchResult.reason === "ambiguous_search"
                          ? `Cannot patch ${action.path}: SEARCH matched ${patchResult.matchCount || "multiple"} locations. Make the SEARCH block more specific so it matches exactly once.`
                        : `Cannot patch ${action.path}: SEARCH content not found in the open file.`
                  });
                  continue;
                }

                this._postMessage({
                  type: "status",
                  text: `Applying patch to open file: ${path.basename(activeFileName || action.path)}`
                });
                const result = await this._applyToEditor(
                  activeEditor,
                  patchResult.content
                );
                const undoId = result.success
                  ? this._registerEditForUndo({
                      filePath: result.path || action.path,
                      before: result.previousContent,
                      after: result.newContent,
                      label: "patch"
                    })
                  : null;
                this._postMessage({
                  type: result.success ? "applied" : "error",
                  filePath: result.success ? result.path : undefined,
                  undoId,
                  text: result.success
                    ? `\u2705 Patched open file ${result.relativePath || result.path}`
                    : result.error
                });
                if (result.success) {
                  this._postFixInsights(
                    result.path || action.path,
                    result.previousContent,
                    result.newContent
                  );
                }
              } else if (action.type === "mkdir") {
                this._postMessage({
                  type: "status",
                  text: `Skipped folder creation for ${action.path}. Save the draft files where you want them.`
                });
              } else if (action.type === "cmd") {
                if (
                  this._shouldSuppressGeneratedCommand(
                    isEditLikeIntent,
                    hasExplicitCommandRequest,
                    response.actions,
                    action.command
                  )
                ) {
                  this._postMessage({
                    type: "status",
                    text: `Suppressed command during edit request: ${action.command}`
                  });
                  continue;
                }
                this._postMessage({
                  type: "status",
                  text: `Skipped command without workspace: ${action.command}`
                });
              }
            }
            return;
          }

          // Collect outside-workspace file actions and ask permission once
          const outsideFiles = [];
          const insideActions = [];
          const effectiveWriteOptions = this._withWorkspaceRoot(
            writeOptions,
            workspaceFolder
          );
          const fileActionPaths = new Set(
            response.actions
              .filter((a) => (a.type === "file" || a.type === "patch") && a.path)
              .map((a) => a.path.replace(/\\/g, "/").toLowerCase())
          );
          for (const action of response.actions) {
            if (action.type === "patch") {
              // PATCH actions need to check if file is outside workspace
              const fullPath = this._resolveActionFilePath(
                workspaceFolder,
                action.path
              );
              const relativePath = workspaceFolder
                ? path.relative(workspaceFolder, fullPath)
                : action.path;
              const isOutside = relativePath.startsWith("..") || path.isAbsolute(relativePath);
              
              if (isOutside) {
                outsideFiles.push({ action, path: fullPath });
              } else {
                insideActions.push({ action, result: null });
              }
            } else if (action.type === "file") {
              const fullPath = this._resolveActionFilePath(
                workspaceFolder,
                action.path
              );
              const relativePath = workspaceFolder
                ? path.relative(workspaceFolder, fullPath)
                : action.path;
              const isOutside = relativePath.startsWith("..") || path.isAbsolute(relativePath);

              if (isOutside) {
                outsideFiles.push({ action, path: fullPath });
              } else {
                insideActions.push({ action, result: null });
              }
            } else if (action.type === "mkdir") {
              const mkdirPath = (action.path || "").replace(/\\/g, "/").toLowerCase();
              const mkdirParent = path.dirname(mkdirPath);
              if (fileActionPaths.has(mkdirPath) || fileActionPaths.has(mkdirParent)) {
                this._postMessage({
                  type: "status",
                  text: `Skipped redundant MKDIR: ${action.path}`
                });
                continue;
              }

              // applyChanges creates parent dirs automatically.
              const probe = await this.agent.createFolder(
                action.path,
                false,
                effectiveWriteOptions
              );
              if (probe.error === "outside_workspace") {
                outsideFiles.push({ action, path: probe.path });
              } else {
                insideActions.push({ action, result: probe });
              }
            } else if (action.type === "cmd") {
              if (
                this._shouldSuppressGeneratedCommand(
                  isEditLikeIntent,
                  hasExplicitCommandRequest,
                  response.actions,
                  action.command
                )
              ) {
                this._postMessage({
                  type: "status",
                  text: `Suppressed command during edit request: ${action.command}`
                });
                continue;
              }
              insideActions.push({ action, result: null });
            }
          }

          // Ask permission for outside-workspace files (once per session)
          let allowOutside = this._outsideWorkspaceAllowed || false;
          if (outsideFiles.length > 0 && !allowOutside) {
            const paths = outsideFiles.map(f => f.path).join("\n");
            this._postMessage({ type: "confirmOutsideEdit", path: paths });
            allowOutside = await new Promise((resolve) => { this._confirmResolve = resolve; });
            if (allowOutside) this._outsideWorkspaceAllowed = true;
          }

          const planSummary = this._summarizePlannedActions(
            response.actions,
            insideActions,
            outsideFiles
          );
          if (planSummary) {
            this._postMessage({ type: "status", text: planSummary });
          }

          // Process all actions
          const allActions = [
            ...insideActions,
            ...outsideFiles.map(f => ({ action: f.action, result: null, outside: true }))
          ];
          const changedFiles = [];
          let stopFurtherActions = false;

          // Run pre-edit diagnostics for file actions
          const fileActions = allActions.filter(a => a.action.type === "file" || a.action.type === "patch");
          if (fileActions.length > 0 && workspaceFolder) {
            this._postMessage({
              type: "status",
              text: `Pre-edit check: ${fileActions.length} file(s)...`
            });
            
            for (const { action } of fileActions) {
              const diagnostics = await this._runPreEditDiagnostics(
                workspaceFolder,
                action.path,
                action.type
              );
              
              // Only show issues, not successes
              if (!diagnostics.fileInfo.exists) {
                this._postMessage({
                  type: "status",
                  text:
                    action.type === "patch"
                      ? `Missing patch target: ${action.path}`
                      : `Creating new file: ${action.path}`
                });
              } else if (diagnostics.diagnostics.length > 0) {
                for (const diag of diagnostics.diagnostics) {
                  this._postMessage({
                    type: "status",
                    text: `${action.path}: ${diag.message}`
                  });
                }
              }
            }
          }

          for (const { action, result: preResult, outside } of allActions) {
            if (stopFurtherActions) {
              break;
            }
            if (action.type === "patch") {
              // Handle PATCH actions for targeted edits
              if (outside && !allowOutside) {
                this._postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
                continue;
              }
              
              this._postMessage({ type: "status", text: `Applying patch to: ${action.path}` });
              
              // Read current file content
              const fullPath = this._resolveActionFilePath(
                workspaceFolder,
                action.path
              );
              let currentContent = "";
              try {
                currentContent = await fs.readFile(fullPath, "utf8");
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Cannot patch ${action.path}: file not found or unreadable`
                });
                continue;
              }
              
              // Apply the patch (search and replace)
              const searchContent = action.search || "";
              const replaceContent = action.replace || "";

              const patchResult = this._buildPatchedContent(
                currentContent,
                searchContent,
                replaceContent
              );
              if (!patchResult.matched) {
                const recoveryResult = isEditLikeIntent
                  ? await this._recoverFailedPatch(
                      requestText,
                      workspaceFolder,
                      action,
                      currentContent,
                      outside,
                      writeOptions,
                      activeRuntimeConfig
                    )
                  : null;

                if (recoveryResult) {
                  const recoveryUndoId = recoveryResult.success
                    ? this._registerEditForUndo({
                        filePath: recoveryResult.path || action.path,
                        before: recoveryResult.previousContent,
                        after: recoveryResult.newContent,
                        label: "patch"
                      })
                    : null;
                  this._postMessage({
                    type: recoveryResult.success ? "applied" : "error",
                    filePath: recoveryResult.success
                      ? recoveryResult.path
                      : undefined,
                    undoId: recoveryUndoId,
                    text: recoveryResult.success
                      ? `\u2705 Recovered edit ${recoveryResult.relativePath || action.path}\n${recoveryResult.changeSummary || ""}`
                      : recoveryResult.error
                  });
                  if (recoveryResult.success) {
                    this._postFixInsights(
                      recoveryResult.path || action.path,
                      recoveryResult.previousContent,
                      recoveryResult.newContent
                    );
                  }

                  if (recoveryResult.success && !outside) {
                    changedFiles.push(recoveryResult.relativePath || action.path);
                    await this._revealWorkspaceFile(recoveryResult.path);
                  }
                  continue;
                }

                const lines = currentContent.split("\n");
                const preview = lines.slice(0, 10).join("\n");
                this._postMessage({
                  type: "error",
                  text:
                    patchResult.reason === "empty_search"
                      ? `Cannot patch ${action.path}: SEARCH block is empty.`
                      : patchResult.reason === "ambiguous_search"
                        ? `Cannot patch ${action.path}: SEARCH matched ${patchResult.matchCount || "multiple"} locations. Make the SEARCH block more specific so it matches exactly once.`
                      : `Cannot patch ${action.path}: SEARCH content not found.\n\nExpected to find:\n${searchContent.substring(0, 200)}\n\nFile preview (first 10 lines):\n${preview}\n\nThe file may have changed or the search pattern is incorrect.`
                });
                continue;
              }
              
              // Apply the patched content
              const patchSafety = await this._assessEditSafetyBeforeApply(
                workspaceFolder,
                action.path,
                currentContent,
                patchResult.content
              );
              if (!patchSafety.ok) {
                this._postMessage({
                  type: "error",
                  text: patchSafety.reason
                });
                continue;
              }

              const result = await this.agent.applyChanges(
                action.path,
                patchResult.content,
                outside,
                effectiveWriteOptions
              );

              const patchUndoId = result.success
                ? this._registerEditForUndo({
                    filePath: result.path || action.path,
                    before: result.previousContent,
                    after: result.newContent,
                    label: "patch"
                  })
                : null;

              this._postMessage({
                type: result.success ? "applied" : "error",
                filePath: result.success ? result.path : undefined,
                undoId: patchUndoId,
                text: result.success
                  ? `\u2705 Patched ${result.relativePath || action.path}\n${result.changeSummary || ""}`
                  : result.error
              });
              if (result.success) {
                this._postFixInsights(
                  result.path || action.path,
                  result.previousContent,
                  result.newContent
                );
              }
              
              if (result.success && !outside) {
                changedFiles.push(result.relativePath || action.path);
                await this._revealWorkspaceFile(result.path);
              }
            } else if (action.type === "file") {
              if (outside && !allowOutside) {
                this._postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
                continue;
              }
              const fullPath = this._resolveActionFilePath(
                workspaceFolder,
                action.path
              );
              let currentContent = "";
              try {
                currentContent = await fs.readFile(fullPath, "utf8");
              } catch (error) {
                if (error.code !== "ENOENT") {
                  this._postMessage({
                    type: "error",
                    text: `Unable to read ${action.path} before applying changes: ${error.message}`
                  });
                  continue;
                }
              }
              const fileSafety = await this._assessEditSafetyBeforeApply(
                workspaceFolder,
                action.path,
                currentContent,
                action.content
              );
              if (!fileSafety.ok) {
                this._postMessage({
                  type: "error",
                  text: fileSafety.reason
                });
                continue;
              }
              let result = preResult;
              if (!result || outside) {
                result = await this.agent.applyChanges(
                  action.path,
                  action.content,
                  outside,
                  effectiveWriteOptions
                );
              }

              if (
                !result.success &&
                isEditLikeIntent &&
                this._isReadmePath(action.path) &&
                this._isDocTruncateGuardError(result.error)
              ) {
                this._postMessage({
                  type: "status",
                  text: "README guard blocked truncation. Retrying with strict full-file README rewrite..."
                });
                result = await this._retryReadmeRewrite(
                  requestText,
                  workspaceFolder,
                  effectiveWriteOptions
                );
                if (!result.success) {
                  this._postMessage({
                    type: "error",
                    text: `README retry failed: ${result.error}`
                  });
                  stopFurtherActions = true;
                } else {
                  this._postMessage({
                    type: "status",
                    text: "README retry succeeded with a full-file rewrite."
                  });
                }
              }

              if (stopFurtherActions) {
                break;
              }
              const operation = result.created ? "Adding file" : "Editing file";
              this._postMessage({ type: "status", text: `${operation}: ${action.path}` });
              // Newly-created files cannot be undone via stack (no prior state);
              // the user can delete the file themselves if needed.
              const fileUndoId = result.success && !result.created
                ? this._registerEditForUndo({
                    filePath: result.path || action.path,
                    before: result.previousContent,
                    after: result.newContent,
                    label: "edit"
                  })
                : null;
              this._postMessage({
                type: result.success ? "applied" : "error",
                filePath: result.success ? result.path : undefined,
                undoId: fileUndoId,
                text: result.success
                  ? result.created
                    ? `\u2705 Added ${result.relativePath || action.path}\n${result.changeSummary || ""}`
                    : `\u2705 Updated ${result.relativePath || action.path}\n${result.changeSummary || ""}`
                  : result.error
              });
              if (result.success && !result.created) {
                this._postFixInsights(
                  result.path || action.path,
                  result.previousContent,
                  result.newContent
                );
              }
              if (result.success && !outside) {
                changedFiles.push(result.relativePath || action.path);
                await this._revealWorkspaceFile(result.path);
              } else if (!result.success) {
                // Log file operation error to performance monitor
                if (global.performanceMonitor) {
                  global.performanceMonitor.recordIssue("file_error", {
                    file: action.path,
                    operation: result.created ? "create" : "update",
                    error: result.error
                  });
                }
              }
            } else if (action.type === "mkdir") {
              if (outside && !allowOutside) {
                this._postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
                continue;
              }
              const result = outside
                ? await this.agent.createFolder(
                    action.path,
                    true,
                    effectiveWriteOptions
                  )
                : preResult;
              this._postMessage({
                type: result.success ? "applied" : "error",
                text: result.success ? `\u2705 Created folder ${result.path || action.path}` : result.error
              });
            } else if (action.type === "graphify") {
              console.log("[ChatPanel] Executing graphify action");
              
              // Skip any file actions that came with this graphify response
              // (AI sometimes tries to write GRAPH_REPORT.md which triggers doc guard)
              stopFurtherActions = false;

              // Check if workspace is open
              if (!workspaceFolder) {
                this._postMessage({
                  type: "error",
                  text: "Cannot open Graphify: No workspace folder is open. Please open a folder or workspace first."
                });
                continue;
              }
              
              this._postMessage({ type: "status", text: "Opening Graphify visualization..." });
              try {
                console.log("[ChatPanel] Calling vscode.commands.executeCommand('codeJanitor.openGraphify')");
                await vscode.commands.executeCommand("codeJanitor.openGraphify");
                console.log("[ChatPanel] Graphify command executed successfully");
                this._postMessage({
                  type: "applied",
                  text: "\u2705 Graphify panel opened. You can now visualize the codebase structure."
                });
              } catch (err) {
                console.error("[ChatPanel] Graphify command failed:", err);
                this._postMessage({
                  type: "error",
                  text: `Failed to open Graphify: ${err.message}\n\nStack: ${err.stack}`
                });
              }
              // Skip remaining actions — graphify is self-contained
              break;
            } else if (action.type === "lint") {
              this._postMessage({ type: "status", text: "Running Code Janitor lint on the active file..." });
              try {
                await vscode.commands.executeCommand("codeJanitor.lintCode");
                this._postMessage({
                  type: "applied",
                  text: "Lint command executed. Check the Problems panel and notifications for results."
                });
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to run lint: ${err.message}`
                });
              }
            } else if (action.type === "validate_frontend") {
              this._postMessage({ type: "status", text: "Running frontend dependency validation..." });
              try {
                await vscode.commands.executeCommand("codeJanitor.validateFrontend");
                this._postMessage({
                  type: "applied",
                  text: "Frontend validation command executed."
                });
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to validate frontend dependencies: ${err.message}`
                });
              }
} else if (action.type === "preview") {
              const shouldInspectPreview = this._shouldInspectPreviewRequest(requestText);
              if (shouldInspectPreview) {
                this._postMessage({ type: "status", text: "Opening live preview and inspecting it for issues..." });
                try {
                  const inspection = await vscode.commands.executeCommand("codeJanitor.inspectLivePreview");
                  const diagnostics = inspection?.diagnostics || null;
                  this._postMessage({
                    type: "applied",
                    text: this._summarizePreviewDiagnostics(diagnostics)
                  });

                  if (isEditLikeIntent && this._previewDiagnosticsHasIssues(diagnostics)) {
                    this._postMessage({
                      type: "status",
                      text: "Preview issues found. Generating a fix for the active file..."
                    });
                    const runtimeConfig = await this._getEffectiveAiConfig();
                    const fixResult = await this._fixActiveFileFromPreviewDiagnostics(
                      requestText,
                      workspaceFolder,
                      diagnostics,
                      runtimeConfig
                    );

                    if (!fixResult.success) {
                      this._postMessage({
                        type: "error",
                        text: fixResult.error
                      });
                    } else {
                      const verificationDiagnostics = fixResult.verification?.diagnostics || null;
                      const cleanPreview = verificationDiagnostics
                        ? !this._previewDiagnosticsHasIssues(verificationDiagnostics)
                        : null;
                      this._postMessage({
                        type: "applied",
                        text: `Updated ${fixResult.path} using preview diagnostics.`
                      });
                      this._postFixInsights(
                        fixResult.applyResult?.path || fixResult.path,
                        fixResult.applyResult?.previousContent,
                        fixResult.applyResult?.newContent,
                        {
                          verificationPassed: cleanPreview
                        }
                      );

                      if (verificationDiagnostics) {
                        this._postMessage({
                          type: cleanPreview ? "applied" : "status",
                          text: cleanPreview
                            ? `Post-fix preview check passed. ${this._summarizePreviewDiagnostics(verificationDiagnostics)}`
                            : `Post-fix preview check: ${this._summarizePreviewDiagnostics(verificationDiagnostics)}`
                        });
                      }
                    }
                  }
                } catch (err) {
                  this._postMessage({
                    type: "error",
                    text: `Failed to inspect live preview: ${err.message}`
                  });
                }
              } else {
                this._postMessage({ type: "status", text: "Opening live preview..." });
                try {
                  await vscode.commands.executeCommand("codeJanitor.livePreview");
                  this._postMessage({
                    type: "applied",
                    text: "Live preview command executed."
                  });
                } catch (err) {
                  this._postMessage({
                    type: "error",
                    text: `Failed to open live preview: ${err.message}`
                  });
                }
              }
            } else if (action.type === "preview_inspect") {
              this._postMessage({ type: "status", text: "Opening live preview and inspecting it for issues..." });
              try {
                const inspection = await vscode.commands.executeCommand("codeJanitor.inspectLivePreview");
                const diagnostics = inspection?.diagnostics || null;
                this._postMessage({
                  type: "applied",
                  text: this._summarizePreviewDiagnostics(diagnostics)
                });

                if (isEditLikeIntent && this._previewDiagnosticsHasIssues(diagnostics)) {
                  this._postMessage({
                    type: "status",
                    text: "Preview issues found. Generating a fix for the active file..."
                  });
                  const runtimeConfig = await this._getEffectiveAiConfig();
                  const fixResult = await this._fixActiveFileFromPreviewDiagnostics(
                    requestText,
                    workspaceFolder,
                    diagnostics,
                    runtimeConfig
                  );

                  if (!fixResult.success) {
                    this._postMessage({
                      type: "error",
                      text: fixResult.error
                    });
                  } else {
                    const verificationDiagnostics = fixResult.verification?.diagnostics || null;
                    const cleanPreview = verificationDiagnostics
                      ? !this._previewDiagnosticsHasIssues(verificationDiagnostics)
                      : null;
                    this._postMessage({
                      type: "applied",
                        text: `Updated ${fixResult.path} using preview diagnostics.`
                    });
                    this._postFixInsights(
                      fixResult.applyResult?.path || fixResult.path,
                      fixResult.applyResult?.previousContent,
                      fixResult.applyResult?.newContent,
                      {
                        verificationPassed: cleanPreview
                      }
                    );

                    if (verificationDiagnostics) {
                      this._postMessage({
                        type: cleanPreview ? "applied" : "status",
                        text: cleanPreview
                            ? `Post-fix preview check passed. ${this._summarizePreviewDiagnostics(verificationDiagnostics)}`
                          : `Post-fix preview check: ${this._summarizePreviewDiagnostics(verificationDiagnostics)}`
                      });
                    }
                  }
                }
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to inspect live preview: ${err.message}`
                });
              }
            } else if (action.type === "performance") {
              this._postMessage({ type: "status", text: "Opening AI performance report..." });
              try {
                await vscode.commands.executeCommand("codeJanitor.showPerformance");
                this._postMessage({
                  type: "applied",
                  text: "AI performance report command executed."
                });
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to open AI performance report: ${err.message}`
                });
              }
            } else if (action.type === "fetch") {
              this._postMessage({ type: "status", text: `Fetching from web: ${action.url}` });
              try {
                const fetchResult = await this.agent.fetchFromWeb(action.url);
                if (fetchResult.success) {
                  const preview = formatFetchedPreview(action.url, fetchResult, 2000);
                  const truncated = fetchResult.size > 2000 ? ` (truncated from ${fetchResult.size} bytes)` : "";
                  this._postMessage({
                    type: "applied",
                    text: `\u2705 Fetched ${action.url}${truncated}:\n\n${preview}`
                  });
                } else {
                  this._postMessage({
                    type: "error",
                    text: `Failed to fetch ${action.url}: ${fetchResult.error}`
                  });
                }
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to fetch ${action.url}: ${err.message}`
                });
              }
            } else if (action.type === "youtube") {
              // YouTube actions are now handled only via the YouTube button
              // Skip processing YouTube actions from AI responses to improve performance
              this._postMessage({
                type: "status",
                text: "Use the YouTube search button in the chat to search for videos"
              });
            } else if (action.type === "cmd") {
              if (
                this._shouldSuppressGeneratedCommand(
                  isEditLikeIntent,
                  hasExplicitCommandRequest,
                  response.actions,
                  action.command
                )
              ) {
                this._postMessage({
                  type: "status",
                  text: `Suppressed command during edit request: ${action.command}`
                });
                continue;
              }
              const validation = this.agent.validateCommand(action.command);
              if (!validation.allowed) {
                this._postMessage({ type: "status", text: `Blocked: ${validation.reason}` });
                continue;
              }
              this._postMessage({ type: "confirm", command: action.command });
              const allowed = await new Promise((resolve) => { this._confirmResolve = resolve; });
              if (!allowed) {
                this._postMessage({ type: "status", text: `Denied: ${action.command}` });
                continue;
              }
              this._postMessage({ type: "status", text: `Running: ${action.command}` });
              const result = await this.agent.executeCommand(action.command, workspaceFolder);
              const resultText = result.success
                ? (result.output || "Done.")
                : `${result.error}${result.output ? `\n${result.output}` : ""}`;
              const suffix = result.outputTruncated
                ? "\n[Command output was truncated for safety.]"
                : "";
              this._postMessage({
                type: result.success ? "applied" : "error",
                text: `${resultText}${suffix}`
              });
            }
          }

          if (stopFurtherActions) {
            return;
          }

          await this._runPostEditVerification(
            workspaceFolder,
            changedFiles,
            activeRuntimeConfig,
            writeOptions
          );
        }
        } catch (error) {
          console.error("[ChatPanel] Error in chat handler:", error);
          this._userStoppedGeneration = false;
          this._postMessage({ type: "error", text: `Chat error: ${error.message}` });
          this._postMessage({ type: "done" });
        }

      } else if (message.type === "confirmResponse") {
        if (this._confirmResolve) {
          this._confirmResolve(message.allowed);
          this._confirmResolve = null;
        }
      } else if (message.type === "stop") {
        if (this.abortController) {
          this._userStoppedGeneration = true;
          this.abortController.abort();
          this.abortController = null;
          this._postMessage({ type: "done" });
        }
      } else if (message.type === "undoEdit") {
        await this._undoEdit(message.id);
      } else if (message.type === "apply") {
        const result = await this.agent.applyChanges(message.filePath, message.content);
        this._postMessage({
          type: result.success ? "applied" : "error",
          filePath: result.success ? result.path : undefined,
          text: result.success
            ? `Updated ${result.relativePath || message.filePath}\n${result.changeSummary || ""}`
            : result.error
        });
        if (result.success) {
          this._postFixInsights(
            result.path || message.filePath,
            result.previousContent,
            result.newContent
          );
          await this._revealWorkspaceFile(result.path);
        }
      } else if (message.type === "clear") {
        this.agent.clearHistory();
        this._outsideWorkspaceAllowed = false;
        this._postMessage({ type: "cleared" });
        this._postSessionState();
      } else if (message.type === "openChatCommand") {
        await vscode.commands.executeCommand("codeJanitor.openChat");
      } else if (message.type === "openFile") {
        await this._revealWorkspaceFile(message.path);
      } else if (message.type === "scanOverview") {
        this._postMessage({ type: "status", text: "Scanning workspace..." });
        this._postMessage({ type: "thinking" });
        const overview = await this.agent.getCodebaseOverview(workspaceFolder);
        this._postMessage({ type: "stream", text: overview });
        this._postMessage({ type: "done" });
      } else if (message.type === "syntaxScan") {
        // Triggered by action chip - run directly without model
        const activeEditor = this._getCurrentFileEditor();
        const files = message.activeOnly
          ? (activeEditor ? [path.relative(workspaceFolder, activeEditor.document.fileName).replace(/\\/g, "/")] : [])
          : null;
        await this._runSyntaxScan(workspaceFolder, files);
      } else if (message.type === "libraryAudit") {
        await this._runLibraryAudit(workspaceFolder);
      } else if (message.type === "fixActive") {
        await this._runActiveSyntaxFix(workspaceFolder);
      } else if (message.type === "quickFixActive") {
        // Quick Fix from chat panel - lint and fix with AI
        await this._runActiveSyntaxFix(workspaceFolder);
      } else if (message.type === "refreshProviderModels" || message.type === "ready") {
        // CRITICAL FIX: Make ready handler completely non-blocking
        const savedConfig = this.agent.getConfig();
        const selectedProvider = this._getSelectedProviderId() || savedConfig.provider;
        
        if (message.type === "ready") {
          // Send provider/key state immediately; live models are discovered below.
          const customProvider = this._getCustomProviderById(selectedProvider);
          const defaultModels = this._getModelsForInitialProviderState(selectedProvider);
          const selectedModel =
            this._getSavedProviderModel(selectedProvider) ||
            customProvider?.defaultModel ||
            savedConfig.model;
          
          this._postMessage({
            type: "setCurrentProvider",
            provider: selectedProvider,
            model: selectedModel,
            providers: this._buildProviderCatalog(),
            keyPresence: { ollama: true, groq: false, openrouter: false, anthropic: false, nvidia: false }, // Default, will update
            models: defaultModels,
            ...this._getImageInputCapability(selectedProvider, selectedModel)
          });
          this._postMessage({
            type: "thinkingState",
            enabled: this.showThinking
          });
          this._postGStackGateModeState();
          this._postAutoHealState();
          this._postSessionState();
          
          // Fetch real key presence in background
          this._getProviderPresence().then(keyPresence => {
            if (this.panel) {
              this._postMessage({
                type: "setCurrentProvider",
                provider: selectedProvider,
                model: selectedModel,
                providers: this._buildProviderCatalog(),
                keyPresence,
                models: defaultModels,
                ...this._getImageInputCapability(selectedProvider, selectedModel)
              });
            }
          }).catch(err => {
            console.warn('[ChatPanel] Background key presence check failed:', err);
          });
        }
        
        // Fetch models in background (non-blocking)
        this._fetchAndSendModels(selectedProvider);
      } else if (message.type === "createSession") {
        this.agent.createSession();
        this._outsideWorkspaceAllowed = false;
        this._postSessionState();
      } else if (message.type === "confirmDeleteSession") {
        const sessionLabel = String(message.label || "this chat").trim() || "this chat";
        const choice = await vscode.window.showWarningMessage(
          `Delete "${sessionLabel}"? This removes the saved chat history.`,
          { modal: true },
          "Delete"
        );
        if (choice === "Delete") {
          this._deleteSessionAndRefresh(message.sessionId);
        }
      } else if (message.type === "deleteSession") {
        this._deleteSessionAndRefresh(message.sessionId);
      } else if (message.type === "switchSession") {
        this.agent.switchSession(message.sessionId);
        this._outsideWorkspaceAllowed = false;
        this._postSessionState();
      } else if (message.type === "mode") {
        this.chatMode =
          message.value === "deep"
            ? "deep"
            : message.value === "heavy"
              ? "heavy"
              : message.value === "audit"
                ? "audit"
                : message.value === "bugfix"
                  ? "bugfix"
                  : "fast";
      } else if (message.type === "toggleThinking") {
        await this._setThinkingMode(!this.showThinking);
        this._postMessage({
          type: "status",
          text: `Thinking mode ${this.showThinking ? "enabled" : "disabled"}.`
        });
      } else if (message.type === "setAutoHealEnabled") {
        const nextEnabled = message.enabled !== false;
        const cfg = vscode.workspace.getConfiguration("codeJanitor.ai.selfHealing");
        await cfg.update("enabled", nextEnabled, vscode.ConfigurationTarget.Global);
        this.performanceMonitor.setAutoHealEnabled(nextEnabled);
        this._postAutoHealState();
        this._postMessage({
          type: "status",
          text: `Auto-heal ${nextEnabled ? "enabled" : "disabled"}.`
        });
      } else if (message.type === "setGstackGateMode") {
        const nextMode = this._normalizeGStackGateMode(message.value);
        await this._updateAiConfig("gstackGateMode", nextMode);
        this._postGStackGateModeState(nextMode);
        this._postMessage({
          type: "status",
          text: `GStack gate mode set to ${nextMode}.`
        });
      } else if (message.type === "setModel") {
        const provider = this._getSelectedProviderId() || vscode.workspace.getConfiguration("codeJanitor.ai").get("provider", "ollama");
        const nextModel = await this._setProviderModel(provider, message.model);
        if (this.panel) {
          this._postMessage({
            type: "status",
            text: `Model switched to ${nextModel}.`
          });
        }
        this._postImageInputCapability(provider, nextModel);
      } else if (message.type === "setProvider") {
        try {
          console.log("[ChatPanel] setProvider message received:", message.provider);
          if (this._isBuiltInProvider(message.provider)) {
            await this._updateAiConfig("provider", message.provider);
          }
          await this._setSelectedProviderId(message.provider);
          const defaultModel = this._getDefaultModelForProvider(message.provider);
          const savedModel = this._getSavedProviderModel(message.provider);
          const nextModel = await this._setProviderModel(
            message.provider,
            savedModel || defaultModel
          );
          
          // Persist API key if provided
          if (message.apiKey) {
            await this._persistApiKey(message.provider, message.apiKey);
          }
          
          // Send provider/key state immediately; live models are discovered below.
          const customProvider = this._getCustomProviderById(message.provider);
          const defaultModels = this._getModelsForInitialProviderState(message.provider);
          
          if (this.panel) {
            this._postMessage({
              type: "setCurrentProvider",
              provider: message.provider,
              model: nextModel,
              providers: this._buildProviderCatalog(),
              keyPresence: { ollama: true, groq: false, openrouter: false, anthropic: false, nvidia: false }, // Will update in background
              models: defaultModels,
              ...this._getImageInputCapability(message.provider, nextModel)
            });
            this._postMessage({
              type: "status",
              text: `Provider switched to ${message.provider}. Model set to ${nextModel}.`
            });
          }
          
          // Fetch models and key presence in background
          this._fetchAndSendModels(message.provider);
          
          this._getProviderPresence().then(keyPresence => {
            if (this.panel) {
              this._postMessage({
                type: "setCurrentProvider",
                provider: message.provider,
                model: nextModel,
                providers: this._buildProviderCatalog(),
                keyPresence,
                models: defaultModels,
                ...this._getImageInputCapability(message.provider, nextModel)
              });
            }
          }).catch(err => {
            console.warn('[ChatPanel] Background key presence check failed:', err);
          });
        } catch (error) {
          console.error("[ChatPanel] Error in setProvider:", error);
          if (this.panel) {
            this._postMessage({
              type: "error",
              text: `Failed to switch provider: ${error.message}`
            });
          }
        }
      } else if (message.type === "addCustomProvider") {
        try {
          const provider = await this._addCustomProvider(message.provider || {}, message.apiKey || "");
          const keyPresence = await this._getProviderPresence();
          if (this.panel) {
            this._postMessage({
              type: "setCurrentProvider",
              provider: provider.id,
              model: provider.defaultModel,
              providers: this._buildProviderCatalog(),
              keyPresence,
              models: provider.models,
              ...this._getImageInputCapability(provider.id, provider.defaultModel)
            });
            this._postMessage({
              type: "status",
              text: `Custom provider ${provider.name} added and selected.`
            });
          }
        } catch (error) {
          if (this.panel) {
            this._postMessage({
              type: "error",
              text: `Failed to add custom provider: ${error.message}`
            });
          }
        }
      } else if (message.type === "showPerformanceReport") {
        const analysis = this.performanceMonitor.analyzePerformance();
        await this.performanceMonitor.showPerformanceReview(analysis);
      } else if (message.type === "getAutoHealHistory") {
        const history = await this.performanceMonitor.getAutoHealHistory();
        this._postMessage({ type: "autoHealHistory", history });
      } else if (message.type === "tutorialCompleted") {
        // Mark tutorial as completed in global state
        await this.context.globalState.update("codeJanitor.tutorialCompleted", true);
        console.log("[ChatPanel] Tutorial marked as completed");
      } else if (message.type === "prefillMessage") {
        // Quick Fix with AI: pre-fill message and auto-send
        if (this.panel) {
          this._postMessage({ 
            type: "prefillAndSend", 
            message: message.message 
          });
        }
      } else if (message.type === "webSearch") {
        try {
          const query = (message.query || "").trim();
          if (!query) {
            this._postMessage({ type: "searchError", error: "Search query is empty" });
            return;
          }

          this._postMessage({ type: "status", text: `Searching for: ${query}` });
          this._postMessage({ type: "thinking" });

          // Use DuckDuckGo Instant Answer API (free, no API key required)
          const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
          
          const response = await fetch(searchUrl, {
            headers: { "User-Agent": "Code-Janitor/1.0" },
            signal: AbortSignal.timeout(15000)
          });

          if (!response.ok) {
            throw new Error(`Search API returned status ${response.status}`);
          }

          const data = await response.json();
          
          // Format search results
          let resultText = `Search results for "${query}":\n\n`;
          
          if (data.AbstractText) {
            resultText += `Summary:\n${data.AbstractText}\n\n`;
          }
          
          if (data.AbstractURL) {
            resultText += `Source: ${data.AbstractURL}\n\n`;
          }

          if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            resultText += "Related Topics:\n";
            const topics = data.RelatedTopics.slice(0, 5);
            for (const topic of topics) {
              resultText += `- ${topic.Text}\n  ${topic.FirstURL}\n\n`;
            }
          }

          if (!data.AbstractText && (!data.RelatedTopics || data.RelatedTopics.length === 0)) {
            resultText += `No detailed results found. Try a more specific query or visit:\nhttps://duckduckgo.com/?q=${encodeURIComponent(query)}`;
          }

          this._postMessage({ type: "stream", text: resultText });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "searchComplete" });

        } catch (error) {
          console.error("[ChatPanel] Web search error:", error);
          this._postMessage({ 
            type: "error", 
            text: `Search failed: ${error.message}. Check your internet connection.` 
          });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "searchError", error: error.message });
        }
      } else if (message.type === "openExternal") {
        const targetUrl = this._sanitizeExternalUrl(message.url, {
          allowHttp: true,
          allowHttps: true
        });
        if (!targetUrl) {
          this._postMessage({
            type: "error",
            text: "Blocked unsafe external link."
          });
          return;
        }

        try {
          await vscode.env.openExternal(vscode.Uri.parse(targetUrl));
        } catch (error) {
          console.error("[ChatPanel] Failed to open external URL:", error);
          this._postMessage({
            type: "error",
            text: `Could not open link: ${error.message}`
          });
        }
      } else if (message.type === "youtubeSearch") {
        try {
          const query = (message.query || "").trim();
          if (!query) {
            this._postMessage({ type: "youtubeError", error: "Search query is empty" });
            return;
          }

          this._postMessage({ type: "status", text: `Searching YouTube for: ${query}` });
          this._postMessage({ type: "thinking" });

          const results = await this._searchYouTube(query);
          
          if (results.error) {
            throw new Error(results.error);
          }

          // Format results with embeds
          let resultText = `YouTube results for "${query}":\n\n`;
          
          if (results.fallback) {
            resultText += `${results.message}\n\n`;
          }
          
          if (results.videos && results.videos.length > 0) {
            for (const video of results.videos) {
              resultText += `${video.title}\n\n${video.url}\n\n`;
            }
          } else {
            resultText += "No videos found. Try a different search term.";
          }
          
          console.log("[YouTube Backend] Sending result text:", resultText);

          this._postMessage({ type: "stream", text: resultText });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "youtubeComplete" });

        } catch (error) {
          console.error("[ChatPanel] YouTube search error:", error);
          this._postMessage({ 
            type: "error", 
            text: `YouTube search failed: ${error.message}` 
          });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "youtubeError", error: error.message });
        }
      }
    });
  }
}

module.exports = ChatPanel;
