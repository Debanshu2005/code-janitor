/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock(
  "vscode",
  () => ({
    window: {
      activeTextEditor: null,
      onDidChangeActiveTextEditor: jest.fn()
    },
    workspace: {
      workspaceFolders: [],
      getWorkspaceFolder: jest.fn(),
      getConfiguration: jest.fn(() => ({
        get: jest.fn(),
        update: jest.fn()
      }))
    },
    ConfigurationTarget: {
      Global: "global",
      Workspace: "workspace"
    }
  }),
  { virtual: true }
);

const vscode = require("vscode");
jest.mock("../agent", () => jest.fn());
jest.mock("../../self-healing/performance-monitor", () => jest.fn());

const ChatPanel = require("../chat-panel");

describe("ChatPanel structured edit helpers", () => {
  afterEach(() => {
    vscode.window.activeTextEditor = null;
    vscode.workspace.workspaceFolders = [];
    vscode.workspace.getWorkspaceFolder.mockReset();
  });

  test("builds patched content across CRLF differences", () => {
    const panel = Object.create(ChatPanel.prototype);

    const result = panel._buildPatchedContent(
      "const answer = 41;\r\nconsole.log(answer);\r\n",
      "const answer = 41;\n",
      "const answer = 42;\n"
    );

    expect(result).toEqual({
      matched: true,
      content: "const answer = 42;\r\nconsole.log(answer);\r\n"
    });
  });

  test("builds a bug-scan excerpt that preserves the file tail for oversized files", () => {
    const panel = Object.create(ChatPanel.prototype);
    const content = Array.from(
      { length: 1400 },
      (_, index) => `const line${index + 1} = ${index + 1};`
    ).join("\n");

    const result = panel._buildBugScanFileExcerpt(content);

    expect(result.note).toContain("showing both the start and end");
    expect(result.text).toContain("const line1 = 1;");
    expect(result.text).toContain("const line1400 = 1400;");
    expect(result.text).toContain("[truncated");
  });

  test("delegates intent detection to the agent when the panel needs an override", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.agent = {
      _detectIntent: jest.fn(() => "edit")
    };

    expect(panel._detectIntent("fix src/app.js")).toBe("edit");
    expect(panel.agent._detectIntent).toHaveBeenCalledWith("fix src/app.js");
  });

  test("custom provider setup requires an OpenAI-compatible base URL", async () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(
      panel._normalizeCustomProvider({
        name: "Mystery API",
        defaultModel: "mystery-chat"
      })
    ).toBeNull();

    await expect(
      panel._addCustomProvider(
        {
          name: "Mystery API",
          defaultModel: "mystery-chat"
        },
        "secret"
      )
    ).rejects.toThrow("OpenAI-compatible base URL");
  });

  test("syntax scan checks dirty HTML buffers through the shared syntax validator", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._postMessage = jest.fn();
    panel.agent = {
      ensureCodebaseScanned: jest.fn().mockResolvedValue(undefined),
      codebaseContext: new Map([["index.html", { content: "<html></html>" }]]),
      _runSyntaxCheck: jest.fn().mockResolvedValue({
        success: false,
        error: "HTML JavaScript syntax error"
      })
    };

    vscode.window.visibleTextEditors = [
      {
        document: {
          fileName: "C:/workspace/index.html",
          isDirty: true,
          uri: { scheme: "file" },
          getText: () => "<html><script>function broken( {</script></html>"
        }
      }
    ];

    await panel._runSyntaxScan("C:/workspace", ["index.html"]);

    expect(panel.agent._runSyntaxCheck).toHaveBeenCalledWith(
      "C:/workspace/index.html",
      "C:/workspace",
      "<html><script>function broken( {</script></html>"
    );
    expect(panel._postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stream",
        text: expect.stringContaining("index.html")
      })
    );
  });

  test("pre-edit diagnostics dedupe repeated actions on the same file", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._runPreEditDiagnostics = jest.fn().mockResolvedValue({
      success: true,
      diagnostics: [],
      fileInfo: { exists: true }
    });

    const results = await panel._collectPreEditDiagnostics("/workspace", [
      { action: { type: "patch", path: "src/app.js" } },
      { action: { type: "patch", path: "src/app.js" } },
      { action: { type: "file", path: "src/app.js" } }
    ]);

    expect(panel._runPreEditDiagnostics).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  test("builds patched content when whitespace differs", () => {
    const panel = Object.create(ChatPanel.prototype);

    const result = panel._buildPatchedContent(
      "function greet(name) {\n    return name;\n}\n",
      "function greet(name) {\n  return name;\n}\n",
      "function greet(name) {\n  return name.trim();\n}\n"
    );

    expect(result.matched).toBe(true);
    expect(result.content).toContain("return name.trim();");
  });

  test("rejects ambiguous PATCH searches that match multiple locations", () => {
    const panel = Object.create(ChatPanel.prototype);

    const result = panel._buildPatchedContent(
      "const value = 1;\nconst value = 1;\n",
      "const value = 1;\n",
      "const value = 2;\n"
    );

    expect(result).toMatchObject({
      matched: false,
      reason: "ambiguous_search",
      matchCount: 2
    });
  });

  test("prefers the optimized patch matcher when it is available", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._buildPatchedContentOptimized = jest.fn(async () => ({
      matched: true,
      content: "optimized result"
    }));
    panel._buildPatchedContent = jest.fn(() => ({
      matched: true,
      content: "fallback result"
    }));

    const result = await panel._matchPatchedContent(
      "const value = 1;\n",
      "const value = 1;\n",
      "const value = 2;\n"
    );

    expect(panel._buildPatchedContentOptimized).toHaveBeenCalled();
    expect(panel._buildPatchedContent).not.toHaveBeenCalled();
    expect(result).toEqual({
      matched: true,
      content: "optimized result"
    });
  });

  test("planned action summary includes patch actions", () => {
    const panel = Object.create(ChatPanel.prototype);

    const summary = panel._summarizePlannedActions(
      [{ type: "patch", path: "src/app.js" }],
      [{ action: { type: "patch", path: "src/app.js" }, result: null }],
      []
    );

    expect(summary).toContain("patch src/app.js");
  });

  test("planned action summary includes apply_diff and insert_content actions", () => {
    const panel = Object.create(ChatPanel.prototype);

    const summary = panel._summarizePlannedActions(
      [
        { type: "apply_diff", path: "src/app.js" },
        { type: "insert_content", path: "src/app.js" }
      ],
      [
        { action: { type: "apply_diff", path: "src/app.js" }, result: null },
        { action: { type: "insert_content", path: "src/app.js" }, result: null }
      ],
      []
    );

    expect(summary).toContain("diff src/app.js");
    expect(summary).toContain("insert src/app.js");
  });

  test("normalizes followup intent overrides for suggestion buttons", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(panel._normalizeFollowupIntentOverride("code")).toBe("edit");
    expect(panel._normalizeFollowupIntentOverride("plan")).toBe("plan");
    expect(panel._normalizeFollowupIntentOverride("ask")).toBe("general");
    expect(panel._normalizeFollowupIntentOverride("review")).toBe("review");
  });

  test("ignores unsupported followup intent overrides", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(panel._normalizeFollowupIntentOverride("")).toBe("");
    expect(panel._normalizeFollowupIntentOverride("unknown-mode")).toBe("");
  });

  test("fast mode skips eager workspace prep even for repo-scoped prompts", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(
      panel._shouldPrepareWorkspaceContext(
        "scan",
        "scan the repository and summarize the architecture",
        "fast"
      )
    ).toBe(false);
    expect(
      panel._shouldPrepareWorkspaceContext(
        "scan",
        "scan the repository and summarize the architecture",
        "heavy"
      )
    ).toBe(true);
  });

  test("structured action summary includes todo list updates", () => {
    const panel = Object.create(ChatPanel.prototype);

    const summary = panel._buildStructuredActionDisplaySummary([
      {
        type: "update_todo_list",
        items: [{ text: "Run tests", status: "in_progress" }]
      }
    ]);

    expect(summary).toContain("todo update");
    expect(summary).toContain("Update the task list");
  });

  test("structured action summary includes apply_diff and insert_content previews", () => {
    const panel = Object.create(ChatPanel.prototype);

    const summary = panel._buildStructuredActionDisplaySummary([
      {
        type: "apply_diff",
        path: "src/app.js"
      },
      {
        type: "insert_content",
        path: "src/app.js"
      }
    ]);

    expect(summary).toContain("diff edit");
    expect(summary).toContain("content insertion");
    expect(summary).toContain("Apply diff to src/app.js");
    expect(summary).toContain("Insert content into src/app.js");
  });

  test("structured action summary includes MCP tool previews", () => {
    const panel = Object.create(ChatPanel.prototype);

    const summary = panel._buildStructuredActionDisplaySummary([
      {
        type: "mcp_tool",
        serverName: "filesystem",
        toolName: "read_file"
      }
    ]);

    expect(summary).toContain("MCP tool call");
    expect(summary).toContain("filesystem.read_file");
  });

  test("treats apply_diff and insert_content as executable file actions", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(
      panel._hasExecutableFileAction([
        {
          type: "apply_diff",
          path: "src/app.js",
          diff: "<<<<<<< SEARCH\n:start_line: 1\n-------\nold\n=======\nnew\n>>>>>>> REPLACE"
        }
      ])
    ).toBe(true);
    expect(
      panel._hasExecutableFileAction([
        {
          type: "insert_content",
          path: "src/app.js",
          line: 1,
          content: "import x from 'x';"
        }
      ])
    ).toBe(true);
  });

  test("applies structured syntax-fix actions in memory for apply_diff and insert_content", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._normalizeActionPathForMatch = ChatPanel.prototype._normalizeActionPathForMatch;
    panel._matchesSyntaxFixTarget = ChatPanel.prototype._matchesSyntaxFixTarget;
    panel._validateGeneratedFileContent = jest.fn(() => ({ ok: true }));

    const result = await panel._applyStructuredSyntaxFixActions(
      [
        {
          type: "insert_content",
          path: "src/app.js",
          line: 1,
          content: "import path from 'path';"
        },
        {
          type: "apply_diff",
          path: "src/app.js",
          diff: "<<<<<<< SEARCH\n:start_line: 2\n-------\nconst answer = 41;\n=======\nconst answer = 42;\n>>>>>>> REPLACE"
        }
      ],
      {
        fileContent: "const answer = 41;\nconsole.log(answer);\n",
        relativePath: "src/app.js",
        absolutePath: "/workspace/src/app.js",
        language: "javascript"
      }
    );

    expect(result).toEqual({
      success: true,
      newContent:
        "import path from 'path';\nconst answer = 42;\nconsole.log(answer);\n"
    });
  });

  test("suppresses internal structured edit retry statuses", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(
      panel._shouldSuppressInternalStatus(
        "Model output looked incomplete. Retrying with strict edit format..."
      )
    ).toBe(true);
    expect(
      panel._shouldSuppressInternalStatus(
        "Structured edits still looked incomplete. Retrying with FILE-only format..."
      )
    ).toBe(true);
    expect(
      panel._shouldSuppressInternalStatus("Applying patch to: src/app.js")
    ).toBe(false);
  });

  test("suppresses nested gstack gate provider chatter", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(
      panel._shouldSuppressGStackGateStatus("Fetching 2 referenced links...")
    ).toBe(true);
    expect(
      panel._shouldSuppressGStackGateStatus("Scanning active files...")
    ).toBe(true);
    expect(
      panel._shouldSuppressGStackGateStatus("Contacting nvidia...")
    ).toBe(true);
    expect(
      panel._shouldSuppressGStackGateStatus("Applying patch to: README.md")
    ).toBe(false);
  });

  test("delegates edit-like intent checks to the agent", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.agent = {
      _shouldTreatAsEditIntent: jest.fn(() => true)
    };

    expect(panel._isEditLikeIntent("refactor", "clean up this file for me")).toBe(
      true
    );
    expect(panel.agent._shouldTreatAsEditIntent).toHaveBeenCalledWith(
      "refactor",
      "clean up this file for me"
    );
  });

  test("uses agent-loop interaction style for edit-like requests only", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(panel._getInteractionStyleForRequest(true)).toBe("agent_loop");
    expect(panel._getInteractionStyleForRequest(false)).toBeUndefined();
  });

  test("effective workspace follows the active editor workspace", () => {
    const panel = Object.create(ChatPanel.prototype);
    vscode.workspace.workspaceFolders = [
      { uri: { fsPath: "/workspace-one" } },
      { uri: { fsPath: "/workspace-two" } }
    ];
    vscode.window.activeTextEditor = {
      document: {
        uri: { scheme: "file" },
        fileName: "/workspace-two/src/app.js"
      }
    };
    vscode.workspace.getWorkspaceFolder.mockReturnValue({
      uri: { fsPath: "/workspace-two" }
    });

    expect(panel._getEffectiveWorkspaceFolder()).toBe("/workspace-two");
  });

  test("effective workspace falls back to the active file directory when the file is outside any workspace", () => {
    const panel = Object.create(ChatPanel.prototype);
    vscode.workspace.workspaceFolders = [
      { uri: { fsPath: "/workspace-one" } }
    ];
    vscode.window.activeTextEditor = {
      document: {
        uri: { scheme: "file" },
        fileName: "/external/project/src/app.js"
      }
    };
    vscode.workspace.getWorkspaceFolder.mockReturnValue(undefined);

    expect(panel._getEffectiveWorkspaceFolder()).toBe("/external/project/src");
  });

  test("resolves relative action paths against the effective workspace fallback", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._getCurrentFileEditor = jest.fn(() => ({
      document: {
        uri: { scheme: "file" },
        fileName: "/external/project/src/app.js"
      }
    }));
    vscode.workspace.workspaceFolders = [
      { uri: { fsPath: "/workspace-one" } }
    ];
    vscode.workspace.getWorkspaceFolder.mockReturnValue(undefined);

    expect(panel._resolveActionFilePath(null, "utils/helper.js")).toBe(
      path.resolve("/external/project/src", "utils/helper.js")
    );
  });

  test("git detection accepts repositories exposed through a .git file", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cj-git-root-"));
    const nestedDir = path.join(workspaceRoot, "src", "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, ".git"), "gitdir: /tmp/fake\n", "utf8");

    await expect(panel._isGitRepository(nestedDir)).resolves.toBe(true);
  });

  test("queued bugfix mode override is one-shot and falls back to chat mode", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.chatMode = "fast";
    panel._queuedModeOverride = null;

    panel._queueModeOverride("bugfix");

    expect(panel._getRequestMode()).toBe("bugfix");
    expect(panel._consumeQueuedModeOverride()).toBe("bugfix");
    expect(panel._getRequestMode()).toBe("fast");
  });

  test("image input capability disables attachments for text-only models", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.agent = {
      _modelSupportsImageInput: jest.fn(() => false)
    };
    panel._getCustomProviderById = jest.fn(() => ({
      id: "custom:mystidia",
      name: "Mystidia"
    }));

    expect(panel._getImageInputCapability("custom:mystidia", "mystidia")).toEqual({
      imageInputEnabled: false,
      imageInputReason:
        "Selected model does not appear to support image input. Switch to a vision-capable model or remove attachments."
    });
  });

  test("image input capability stays enabled for unknown custom models", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.agent = {
      _modelSupportsImageInput: jest.fn(() => true)
    };
    panel._getCustomProviderById = jest.fn(() => ({
      id: "custom:visionhub",
      name: "VisionHub"
    }));

    expect(panel._getImageInputCapability("custom:visionhub", "nova-pro")).toEqual({
      imageInputEnabled: true,
      imageInputReason: "Attach images for vision-capable models."
    });
  });

  test("effective AI config reports ollama after forcing a keyless cloud provider back to ollama", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const update = jest.fn().mockResolvedValue(undefined);
    panel.agent = {
      getConfig: jest.fn(() => ({
        provider: "groq",
        model: "llama-3.1-8b-instant",
        ollamaUrl: "http://localhost:11434",
        groqApiKey: "",
        openrouterApiKey: "",
        anthropicApiKey: "",
        nvidiaApiKey: ""
      }))
    };
    panel._getSelectedProviderId = jest.fn(() => "groq");
    panel._setSelectedProviderId = jest.fn().mockResolvedValue(undefined);
    panel._isBuiltInProvider = jest.fn((provider) =>
      ["ollama", "groq", "openrouter", "anthropic", "nvidia"].includes(provider)
    );
    panel._getCustomProviderById = jest.fn(() => null);
    panel._getStoredApiKey = jest.fn(async () => "");
    panel._getDefaultModelForProvider = jest.fn((provider) =>
      provider === "ollama" ? "qwen2.5-coder:7b" : "llama-3.1-8b-instant"
    );

    vscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn(),
      update
    });

    const config = await panel._getEffectiveAiConfig();

    expect(update).toHaveBeenCalledWith(
      "provider",
      "ollama",
      expect.anything()
    );
    expect(panel._setSelectedProviderId).toHaveBeenCalledWith("ollama");
    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("qwen2.5-coder:7b");
  });

  test("remembered provider presence keeps saved API keys across provider switches", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._lastKnownProviderPresence = {
      ollama: true,
      groq: false,
      openrouter: false,
      anthropic: false,
      nvidia: false
    };
    panel._getImmediateProviderPresence = ChatPanel.prototype._getImmediateProviderPresence;
    panel._rememberProviderPresence = ChatPanel.prototype._rememberProviderPresence;

    panel._rememberProviderPresence({ nvidia: true });
    const nextPresence = panel._rememberProviderPresence({ openrouter: true });

    expect(nextPresence).toMatchObject({
      ollama: true,
      nvidia: true,
      openrouter: true
    });
  });

  test("persisting an API key updates immediate provider presence", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._lastKnownProviderPresence = {
      ollama: true,
      groq: false,
      openrouter: false,
      anthropic: false,
      nvidia: false
    };
    panel.context = {
      secrets: {
        store: jest.fn().mockResolvedValue(undefined)
      }
    };
    panel._getImmediateProviderPresence = ChatPanel.prototype._getImmediateProviderPresence;
    panel._rememberProviderPresence = ChatPanel.prototype._rememberProviderPresence;
    panel._getApiKeyConfigKey = ChatPanel.prototype._getApiKeyConfigKey;
    panel._getApiSecretKey = ChatPanel.prototype._getApiSecretKey;
    panel._sanitizeApiKey = ChatPanel.prototype._sanitizeApiKey;
    panel._getConfigTargetForKey = jest.fn(() => vscode.ConfigurationTarget.Global);
    panel._syncCliAiConfigPatch = jest.fn();

    const update = jest.fn().mockResolvedValue(undefined);
    vscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn(() => ""),
      update
    });

    await panel._persistApiKey("nvidia", "secret-value");

    expect(panel.context.secrets.store).toHaveBeenCalled();
    expect(panel._syncCliAiConfigPatch).toHaveBeenCalledWith({
      provider: "nvidia",
      nvidiaApiKey: "secret-value"
    });
    expect(panel._getImmediateProviderPresence()).toMatchObject({
      ollama: true,
      nvidia: true
    });
  });

  test("persisting a custom provider API key syncs its CLI provider definition", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._lastKnownProviderPresence = {
      ollama: true
    };
    panel.context = {
      secrets: {
        store: jest.fn().mockResolvedValue(undefined)
      }
    };
    panel._getImmediateProviderPresence = ChatPanel.prototype._getImmediateProviderPresence;
    panel._rememberProviderPresence = ChatPanel.prototype._rememberProviderPresence;
    panel._getApiKeyConfigKey = ChatPanel.prototype._getApiKeyConfigKey;
    panel._getApiSecretKey = ChatPanel.prototype._getApiSecretKey;
    panel._sanitizeApiKey = ChatPanel.prototype._sanitizeApiKey;
    panel._getSavedProviderModel = jest.fn(() => "coder-pro");
    panel._getCustomProviderById = jest.fn(() => ({
      id: "custom:local-ai",
      name: "Local AI",
      baseUrl: "http://localhost:1234/v1",
      defaultModel: "coder-lite",
      models: ["coder-lite", "coder-pro"],
      protocol: "openai"
    }));
    panel._syncCliAiConfigPatch = jest.fn();

    await panel._persistApiKey("custom:local-ai", "custom-secret");

    expect(panel.context.secrets.store).toHaveBeenCalledWith(
      "codeJanitor.ai.custom:local-ai.apiKey",
      "custom-secret"
    );
    expect(panel._syncCliAiConfigPatch).toHaveBeenCalledWith({
      provider: "custom:local-ai",
      model: "coder-pro",
      customProviders: [
        expect.objectContaining({
          id: "custom:local-ai",
          apiKey: "custom-secret"
        })
      ]
    });
  });

  test("sanitized external URLs block non-HTTPS navigation and restrict HTTP provider endpoints to loopback", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._isLoopbackHost = ChatPanel.prototype._isLoopbackHost;
    panel._sanitizeExternalUrl = ChatPanel.prototype._sanitizeExternalUrl;

    expect(
      panel._sanitizeExternalUrl("http://example.com/docs", {
        allowHttp: false,
        allowHttps: true
      })
    ).toBe("");
    expect(
      panel._sanitizeExternalUrl("http://localhost:11434/v1", {
        allowHttp: true,
        allowHttps: true,
        restrictHttpToLoopback: true
      })
    ).toBe("http://localhost:11434/v1");
    expect(
      panel._sanitizeExternalUrl("http://192.168.1.10:8000/v1", {
        allowHttp: true,
        allowHttps: true,
        restrictHttpToLoopback: true
      })
    ).toBe("");
  });

  test("posted webview messages include the shared extension token", () => {
    const panel = Object.create(ChatPanel.prototype);
    const postMessage = jest.fn();
    panel.panel = { webview: { postMessage } };
    panel.sidebarView = null;
    panel._webviewMessageToken = "token-123";
    panel._postMessage = ChatPanel.prototype._postMessage;

    panel._postMessage({ type: "status", text: "hello" });

    expect(postMessage).toHaveBeenCalledWith({
      type: "status",
      text: "hello",
      __codeJanitorToken: "token-123"
    });
  });

  test("undo state exposes the most recent undo id", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._undoStack = [
      { id: "undo-1" },
      { id: "undo-2" }
    ];

    expect(panel._getUndoState()).toEqual({
      canUndo: true,
      latestUndoId: "undo-2"
    });
  });

  test("todo state mirrors the active session todo list", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.agent = {
      getSessionState: jest.fn(() => ({
        currentSessionId: "session-a",
        todoList: [
          { text: "Inspect wiring", status: "completed" },
          { text: "Run tests", status: "in_progress" }
        ]
      }))
    };

    expect(panel._getTodoState()).toEqual({
      currentSessionId: "session-a",
      todoList: [
        { text: "Inspect wiring", status: "completed" },
        { text: "Run tests", status: "in_progress" }
      ],
      todoCounts: {
        pending: 0,
        in_progress: 1,
        completed: 1
      }
    });
  });

  test("posted todo state includes session metadata without restoring chat history", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._postMessage = jest.fn();
    panel.agent = {
      getSessionState: jest.fn(() => ({
        currentSessionId: "session-a",
        sessions: [{ id: "session-a", title: "Chat A", updatedAt: 1 }],
        todoList: [{ text: "Run tests", status: "in_progress" }]
      }))
    };

    panel._postTodoState();

    expect(panel._postMessage).toHaveBeenCalledWith({
      type: "todoState",
      sessions: [{ id: "session-a", title: "Chat A", updatedAt: 1 }],
      currentSessionId: "session-a",
      todoList: [{ text: "Run tests", status: "in_progress" }],
      todoCounts: {
        pending: 0,
        in_progress: 1,
        completed: 0
      }
    });
  });

  test("undo state is scoped to the active chat session when entries are session-bound", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._undoStack = [
      { id: "undo-1", sessionId: "session-a" },
      { id: "undo-2", sessionId: "session-b" }
    ];
    panel.agent = {
      getSessionState: jest.fn(() => ({ currentSessionId: "session-a" }))
    };

    expect(panel._getUndoState()).toEqual({
      canUndo: true,
      latestUndoId: "undo-1"
    });
  });

  test("streams raw structured edit chunks without compacting them", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._postMessage = jest.fn();

    const controller = panel._createStreamDisplayController({
      bufferStructuredActions: true
    });

    controller.push("I will update the file now.\n");
    expect(panel._postMessage).toHaveBeenCalledWith({
      type: "stream",
      text: "I will update the file now.\n"
    });

    controller.push("PATCH: src/app.js\nSEARCH:\n```js\nold\n```\n");

    expect(panel._postMessage).toHaveBeenNthCalledWith(2, {
      type: "stream",
      text: "PATCH: src/app.js\nSEARCH:\n```js\nold\n```\n"
    });
  });

  test("shows final clarification text when buffered edit stream never produced actions", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._postMessage = jest.fn();

    const controller = panel._createStreamDisplayController({
      bufferStructuredActions: true
    });

    controller.push("Which file should I update?");
    expect(panel._postMessage).toHaveBeenCalledWith({
      type: "stream",
      text: "Which file should I update?"
    });

    controller.ensureFinalTextVisible(
      "Which file should I update, and what exact behavior do you want changed?"
    );

    expect(panel._postMessage).toHaveBeenNthCalledWith(2, {
      type: "streamReplace",
      text: "Which file should I update, and what exact behavior do you want changed?"
    });
  });

  test("renders a structured action summary for workspace edit responses", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._stripStructuredActionsFromText = ChatPanel.prototype._stripStructuredActionsFromText;
    panel._findStructuredActionStart = ChatPanel.prototype._findStructuredActionStart;
    panel._buildStructuredActionDisplaySummary =
      ChatPanel.prototype._buildStructuredActionDisplaySummary;

    const text = panel._buildVisibleAssistantText(
      {
        text: [
          "I'll update the auth wiring.",
          "",
          "PATCH: src/app.js",
          "SEARCH:",
          "```js",
          "const status = 'draft';",
          "```",
          "REPLACE:",
          "```js",
          "const status = 'ready';",
          "```"
        ].join("\n"),
        actions: [
          {
            type: "patch",
            path: "src/app.js",
            search: "const status = 'draft';\n",
            replace: "const status = 'ready';\n"
          }
        ]
      },
      { preferStructuredSummary: true }
    );

    expect(text).toContain("I'll update the auth wiring.");
    expect(text).toContain("Model prepared executable changes.");
    expect(text).toContain("Patch src/app.js");
    expect(text).toContain("Applying 1 patch now.");
    expect(text).not.toContain("PATCH: src/app.js");
  });

  test("keeps raw assistant text when structured summaries are not requested", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._buildAuditHaltDisplayText =
      ChatPanel.prototype._buildAuditHaltDisplayText;
    panel._parseAuditHaltBlock = ChatPanel.prototype._parseAuditHaltBlock;
    panel._looksLikeFalsePositiveAuditHalt =
      ChatPanel.prototype._looksLikeFalsePositiveAuditHalt;

    const text = panel._buildVisibleAssistantText(
      {
        text: "PATCH: src/app.js",
        actions: [{ type: "patch", path: "src/app.js" }]
      },
      { preferStructuredSummary: false }
    );

    expect(text).toBe("PATCH: src/app.js");
  });

  test("renders package.json audit halts as likely false positives in the chat bubble", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._buildAuditHaltDisplayText =
      ChatPanel.prototype._buildAuditHaltDisplayText;
    panel._parseAuditHaltBlock = ChatPanel.prototype._parseAuditHaltBlock;
    panel._looksLikeFalsePositiveAuditHalt =
      ChatPanel.prototype._looksLikeFalsePositiveAuditHalt;

    const text = panel._buildVisibleAssistantText(
      {
        text: [
          "%%AUDIT_HALTED%%",
          "Flagged pattern: hardcoded credentials",
          "Location: package.json",
          "Reason: The package.json file contains hardcoded GitHub API tokens and URLs, which could be used for malicious purposes if accessed by unauthorized parties.",
          "%%END%%"
        ].join("\n"),
        actions: []
      },
      { preferStructuredSummary: false }
    );

    expect(text).toContain(
      "Security gate paused this reply, but the flagged reason looks like a likely false positive."
    );
    expect(text).toContain("Flagged pattern: hardcoded credentials");
    expect(text).toContain("Location: package.json");
    expect(text).toContain("Model reason:");
    expect(text).not.toContain("%%AUDIT_HALTED%%");
  });

  test("blocks execution when structured actions are flagged as incomplete", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.agent = {
      _hasIncompleteStructuredEditWarning: jest.fn(() => true)
    };

    expect(
      panel._shouldBlockIncompleteStructuredExecution({
        warnings: ["Structured edit output appears incomplete; retrying may recover missing edits."],
        actions: [
          {
            type: "file",
            path: "src/app.js",
            content: "const value = 1;\n"
          }
        ]
      })
    ).toBe(true);
  });

  test("syntax-fix validation rejects major truncation before apply", () => {
    const panel = Object.create(ChatPanel.prototype);
    const original = [
      "function alpha() {",
      "  const value = 1;",
      "  const next = value + 1;",
      "  return value + 1;",
      "}",
      "",
      "function beta() {",
      "  return alpha();",
      "}",
      ""
    ].join("\n");

    const result = panel._validateGeneratedFileContent(
      original,
      "function alpha() {\n  return 1;\n}\n",
      "javascript",
      "src/app.js"
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("src/app.js");
  });

  test("html validation allows normal placeholder attributes in complete files", () => {
    const panel = Object.create(ChatPanel.prototype);
    const original = [
      "<!DOCTYPE html>",
      "<html>",
      "<body>",
      "  <main>",
      "    <h1>Newsletter</h1>",
      "    <input type=\"email\" />",
      "  </main>",
      "</body>",
      "</html>"
    ].join("\n");

    const result = panel._validateGeneratedFileContent(
      original,
      [
        "<!DOCTYPE html>",
        "<html>",
        "<body>",
        "  <main>",
        "    <h1>Newsletter</h1>",
        "    <input type=\"email\" placeholder=\"Email address\" />",
        "  </main>",
        "</body>",
        "</html>"
      ].join("\n"),
      "html",
      "index.html"
    );

    expect(result.ok).toBe(true);
  });

  test("html validation still rejects obvious placeholder-only file content", () => {
    const panel = Object.create(ChatPanel.prototype);

    const result = panel._validateGeneratedFileContent(
      "<!DOCTYPE html>\n<html>\n<body><p>Old</p></body>\n</html>\n",
      [
        "<!DOCTYPE html>",
        "<html>",
        "<body>",
        "  <!-- existing HTML here -->",
        "</body>",
        "</html>"
      ].join("\n"),
      "html",
      "index.html"
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("placeholder content");
  });

  test("replaces the final streamed text only when the model sends a longer final reply", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._postMessage = jest.fn();

    const controller = panel._createStreamDisplayController({
      bufferStructuredActions: true
    });

    controller.push("I will update the file now.");

    controller.ensureFinalTextVisible(
      "I will update the file now.\nPATCH: src/app.js\nSEARCH:\n```js\nold\n```\n"
    );

    expect(panel._postMessage).toHaveBeenNthCalledWith(1, {
      type: "stream",
      text: "I will update the file now."
    });
    expect(panel._postMessage).toHaveBeenNthCalledWith(2, {
      type: "streamReplace",
      text: "I will update the file now.\nPATCH: src/app.js\nSEARCH:\n```js\nold\n```\n"
    });
  });

  test("preserves the full raw final response instead of summarizing it", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._postMessage = jest.fn();

    const controller = panel._createStreamDisplayController({
      bufferStructuredActions: true
    });

    controller.push("Updating the active file.\n");
    controller.ensureFinalTextVisible(
      [
        "Updating the active file.",
        "",
        "PATCH: src/app.js",
        "SEARCH:",
        "```js",
        "old",
        "```",
        "REPLACE:",
        "```js",
        "next",
        "```"
      ].join("\n"),
      {
      rawText: [
        "Updating the active file.",
        "",
        "PATCH: src/app.js",
        "SEARCH:",
        "```js",
        "old",
        "```",
        "REPLACE:",
        "```js",
        "next",
        "```"
      ].join("\n")
      }
    );

    expect(panel._postMessage).toHaveBeenNthCalledWith(2, {
      type: "streamReplace",
      text: [
        "Updating the active file.",
        "",
        "PATCH: src/app.js",
        "SEARCH:",
        "```js",
        "old",
        "```",
        "REPLACE:",
        "```js",
        "next",
        "```"
      ].join("\n")
    });
  });

  test("skips redundant final replace when the full raw reply was already streamed", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._postMessage = jest.fn();

    const controller = panel._createStreamDisplayController({
      bufferStructuredActions: true
    });
    const fullReply = [
      "Updating the active file.",
      "",
      "PATCH: src/app.js",
      "SEARCH:",
      "```js",
      "old",
      "```",
      "REPLACE:",
      "```js",
      "next",
      "```"
    ].join("\n");

    controller.push(fullReply);
    controller.ensureFinalTextVisible(fullReply, { rawText: fullReply });

    expect(panel._postMessage).toHaveBeenCalledTimes(1);
    expect(panel._postMessage).toHaveBeenCalledWith({
      type: "stream",
      text: fullReply
    });
  });

  test("discards the partial streamed answer when the AI stream fails", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._postMessage = jest.fn();
    panel._userStoppedGeneration = false;
    const streamController = {
      hasEmittedContent: jest.fn(() => true),
      ensureFinalTextVisible: jest.fn()
    };

    panel._handleChatStreamFailure(new Error("socket closed"), streamController);

    expect(streamController.ensureFinalTextVisible).not.toHaveBeenCalled();
    expect(panel._postMessage).toHaveBeenNthCalledWith(1, {
      type: "error",
      text: "AI error: socket closed"
    });
    expect(panel._postMessage).toHaveBeenNthCalledWith(2, {
      type: "done",
      discardCurrentMessage: true
    });
  });

  test("suppresses abort errors after the user stops generation", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._postMessage = jest.fn();
    panel._userStoppedGeneration = true;
    const streamController = {
      hasEmittedContent: jest.fn(() => true),
      ensureFinalTextVisible: jest.fn()
    };

    const result = panel._handleChatStreamFailure(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
      streamController
    );

    expect(result).toEqual({ suppressed: true });
    expect(streamController.ensureFinalTextVisible).not.toHaveBeenCalled();
    expect(panel._postMessage).not.toHaveBeenCalled();
  });

  test("replaces action-only structured replies with an execution summary in the chat bubble", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._stripStructuredActionsFromText = ChatPanel.prototype._stripStructuredActionsFromText;
    panel._findStructuredActionStart = ChatPanel.prototype._findStructuredActionStart;
    panel._buildStructuredActionDisplaySummary =
      ChatPanel.prototype._buildStructuredActionDisplaySummary;

    const visibleText = panel._buildVisibleAssistantText(
      {
        text: [
          "PATCH: src/app.js",
          "SEARCH:",
          "```js",
          "old",
          "```",
          "REPLACE:",
          "```js",
          "next",
          "```"
        ].join("\n"),
        actions: [
          {
            type: "patch",
            path: "src/app.js",
            search: "old\n",
            replace: "next\n"
          }
        ]
      },
      { preferStructuredSummary: true }
    );

    expect(visibleText).toBe(
      [
        "Model prepared executable changes.",
        "- Patch src/app.js",
        "Applying 1 patch now."
      ].join("\n")
    );
  });

  test("keeps prose while replacing raw structured actions with an execution summary", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._stripStructuredActionsFromText = ChatPanel.prototype._stripStructuredActionsFromText;
    panel._findStructuredActionStart = ChatPanel.prototype._findStructuredActionStart;
    panel._buildStructuredActionDisplaySummary =
      ChatPanel.prototype._buildStructuredActionDisplaySummary;

    const visibleText = panel._buildVisibleAssistantText(
      {
        text: [
          "Updating the active file and then verifying it.",
          "",
          "PATCH: src/app.js",
          "SEARCH:",
          "```js",
          "old",
          "```",
          "REPLACE:",
          "```js",
          "next",
          "```"
        ].join("\n"),
        actions: [
          {
            type: "patch",
            path: "src/app.js",
            search: "old\n",
            replace: "next\n"
          }
        ]
      },
      { preferStructuredSummary: true }
    );

    expect(visibleText).toBe(
      [
        "Updating the active file and then verifying it.",
        "",
        "Model prepared executable changes.",
        "- Patch src/app.js",
        "Applying 1 patch now."
      ].join("\n")
    );
  });

  test("keeps incomplete trailing PATCH content visible in the chat bubble", () => {
    const panel = Object.create(ChatPanel.prototype);

    const visibleText = panel._buildVisibleAssistantText(
      {
        text: [
          "Updating the active file and then verifying it.",
          "",
          "PATCH: index.html",
          "SEARCH:",
          "```html",
          "<style>",
          "  .nav-link"
        ].join("\n"),
        actions: [],
        warnings: ["Structured edit output appears incomplete; retrying may recover missing edits."]
      },
      { preferStructuredSummary: true }
    );

    expect(visibleText).toBe(
      [
        "Updating the active file and then verifying it.",
        "",
        "PATCH: index.html",
        "SEARCH:",
        "```html",
        "<style>",
        "  .nav-link"
      ].join("\n")
    );
  });

  test("keeps action-only incomplete structured output visible instead of replacing it", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.agent = {
      _hasIncompleteStructuredEditWarning: jest.fn(() => true)
    };

    const visibleText = panel._buildVisibleAssistantText(
      {
        text: [
          "PATCH: index.html",
          "SEARCH:",
          "```html",
          "<style>",
          "  .nav-link"
        ].join("\n"),
        actions: [],
        warnings: ["Structured edit output appears incomplete; retrying may recover missing edits."]
      },
      { preferStructuredSummary: true }
    );

    expect(visibleText).toBe(
      [
        "PATCH: index.html",
        "SEARCH:",
        "```html",
        "<style>",
        "  .nav-link"
      ].join("\n")
    );
  });

  test("falls back to the latest undo entry when a stale id is sent for the only pending edit", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._undoStack = [
      {
        id: "undo-live",
        sessionId: "session-a",
        filePath: "/workspace/index.html",
        before: "<p>before</p>\n",
        after: "<p>after</p>\n",
        label: "edit",
        ts: Date.now()
      }
    ];
    panel.agent = {
      getSessionState: jest.fn(() => ({ currentSessionId: "session-a" }))
    };
    panel._postMessage = jest.fn();
    panel._postUndoState = jest.fn();
    panel._findEditorForFile = jest.fn(() => null);
    panel.agent.applyChanges = jest.fn().mockResolvedValue({
      success: true,
      path: "/workspace/index.html"
    });

    const result = await panel._undoEdit("undo-stale");

    expect(result).toEqual({ success: true });
    expect(panel.agent.applyChanges).toHaveBeenCalledWith(
      "/workspace/index.html",
      "<p>before</p>\n",
      true,
      { allowEmpty: true, allowDocTruncate: true }
    );
    expect(panel._postMessage).toHaveBeenCalledWith({
      type: "editUndone",
      id: "undo-live"
    });
  });

  test("workspace preparation only runs for explicit repo-wide requests", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(panel._shouldPrepareWorkspaceContext("debug", "scan the active file", "bugfix")).toBe(false);
    expect(panel._shouldPrepareWorkspaceContext("scan", "scan the workspace", "heavy")).toBe(true);
    expect(panel._shouldPrepareWorkspaceContext("debug", "fix package.json version handling", "heavy")).toBe(false);
    expect(panel._shouldPrepareWorkspaceContext("explain", "explain the current file", "deep")).toBe(false);
    expect(panel._shouldPrepareWorkspaceContext("explain", "walk through the repo architecture", "deep")).toBe(true);
    expect(panel._shouldPrepareWorkspaceContext("edit", "refactor this across the repository", "fast")).toBe(false);
  });

  test("resolves gstack slash commands into workflow requests", () => {
    const panel = Object.create(ChatPanel.prototype);

    const result = panel._resolveGStackRequest("/qa inspect the current login flow");

    expect(result).toMatchObject({
      type: "workflow",
      command: "/qa",
      mode: "heavy",
      statusText: "GStack workflow: QA Sweep",
      userMessage: "inspect the current login flow"
    });
  });

  test("resolves /gstack into a writable Codex-style workflow", () => {
    const panel = Object.create(ChatPanel.prototype);

    const result = panel._resolveGStackRequest(
      "/gstack scaffold the auth pages and supporting folders"
    );

    expect(result).toMatchObject({
      type: "workflow",
      command: "/gstack",
      mode: "heavy",
      statusText: "GStack workflow: Codex Build",
      userMessage: "scaffold the auth pages and supporting folders",
      allowsWrites: true,
      executionStyle: "codex",
      forceStructuredEdits: true
    });
  });

  test("smart gstack gate triggers for risky multi-file edits", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._getGStackGateMode = jest.fn(() => "smart");

    const decision = panel._getGStackGateDecision(
      "Refactor auth routing and update config",
      [
        { type: "patch", path: "src/extension.js", search: "old", replace: "new" },
        { type: "file", path: "package.json", content: "{\n  \"name\": \"code-janitor\"\n}\n" }
      ],
      { requestMode: "heavy" }
    );

    expect(decision.enabled).toBe(true);
    expect(decision.reasons).toEqual(
      expect.arrayContaining(["multiple files", "full-file rewrite or creation", "high-impact path", "high-risk request"])
    );
  });

  test("smart gstack gate skips small targeted patches", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._getGStackGateMode = jest.fn(() => "smart");

    const decision = panel._getGStackGateDecision(
      "Fix the button label in the active file",
      [
        { type: "patch", path: "src/ui/button.js", search: "Save", replace: "Apply" }
      ],
      { requestMode: "fast" }
    );

    expect(decision.enabled).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  test("smart gstack gate skips single-file documentation edits", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._getGStackGateMode = jest.fn(() => "smart");

    const decision = panel._getGStackGateDecision(
      "Update the README installation steps",
      [
        {
          type: "patch",
          path: "README.md",
          search: "# Install\n" + "old ".repeat(600),
          replace: "# Install\n" + "new ".repeat(600)
        }
      ],
      { requestMode: "heavy" }
    );

    expect(decision.enabled).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  test("smart gstack gate treats apply_diff edits as editable workflow actions", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._getGStackGateMode = jest.fn(() => "smart");

    const decision = panel._getGStackGateDecision(
      "Rewrite the package metadata safely",
      [
        {
          type: "apply_diff",
          path: "package.json",
          diff: [
            "<<<<<<< SEARCH",
            ":start_line: 2",
            "-------",
            '  "name": "old-name",',
            "=======",
            '  "name": "new-name",',
            ">>>>>>> REPLACE"
          ].join("\n")
        }
      ],
      { requestMode: "fast" }
    );

    expect(decision.enabled).toBe(true);
    expect(decision.reasons).toEqual(expect.arrayContaining(["high-impact path"]));
  });

  test("smart gstack gate can use optimizer review signals when heuristics stay quiet", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._getGStackGateMode = jest.fn(() => "smart");
    panel._shouldSkipGate = jest.fn(() => ({
      skip: false,
      reason: "high_risk",
      risk: "high",
      confidence: 0.54
    }));

    const decision = panel._getGStackGateDecision(
      "Apply a broad diff to the active source file",
      [
        {
          type: "apply_diff",
          path: "src/ui/button.js",
          diff: "<<<<<<< SEARCH\n:start_line: 1\n-------\nold\n=======\nnew\n>>>>>>> REPLACE"
        }
      ],
      { requestMode: "fast" }
    );

    expect(panel._shouldSkipGate).toHaveBeenCalled();
    expect(decision.enabled).toBe(true);
    expect(decision.reasons).toEqual(["optimizer high-risk edit"]);
  });

  test("always gstack gate reviews any AI-generated edit plan", () => {
    const panel = Object.create(ChatPanel.prototype);

    const decision = panel._getGStackGateDecision(
      "Update the active file",
      [{ type: "patch", path: "src/app.js", search: "a", replace: "b" }],
      { gateMode: "always", requestMode: "fast" }
    );

    expect(decision.enabled).toBe(true);
    expect(decision.reasons).toEqual(["always mode"]);
  });

  test("gstack gate skips oversized full-file rewrites that would be truncated in review", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._getGStackGateMode = jest.fn(() => "smart");

    const decision = panel._getGStackGateDecision(
      "Enhance the portfolio page with a full rewritten index.html",
      [
        {
          type: "file",
          path: "index.html",
          content: "<!DOCTYPE html>\n" + "x".repeat(2600)
        }
      ],
      { requestMode: "deep" }
    );

    expect(decision.enabled).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  test("normalizes gstack gate mode values for the panel", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(panel._normalizeGStackGateMode("ALWAYS")).toBe("always");
    expect(panel._normalizeGStackGateMode("off")).toBe("off");
    expect(panel._normalizeGStackGateMode("something-else")).toBe("smart");
  });

  test("explicit gstack workflows do not bypass risky edit gating", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel._getGStackGateMode = jest.fn(() => "smart");

    const decision = panel._getGStackGateDecision(
      "Refactor auth routing and update config",
      [
        { type: "patch", path: "src/extension.js", search: "old", replace: "new" },
        { type: "file", path: "package.json", content: "{\n  \"name\": \"code-janitor\"\n}\n" }
      ],
      { requestMode: "heavy", explicitWorkflowId: "eng-review" }
    );

    expect(decision.enabled).toBe(true);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "multiple files",
        "full-file rewrite or creation",
        "high-impact path",
        "high-risk request"
      ])
    );
  });

  test("detects explicit tool-oriented command requests", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(panel._hasExplicitCommandRequest("use rg to find the config")).toBe(true);
    expect(panel._hasExplicitCommandRequest("run npm test")).toBe(true);
    expect(panel._hasExplicitCommandRequest("fix this bug")).toBe(false);
  });

  test("suppresses generated commands only when edits are also being applied implicitly", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(
      panel._shouldSuppressGeneratedCommand(true, false, [
        { type: "patch", path: "src/app.js" },
        { type: "cmd", command: "npm test" }
      ], "npm install axios")
    ).toBe(true);
    expect(
      panel._shouldSuppressGeneratedCommand(true, false, [
        { type: "cmd", command: "npm test" }
      ], "npm test")
    ).toBe(false);
    expect(
      panel._shouldSuppressGeneratedCommand(true, true, [
        { type: "patch", path: "src/app.js" },
        { type: "cmd", command: "npm test" }
      ], "npm test")
    ).toBe(false);
  });

  test("keeps context and verification commands available during edit flows", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(
      panel._shouldSuppressGeneratedCommand(
        true,
        false,
        [
          { type: "patch", path: "src/app.js" },
          { type: "cmd", command: "Get-Content package.json" }
        ],
        "Get-Content package.json"
      )
    ).toBe(false);

    expect(
      panel._shouldSuppressGeneratedCommand(
        true,
        false,
        [
          { type: "patch", path: "src/app.js" },
          { type: "cmd", command: "npm test" }
        ],
        "npm test"
      )
    ).toBe(false);
  });

  test("detects inspection-only action sets for the grounded edit loop", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(
      panel._hasOnlyInspectionActions([
        { type: "read", path: "src/app.js" },
        { type: "grep", query: "handleSubmit" }
      ])
    ).toBe(true);
    expect(
      panel._hasOnlyInspectionActions([
        { type: "read", path: "src/app.js" },
        { type: "patch", path: "src/app.js", search: "a", replace: "b" }
      ])
    ).toBe(false);
  });

  test("inspection round reads real file contents and re-prompts for executable edits", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cj-inspect-loop-"));
    const relativePath = "src/app.js";
    const fullPath = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "const answer = 41;\n", "utf8");

    panel.agent = {
      chat: jest.fn().mockResolvedValue({
        text: "PATCH: src/app.js",
        actions: [
          {
            type: "patch",
            path: "src/app.js",
            search: "const answer = 41;\n",
            replace: "const answer = 42;\n"
          }
        ]
      })
    };
    panel._postMessage = jest.fn();
    panel._shouldSuppressInternalStatus = jest.fn(() => false);

    const response = await panel._runAgenticInspectionRound(
      "fix src/app.js",
      [{ type: "read", path: relativePath }],
      workspaceRoot,
      { provider: "custom:test", model: "gpt-like" },
      "fast"
    );

    expect(panel.agent.chat).toHaveBeenCalledTimes(1);
    expect(panel.agent.chat.mock.calls[0][0]).toContain("Inspection results:");
    expect(panel.agent.chat.mock.calls[0][0]).toContain("READ: src/app.js");
    expect(panel.agent.chat.mock.calls[0][0]).toContain("const answer = 41;");
    expect(panel.agent.chat.mock.calls[0][4]).toMatchObject({
      mode: "heavy",
      intentOverride: "edit",
      interactionStyle: "agent_loop",
      runtimeConfig: { provider: "custom:test", model: "gpt-like" },
      skipHistory: true
    });
    expect(response.actions).toEqual([
      {
        type: "patch",
        path: "src/app.js",
        search: "const answer = 41;\n",
        replace: "const answer = 42;\n"
      }
    ]);
  });

  test("evidence round re-prompts after mixed tool actions", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.agent = {
      chat: jest.fn().mockResolvedValue({
        text: "PATCH: src/app.js",
        actions: [
          {
            type: "patch",
            path: "src/app.js",
            search: "const answer = 41;\n",
            replace: "const answer = 42;\n"
          }
        ]
      })
    };
    panel._postMessage = jest.fn();
    panel._shouldSuppressInternalStatus = jest.fn(() => false);
    panel._detectIntent = jest.fn(() => "edit");
    panel._runEvidenceGatheringAction = jest
      .fn()
      .mockResolvedValueOnce({
        success: true,
        transcript: "READ: src/app.js\n```js\nconst answer = 41;\n```"
      })
      .mockResolvedValueOnce({
        success: true,
        transcript: "GITHUB_CONTEXT: {\"mode\":\"repo\"}\n```text\nRepo summary\n```"
      });

    const response = await panel._runAgenticEvidenceRound(
      "fix src/app.js",
      [
        { type: "read", path: "src/app.js" },
        { type: "github_context", mode: "repo", owner: "demo", repo: "repo" }
      ],
      "/workspace",
      { provider: "custom:test", model: "gpt-like" },
      "fast",
      "overlay"
    );

    expect(panel.agent.chat).toHaveBeenCalledTimes(1);
    expect(panel.agent.chat.mock.calls[0][0]).toContain("Tool results:");
    expect(panel.agent.chat.mock.calls[0][0]).toContain("READ: src/app.js");
    expect(panel.agent.chat.mock.calls[0][0]).toContain("Repo summary");
    expect(panel.agent.chat.mock.calls[0][4]).toMatchObject({
      mode: "heavy",
      intentOverride: "edit",
      interactionStyle: "agent_loop",
      runtimeConfig: { provider: "custom:test", model: "gpt-like" },
      skipHistory: true,
      systemOverlay: "overlay"
    });
    expect(response.actions).toEqual([
      {
        type: "patch",
        path: "src/app.js",
        search: "const answer = 41;\n",
        replace: "const answer = 42;\n"
      }
    ]);
  });

  test("recovers a failed patch by requesting a broader patch and applying it", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.chatMode = "fast";
    const runtimeConfig = {
      provider: "custom:test",
      model: "gpt-like",
      customProvider: {
        apiKey: "secret",
        chatCompletionsUrl: "https://example.test/v1/chat/completions"
      }
    };
    panel.agent = {
      chat: jest.fn().mockResolvedValue({
        text: "PATCH: package.json",
        actions: [
          {
            type: "patch",
            path: "package.json",
            search: "\"version\": \"1.16.5\"",
            replace: "\"version\": \"1.16.6\""
          }
        ]
      }),
      applyChanges: jest.fn().mockResolvedValue({
        success: true,
        path: "/workspace/package.json",
        relativePath: "package.json",
        changeSummary: "1 replacement"
      })
    };
    panel._postMessage = jest.fn();
    panel._shouldSuppressInternalStatus = jest.fn(() => false);

    const result = await panel._recoverFailedPatch(
      "bump the version in package.json",
      "/workspace",
      {
        type: "patch",
        path: "package.json",
        search: "\"version\": \"1.16.4\"",
        replace: "\"version\": \"1.16.6\""
      },
      "{\n  \"version\": \"1.16.5\"\n}\n",
      false,
      {},
      runtimeConfig
    );

    expect(panel.agent.chat).toHaveBeenCalledTimes(1);
    expect(panel.agent.chat.mock.calls[0][0]).toContain("Prefer exactly one PATCH action");
    expect(panel.agent.chat.mock.calls[0][4]).toMatchObject({
      mode: "heavy",
      intentOverride: "edit",
      runtimeConfig
    });
    expect(panel.agent.applyChanges).toHaveBeenCalledWith(
      "package.json",
      "{\n  \"version\": \"1.16.6\"\n}\n",
      false,
      { workspaceRoot: "/workspace" }
    );
    expect(result.success).toBe(true);
  });

  test("falls back to FILE when patch retries are still unreliable", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.chatMode = "heavy";
    const runtimeConfig = {
      provider: "custom:test",
      model: "gpt-like",
      customProvider: {
        apiKey: "secret",
        chatCompletionsUrl: "https://example.test/v1/chat/completions"
      }
    };
    panel.agent = {
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          text: "PATCH: package.json",
          actions: [
            {
              type: "patch",
              path: "package.json",
              search: "\"version\": \"9.9.9\"",
              replace: "\"version\": \"1.16.6\""
            }
          ]
        })
        .mockResolvedValueOnce({
          text: "FILE: package.json",
          actions: [
            {
              type: "file",
              path: "package.json",
              content: "{\n  \"version\": \"1.16.6\"\n}\n"
            }
          ]
        }),
      applyChanges: jest.fn().mockResolvedValue({
        success: true,
        path: "/workspace/package.json",
        relativePath: "package.json",
        changeSummary: "rewrote file"
      })
    };
    panel._postMessage = jest.fn();
    panel._shouldSuppressInternalStatus = jest.fn(() => false);

    const result = await panel._recoverFailedPatch(
      "bump the version in package.json",
      "/workspace",
      {
        type: "patch",
        path: "package.json",
        search: "\"version\": \"1.16.4\"",
        replace: "\"version\": \"1.16.6\""
      },
      "{\n  \"version\": \"1.16.5\"\n}\n",
      false,
      {},
      runtimeConfig
    );

    expect(panel.agent.chat).toHaveBeenCalledTimes(2);
    expect(panel.agent.chat.mock.calls[1][0]).toContain("Return exactly one FILE action");
    expect(panel.agent.chat.mock.calls[0][4]).toMatchObject({
      mode: "heavy",
      intentOverride: "edit",
      runtimeConfig
    });
    expect(panel.agent.chat.mock.calls[1][4]).toMatchObject({
      mode: "heavy",
      intentOverride: "edit",
      runtimeConfig
    });
    expect(panel.agent.applyChanges).toHaveBeenCalledWith(
      "package.json",
      "{\n  \"version\": \"1.16.6\"\n}\n",
      false,
      { workspaceRoot: "/workspace" }
    );
    expect(result.success).toBe(true);
  });

  test("post-edit verification auto-repairs syntax errors in changed files", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const runtimeConfig = {
      provider: "custom:test",
      model: "gpt-like"
    };
    panel.agent = {
      _runSyntaxCheck: jest.fn().mockResolvedValue({
        success: false,
        error: "Unexpected token"
      })
    };
    panel._repairSyntaxForWorkspaceFile = jest.fn().mockResolvedValue({
      success: true,
      applyResult: {
        success: true,
        created: false,
        path: "/workspace/src/app.js",
        relativePath: "src/app.js",
        previousContent: "const value = ;\n",
        newContent: "const value = 1;\n",
        changeSummary: "fixed syntax"
      }
    });
    panel._registerEditForUndo = jest.fn(() => 42);
    panel._revealWorkspaceFile = jest.fn().mockResolvedValue();
    panel._runFrontendVerificationForFile = jest.fn().mockResolvedValue({
      success: true,
      issues: []
    });
    panel._getPostEditVerificationCommands = jest.fn(() => []);
    panel._postMessage = jest.fn();

    const result = await panel._runPostEditVerification(
      "/workspace",
      ["src/app.js"],
      runtimeConfig,
      {}
    );

    expect(panel._repairSyntaxForWorkspaceFile).toHaveBeenCalledWith(
      "src/app.js",
      "/workspace",
      { success: false, error: "Unexpected token" },
      {},
      runtimeConfig
    );
    expect(panel._registerEditForUndo).toHaveBeenCalledWith({
      filePath: "/workspace/src/app.js",
      before: "const value = ;\n",
      after: "const value = 1;\n",
      label: "syntax-fix"
    });
    expect(panel._revealWorkspaceFile).toHaveBeenCalledWith("/workspace/src/app.js");
    expect(result.success).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        { file: "src/app.js", check: "js-syntax-auto-fix", passed: true }
      ])
    );
    expect(panel._postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "applied",
        undoId: 42
      })
    );
  });

  test("post-edit verification reports frontend dependency issues", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cj-frontend-verify-"));
    const relativePath = "pages/index.html";
    const fullPath = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(
      fullPath,
      "<!DOCTYPE html><html><head><link rel=\"stylesheet\" href=\"./missing.css\"></head><body></body></html>",
      "utf8"
    );

    panel.agent = {
      _runSyntaxCheck: jest.fn().mockResolvedValue({ success: true })
    };
    panel._getPostEditVerificationCommands = jest.fn(() => []);
    panel._postMessage = jest.fn();

    const result = await panel._runPostEditVerification(
      workspaceRoot,
      [relativePath],
      null,
      {}
    );

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: relativePath,
          type: "frontend"
        })
      ])
    );
    expect(panel._postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status",
        text: expect.stringContaining(`Frontend validation found issues in ${relativePath}`)
      })
    );
  });

  test("frontend verification uses graph context to resolve workspace-wide assets", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cj-frontend-graph-"));
    const relativePath = "packages/app/pages/index.html";
    const fullPath = path.join(workspaceRoot, relativePath);
    const sharedLogoPath = path.join(workspaceRoot, "shared", "logo.png");
    const graphDir = path.join(workspaceRoot, "graphify-out");

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.mkdirSync(path.dirname(sharedLogoPath), { recursive: true });
    fs.mkdirSync(graphDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "package.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "packages", "app", "package.json"), "{}\n", "utf8");
    fs.writeFileSync(sharedLogoPath, "png", "utf8");
    fs.writeFileSync(
      fullPath,
      "<img src=\"shared/logo.png\" alt=\"Shared logo\">",
      "utf8"
    );
    fs.writeFileSync(
      path.join(graphDir, "graph.json"),
      JSON.stringify({
        nodes: [{ path: "shared/logo.png", type: "asset" }],
        edges: []
      }),
      "utf8"
    );

    const result = await panel._runFrontendVerificationForFile(
      workspaceRoot,
      relativePath
    );

    expect(result).toEqual({
      success: true,
      issues: []
    });
  });

  test("failed syntax repair restores the previous file contents", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cj-repair-rollback-"));
    const relativePath = "src/app.js";
    const fullPath = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "const value = ;\n", "utf8");

    panel._requestSyntaxFixAction = jest.fn().mockResolvedValue({
      success: true,
      fileAction: {
        type: "file",
        path: relativePath,
        content: "const value = broken(\n"
      }
    });
    panel._withWorkspaceRoot = ChatPanel.prototype._withWorkspaceRoot;
    panel.agent = {
      applyChanges: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          created: false,
          path: fullPath,
          relativePath,
          previousContent: "const value = ;\n",
          newContent: "const value = broken(\n",
          changeSummary: "rewrote file"
        })
        .mockResolvedValueOnce({
          success: true,
          created: false,
          path: fullPath,
          relativePath,
          previousContent: "const value = broken(\n",
          newContent: "const value = ;\n",
          changeSummary: "restored file"
        }),
      _runSyntaxCheck: jest.fn().mockResolvedValue({
        success: false,
        error: "Unexpected end of input"
      })
    };

    const result = await panel._repairSyntaxForWorkspaceFile(
      relativePath,
      workspaceRoot,
      { success: false, error: "Unexpected token" },
      {},
      { provider: "custom:test" }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Restored the previous file contents.");
    expect(panel.agent.applyChanges).toHaveBeenNthCalledWith(
      2,
      relativePath,
      "const value = ;\n",
      false,
      { allowEmpty: true, allowDocTruncate: true, workspaceRoot }
    );
  });

  test("syntax repair escalates to deep mode for large files and blocks incomplete structured output", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const largeFile = `${"const item = 1;\n".repeat(1300)}function broken( {\n`;
    panel._buildSyntaxFixPrompt = ChatPanel.prototype._buildSyntaxFixPrompt;
    panel._getSyntaxFixLanguage = ChatPanel.prototype._getSyntaxFixLanguage;
    panel._sanitizeSyntaxErrorOutput = ChatPanel.prototype._sanitizeSyntaxErrorOutput;
    panel._getSyntaxFixRequestMode = ChatPanel.prototype._getSyntaxFixRequestMode;
    panel._shouldBlockIncompleteStructuredExecution =
      ChatPanel.prototype._shouldBlockIncompleteStructuredExecution;
    panel._hasExecutableFileAction = ChatPanel.prototype._hasExecutableFileAction;
    panel.agent = {
      chat: jest.fn().mockResolvedValue({
        text: "Structured edit output was incomplete.",
        actions: [
          {
            type: "file",
            path: "src/app.js",
            content: largeFile
          }
        ],
        warnings: ["Structured edit output appears incomplete."]
      }),
      _hasIncompleteStructuredEditWarning: jest.fn(() => true),
      _buildIncompleteStructuredEditMessage: jest.fn(() => "blocked")
    };

    const result = await panel._requestSyntaxFixAction(
      "/workspace/src/app.js",
      "src/app.js",
      largeFile,
      { success: false, error: "Unexpected token" },
      "/workspace",
      { provider: "custom:test" }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("incomplete");
    expect(panel.agent.chat).toHaveBeenCalledWith(
      expect.any(String),
      "/workspace",
      null,
      null,
      expect.objectContaining({ mode: "deep" })
    );
  });

  test("active syntax repair rolls the editor back when verification still fails", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const activeEditor = {
      document: {
        uri: { scheme: "file" },
        fileName: "/workspace/src/app.js",
        getText: jest
          .fn()
          .mockReturnValueOnce("const value = ;\n")
          .mockReturnValueOnce("const value = broken(\n"),
        save: jest.fn().mockResolvedValue(true)
      }
    };

    panel._getCurrentFileEditor = jest.fn(() => activeEditor);
    panel._requestSyntaxFixAction = jest.fn().mockResolvedValue({
      success: true,
      fileAction: {
        type: "file",
        path: "src/app.js",
        content: "const value = broken(\n"
      },
      errorOutput: "Unexpected token"
    });
    panel._getEffectiveAiConfig = jest.fn().mockResolvedValue({
      provider: "custom:test"
    });
    panel._assessEditSafetyBeforeApply = jest.fn().mockResolvedValue({ ok: true });
    panel._applyToEditor = jest
      .fn()
      .mockResolvedValueOnce({
        success: true,
        path: "/workspace/src/app.js",
        relativePath: "app.js",
        previousContent: "const value = ;\n",
        newContent: "const value = broken(\n"
      })
      .mockResolvedValueOnce({
        success: true,
        path: "/workspace/src/app.js",
        relativePath: "app.js",
        previousContent: "const value = broken(\n",
        newContent: "const value = ;\n"
      });
    panel._registerEditForUndo = jest.fn();
    panel._postFixInsights = jest.fn();
    panel._postMessage = jest.fn();
    panel.agent = {
      _runSyntaxCheck: jest
        .fn()
        .mockResolvedValueOnce({ success: false, error: "Unexpected token" })
        .mockResolvedValueOnce({ success: false, error: "Unexpected end of input" })
    };

    await panel._runActiveSyntaxFix("/workspace");

    expect(panel._applyToEditor).toHaveBeenNthCalledWith(
      2,
      activeEditor,
      "const value = ;\n"
    );
    expect(panel._postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        text: expect.stringContaining("restored automatically")
      })
    );
  });

  test("falls back to the raw MCP config text when initialization fails", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cj-mcp-ui-"));
    const configPath = path.join(workspaceRoot, "mcp.config.json");
    const invalidConfigText = '{\n  "mcpServers": {\n    "filesystem":\n';

    fs.writeFileSync(configPath, invalidConfigText, "utf8");

    try {
      const panel = Object.create(ChatPanel.prototype);
      panel._ensureMcpReady = jest.fn().mockResolvedValue(null);
      panel._getMcpWorkspaceRoot = jest.fn(() => workspaceRoot);
      panel._lastMcpInitializationError = "Unexpected end of JSON input";

      const settings = await panel._getMcpSettings();

      expect(settings.workspaceRoot).toBe(workspaceRoot);
      expect(settings.configPath).toBe(configPath);
      expect(settings.configText).toBe(invalidConfigText);
      expect(settings.initializationError).toContain("Unexpected end");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("saves MCP config through the loader when the manager is not initialized yet", async () => {
    const panel = Object.create(ChatPanel.prototype);
    const save = jest.fn().mockResolvedValue(undefined);
    const initialize = jest.fn().mockResolvedValue(undefined);
    panel.mcpClientManager = {
      configLoader: { save },
      initialize
    };
    panel._ensureMcpReady = jest.fn().mockResolvedValue(null);
    panel._getMcpWorkspaceRoot = jest.fn(() => "/workspace");
    panel._postMcpSettings = jest.fn().mockResolvedValue(undefined);
    panel._lastMcpInitializationError = "bad config";

    await panel._saveMcpConfig('{"mcpServers":{}}');

    expect(save).toHaveBeenCalledWith("/workspace", '{"mcpServers":{}}');
    expect(initialize).toHaveBeenCalledWith("/workspace");
    expect(panel._lastMcpInitializationError).toBe("");
    expect(panel._postMcpSettings).toHaveBeenCalled();
  });

  test("opens mcp.config.json even when MCP initialization is failing", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.mcpClientManager = {
      getUiState: jest.fn(() => ({
        configPath: "/workspace/mcp.config.json"
      }))
    };
    panel._getMcpWorkspaceRoot = jest.fn(() => "/workspace");
    panel._revealWorkspaceFile = jest.fn().mockResolvedValue(undefined);
    panel._postMessage = jest.fn();

    await panel._handleMcpSettingsAction("openMcpConfig");

    expect(panel._revealWorkspaceFile).toHaveBeenCalledWith(
      "/workspace/mcp.config.json"
    );
    expect(panel._postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status",
        text: "Opened mcp.config.json."
      })
    );
  });
});
