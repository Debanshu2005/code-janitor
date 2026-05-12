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
      getWorkspaceFolder: jest.fn()
    }
  }),
  { virtual: true }
);

const vscode = require("vscode");
const AIAgent = require("../agent");

describe("AIAgent structured edit parsing", () => {
  afterEach(() => {
    vscode.workspace.workspaceFolders = [];
    vscode.workspace.getWorkspaceFolder.mockReset();
    vscode.window.activeTextEditor = null;
  });

  test("treats PATCH actions as valid edit actions", () => {
    const agent = new AIAgent();
    const response = [
      "PATCH: src/example.js",
      "SEARCH:",
      "```js",
      "const answer = 41;",
      "```",
      "REPLACE:",
      "```js",
      "const answer = 42;",
      "```"
    ].join("\n");

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toEqual([
      {
        type: "patch",
        path: "src/example.js",
        search: "const answer = 41;\n",
        replace: "const answer = 42;\n"
      }
    ]);
    expect(
      agent._hasRequiredActions("edit", "please edit src/example.js", parsed.actions)
    ).toBe(true);
  });

  test("normalizes terminated streaming errors into a helpful provider message", () => {
    const agent = new AIAgent();

    const message = agent._normalizeAiError(
      { message: "terminated" },
      { provider: "nvidia" }
    );

    expect(message).toContain("NVIDIA NIM");
    expect(message).toContain("closed while streaming");
  });

  test("normalizes Ollama connection refusals into a local-server hint", () => {
    const agent = new AIAgent();

    const message = agent._normalizeAiError(
      { message: "fetch failed", cause: { code: "ECONNREFUSED" } },
      { provider: "ollama", ollamaUrl: "http://localhost:11434" }
    );

    expect(message).toContain("Could not connect to Ollama");
    expect(message).toContain("http://localhost:11434");
  });

  test("normalizes multimodal mismatch errors into an image-support hint", () => {
    const agent = new AIAgent();

    const message = agent._normalizeAiError(
      { message: "/config/models/mystidia is not a multimodal model None" },
      { provider: "custom:mystidia", model: "mystidia" }
    );

    expect(message).toContain("does not support image input");
    expect(message).toContain("mystidia");
  });

  test("parses PATCH blocks with CRLF line endings", () => {
    const agent = new AIAgent();
    const response =
      "PATCH: src/example.js\r\nSEARCH:\r\n```js\r\nold line\r\n```\r\nREPLACE:\r\n```js\r\nnew line\r\n```";

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]).toMatchObject({
      type: "patch",
      path: "src/example.js",
      search: "old line\r\n",
      replace: "new line\r\n"
    });
  });

  test("ignores action-like tokens inside PATCH replacement content", () => {
    const agent = new AIAgent();
    const response = [
      "PATCH: docs/runbook.md",
      "SEARCH:",
      "```md",
      "Run the old workflow.",
      "```",
      "REPLACE:",
      "```md",
      "CMD: npm test",
      "MKDIR: docs/examples",
      "```",
      "CMD: npm run lint"
    ].join("\n");

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toEqual([
      {
        type: "patch",
        path: "docs/runbook.md",
        search: "Run the old workflow.\n",
        replace: "CMD: npm test\nMKDIR: docs/examples\n"
      },
      {
        type: "cmd",
        command: "npm run lint"
      }
    ]);
  });

  test("ignores command-like lines inside FILE content", () => {
    const agent = new AIAgent();
    const response = [
      "FILE: docs/runbook.md",
      "```md",
      "CMD: npm test",
      "FETCH: https://example.com",
      "```"
    ].join("\n");

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toEqual([
      {
        type: "file",
        path: "docs/runbook.md",
        language: "text",
        content: "CMD: npm test\nFETCH: https://example.com\n"
      }
    ]);
  });

  test("recovers a trailing FILE action even when its closing fence is missing", () => {
    const agent = new AIAgent();
    const response = [
      "PATCH: src/example.js",
      "SEARCH:",
      "```js",
      "const answer = 41;",
      "```",
      "REPLACE:",
      "```js",
      "const answer = 42;",
      "```",
      "",
      "FILE: docs/runbook.md",
      "```md",
      "# Runbook",
      "Updated instructions"
    ].join("\n");

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toEqual([
      {
        type: "patch",
        path: "src/example.js",
        search: "const answer = 41;\n",
        replace: "const answer = 42;\n"
      },
      {
        type: "file",
        path: "docs/runbook.md",
        language: "text",
        content: "# Runbook\nUpdated instructions"
      }
    ]);
  });

  test("warns when a PATCH action is still incomplete after parsing", () => {
    const agent = new AIAgent();
    const response = [
      "PATCH: src/example.js",
      "SEARCH:",
      "```js",
      "const answer = 41;",
      "```",
      "REPLACE:",
      "```js",
      "const answer = 42;"
    ].join("\n");

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toEqual([]);
    expect(parsed.warnings).toContain(
      "Structured edit output appears incomplete; retrying may recover missing edits."
    );
  });

  test("allows clarifying questions for edit requests without treating them as invalid prose", () => {
    const agent = new AIAgent();
    const response =
      "Which file should I update, and what exact behavior do you want changed?";

    expect(
      agent._isClarificationResponse(response, "edit", "fix this for me")
    ).toBe(true);
  });

  test("parses CMD actions as executable command steps", () => {
    const agent = new AIAgent();
    const response = "CMD: npm test";

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toEqual([
      {
        type: "cmd",
        command: "npm test"
      }
    ]);
  });

  test("prefers source files over generated copies when matching path hints", () => {
    const agent = new AIAgent();
    agent.codebaseContext = new Map([
      ["src/ai-agent/chat-panel.html", {}],
      [".tmp-vsix-100/extension/src/ai-agent/chat-panel.html", {}]
    ]);

    expect(agent._matchPathsFromHints(["src/ai-agent/chat-panel.html"])).toEqual([
      "src/ai-agent/chat-panel.html"
    ]);
  });

  test("resolve workspace path honors the caller workspace root", () => {
    const agent = new AIAgent();
    const workspaceOne = fs.mkdtempSync(path.join(os.tmpdir(), "cj-root-one-"));
    const workspaceTwo = fs.mkdtempSync(path.join(os.tmpdir(), "cj-root-two-"));
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceOne } }];

    const resolved = agent._resolveWorkspacePath("src/app.js", workspaceTwo);

    expect(resolved.workspaceRoot).toBe(workspaceTwo);
    expect(resolved.fullPath).toBe(path.resolve(workspaceTwo, "src/app.js"));
    expect(resolved.outsideWorkspace).toBe(false);
  });

  test("deleteSession removes the current chat and selects the newest remaining session", () => {
    const agent = new AIAgent();
    agent.createSession("Second chat");
    const secondId = agent.getSessionState().currentSessionId;
    agent.createSession("Third chat");
    const thirdId = agent.getSessionState().currentSessionId;

    const state = agent.deleteSession(thirdId);

    expect(state.currentSessionId).toBe(secondId);
    expect(state.sessions.map((session) => session.id)).toEqual(
      expect.not.arrayContaining([thirdId])
    );
  });

  test("deleteSession recreates a blank chat when deleting the last saved session", () => {
    const agent = new AIAgent();
    const originalId = agent.getSessionState().currentSessionId;

    const state = agent.deleteSession(originalId);

    expect(state.sessions).toHaveLength(1);
    expect(state.currentSessionId).toBe(state.sessions[0].id);
    expect(state.currentSessionId).not.toBe(originalId);
    expect(state.currentSessionTitle).toBe("New Chat 1");
    expect(state.history).toEqual([]);
  });

  test("applyChanges rejects paths that resolve to directories", async () => {
    const agent = new AIAgent();
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cj-dir-target-"));
    const directoryTarget = path.join(workspaceRoot, "index.html");
    fs.mkdirSync(directoryTarget, { recursive: true });

    const result = await agent._applyChangesInternal({
      filePath: "index.html",
      newContent: "<html></html>\n",
      allowOutsideWorkspace: false,
      allowEmpty: false,
      allowDocTruncate: false,
      workspaceRoot
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("directory")
    });
  });

  test("allows internal list commands with --format flags but still blocks chained commands", () => {
    const agent = new AIAgent();

    expect(agent.validateCommand("pip list --format=json")).toEqual({
      allowed: true
    });
    expect(agent.validateCommand("arduino-cli lib list --format json")).toEqual({
      allowed: true
    });
    expect(agent.validateCommand("npm test && git status")).toEqual({
      allowed: false,
      reason: "Use one project-scoped command per CMD line (no chaining)"
    });
  });

  test("allows safe PowerShell read commands for workspace inspection", () => {
    const agent = new AIAgent();

    expect(agent.validateCommand("Get-ChildItem")).toEqual({
      allowed: true
    });
    expect(agent.validateCommand("Get-Content package.json")).toEqual({
      allowed: true
    });
    expect(agent.validateCommand("Select-String -Path src/ai-agent/agent.js -Pattern thinking")).toEqual({
      allowed: true
    });
  });

  test("allows limited safe npm command access while blocking executor-style commands", () => {
    const agent = new AIAgent();

    expect(agent.validateCommand("npm --version")).toEqual({
      allowed: true
    });
    expect(agent.validateCommand("npm run lint -- --fix")).toEqual({
      allowed: true
    });
    expect(agent.validateCommand("npm exec jest -- --runInBand")).toEqual({
      allowed: false,
      reason: "Blocked unsafe, global, or network command"
    });
    expect(agent.validateCommand("npm publish")).toEqual({
      allowed: false,
      reason: "Blocked unsafe, global, or network command"
    });
    expect(agent.validateCommand("npm install -g typescript")).toEqual({
      allowed: false,
      reason: "Blocked unsafe, global, or network command"
    });
  });

  test("blocks interpreter escape hatches and mutating git commands", () => {
    const agent = new AIAgent();

    expect(agent.validateCommand('node -e "console.log(process.env)"')).toEqual({
      allowed: false,
      reason: "Blocked unsafe, global, or network command"
    });
    expect(agent.validateCommand("python app.py")).toEqual({
      allowed: false,
      reason: "Only project-scoped read, test, and build commands are allowed"
    });
    expect(agent.validateCommand("git push origin main")).toEqual({
      allowed: false,
      reason: "Blocked unsafe, global, or network command"
    });
    expect(agent.validateCommand("git status --short")).toEqual({
      allowed: true
    });
  });

  test("runs JSON syntax checks without shelling out to node -e", async () => {
    const agent = new AIAgent();

    await expect(
      agent._runSyntaxCheck("settings.json", null, '{"ok":true}')
    ).resolves.toEqual({ success: true, output: "" });

    await expect(
      agent._runSyntaxCheck("settings.json", null, '{"ok": }')
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("JSON parse error")
    });
  });

  test("edit prompts keep recent user history but drop assistant chatter", () => {
    const agent = new AIAgent();
    const session = agent._getCurrentSession();
    session.history = [
      { role: "user", content: "please update src/app.js" },
      { role: "assistant", content: "Here is a long assistant explanation that should not be echoed back into edit prompts." },
      { role: "user", content: "also keep the existing behavior" }
    ];

    const prompt = agent._buildPrompt(
      "rename the button in src/app.js",
      [],
      "",
      "",
      "",
      false,
      { scope: "restricted", paths: ["src/app.js"] },
      "heavy",
      "",
      "",
      { intentOverride: "edit" }
    );

    expect(prompt).toContain("User: please update src/app.js");
    expect(prompt).not.toContain("assistant explanation");
  });

  test("repetition detector ignores older reused text but flags immediate loops", () => {
    const agent = new AIAgent();
    const repeatedBlock =
      [
        "PATCH: src/app.js",
        "SEARCH: const status = 'draft';",
        "REPLACE: const status = 'published';"
      ].join("\n");
    const separator =
      "Unique context about a different file path and unrelated validation steps that should prevent this from being treated as an immediate loop.\n".repeat(2);

    expect(
      agent._isRepeatingResponse(`${repeatedBlock}\n${separator}${repeatedBlock}`, "fast")
    ).toBe(false);
    expect(
      agent._isRepeatingResponse(`${separator}${repeatedBlock}\n${repeatedBlock}`, "fast")
    ).toBe(true);
  });

  test("ollama execution requests use deterministic larger generation settings for edits", () => {
    const agent = new AIAgent();
    const request = agent._buildRequestOptions(
      {
        provider: "ollama",
        model: "qwen2.5-coder",
        ollamaUrl: "http://localhost:11434",
        maxTokens: {
          fast: 2048,
          heavy: 4096,
          deep: 8192,
          create: 8192
        }
      },
      "System instructions\n\n### USER_MESSAGE ###\nupdate src/app.js",
      "heavy",
      "edit"
    );

    const body = JSON.parse(request.body);

    expect(body.options.temperature).toBe(0.1);
    expect(body.options.num_predict).toBeGreaterThanOrEqual(4096);
    expect(body.options.num_ctx).toBeGreaterThanOrEqual(4096);
    expect(body.options.repeat_penalty).toBe(1.2);
  });

  test("extracts file-like hints from quoted and stem-only references", () => {
    const agent = new AIAgent();

    expect(
      agent._extractPathHints('find "chat-panel" and inspect `COMMIT_EDITMSG` alongside graph-loader')
    ).toEqual(
      expect.arrayContaining(["chat-panel", "commit_editmsg", "graph-loader"])
    );
  });

  test("uses PowerShell command execution on Windows", () => {
    const agent = new AIAgent();

    expect(agent._shouldUsePowerShellForCommand("Get-Content package.json")).toBe(
      process.platform === "win32"
    );
    expect(agent._shouldUsePowerShellForCommand("npm test")).toBe(
      process.platform === "win32"
    );
  });

  test("thinking mode instructions request visible Thinking and Answer sections", () => {
    const agent = new AIAgent();

    const instruction = agent._buildSystemInstruction("scan", "", "fast", true);

    expect(instruction).toContain('heading titled "Thinking"');
    expect(instruction).toContain('heading titled "Answer"');
    expect(instruction).toContain("Do not expose hidden internal chain-of-thought");
  });

  test("thinking mode stays hidden for execution intents", () => {
    const agent = new AIAgent();

    const instruction = agent._buildSystemInstruction("edit", "", "fast", true);

    expect(instruction).not.toContain('heading titled "Thinking"');
    expect(instruction).not.toContain('heading titled "Answer"');
  });

  test("fast mode uses full execution rules for create requests", () => {
    const agent = new AIAgent();

    const instruction = agent._buildSystemInstruction("create", "", "fast", false);

    expect(instruction).toContain("Operational rules:");
    expect(instruction).toContain(
      "Work like a hands-on coding agent, not a debate bot"
    );
    expect(instruction).not.toContain("Operational rules (fast):");
  });

  test("fast mode keeps the silent preamble focused on security halt logic", () => {
    const agent = new AIAgent();

    const instruction = agent._buildSystemInstruction("general", "", "fast", false);

    expect(instruction).toContain("%%AUDIT_HALTED%%");
    expect(instruction).not.toContain("%%BUG_FOUND%%");
    expect(instruction).not.toContain("%%SHOW_FIX_BUTTON%%");
  });

  test("fast mode no longer asks for compact replies by default", () => {
    const agent = new AIAgent();

    const generalInstruction = agent._buildSystemInstruction(
      "general",
      "",
      "fast",
      false
    );
    const greetingInstruction = agent._buildSystemInstruction(
      "greeting",
      "",
      "fast",
      false
    );

    expect(generalInstruction).toContain(
      "Answer directly and completely for the user's request."
    );
    expect(generalInstruction).toContain(
      "do not shorten it so much that useful detail is lost"
    );
    expect(generalInstruction).not.toContain("Be concise and correct.");
    expect(greetingInstruction).toContain("Reply naturally and helpfully.");
    expect(greetingInstruction).not.toContain("Reply naturally and briefly.");
  });

  test("file-only retry prompt forbids placeholders and truncation", () => {
    const agent = new AIAgent();

    const prompt = agent._buildFileOnlyRetryPrompt("FILE: index.html");

    expect(prompt).toContain('Do not omit sections or replace them with placeholders');
    expect(prompt).toContain("Do not truncate the file mid-tag, mid-block, or mid-function.");
    expect(prompt).toContain(
      "Preserve required closing tags, braces, and imports so the file is complete from start to finish."
    );
  });

  test("build prompt appends workflow overlays after the core system instruction", () => {
    const agent = new AIAgent();

    const prompt = agent._buildPrompt(
      "Review the current auth plan",
      [],
      "",
      "",
      "",
      false,
      { scope: "workspace", paths: [] },
      "heavy",
      "",
      "GStack-inspired workflow active: /plan-eng-review."
    );

    expect(prompt).toContain("GStack-inspired workflow active: /plan-eng-review.");
    expect(prompt).toContain("### USER_MESSAGE ###");
    expect(prompt).toContain("Review the current auth plan");
  });

  test("latency profile respects configured token budgets and boosts edit requests", () => {
    const agent = new AIAgent();
    const config = {
      provider: "custom:test",
      maxTokens: {
        fast: 1536,
        heavy: 5120,
        deep: 9216,
        create: 12288
      }
    };

    expect(agent._getLatencyProfile(config, "fast", "general").maxTokens).toBe(1536);
    expect(agent._getLatencyProfile(config, "fast", "edit").maxTokens).toBe(1536);
    expect(agent._getLatencyProfile(config, "fast", "create").maxTokens).toBe(3072);
    expect(agent._getLatencyProfile(config, "heavy", "edit").maxTokens).toBe(5120);
    expect(agent._getLatencyProfile(config, "deep", "create").maxTokens).toBe(12288);
  });

  test("fast create requests get a larger token budget for full-file generation", () => {
    const agent = new AIAgent();
    const config = {
      provider: "nvidia",
      model: "meta/llama-3.1-8b-instruct",
      maxTokens: {
        fast: 2048,
        heavy: 4096,
        deep: 8192,
        create: 12288
      }
    };

    expect(agent._getLatencyProfile(config, "fast", "create").maxTokens).toBe(4096);
  });

  test("ollama deep create requests stay bounded instead of using unlimited generation", () => {
    const agent = new AIAgent();
    const request = agent._buildRequestOptions(
      {
        provider: "ollama",
        model: "qwen2.5-coder",
        ollamaUrl: "http://localhost:11434",
        maxTokens: {
          fast: 2048,
          heavy: 4096,
          deep: 8192,
          create: 12288
        }
      },
      "System instructions\n\n### USER_MESSAGE ###\ncreate a full landing page",
      "deep",
      "create"
    );

    const body = JSON.parse(request.body);

    expect(body.options.num_predict).toBe(12288);
  });

  test("skipHistory avoids persisting internal agent calls", async () => {
    const agent = new AIAgent();
    agent._prepareRuntimeConfig = jest.fn(async (config) => config);
    agent.getConfig = jest.fn(() => ({ enabled: true, provider: "custom:test", timeout: 1000 }));
    agent._loadKnowledgeGraph = jest.fn(async () => "");
    agent._buildFetchedWebContext = jest.fn(async () => "");
    agent._getLatencyProfile = jest.fn(() => ({ relevantFileCount: 1, fileSnippetChars: 200, contextChars: 2000, maxTokens: 256 }));
    agent._getEditorState = jest.fn(() => ({ allOpenTabs: [] }));
    agent._resolveEditableTargets = jest.fn(() => ({ scope: "workspace", paths: [] }));
    agent._buildSystemInstruction = jest.fn(() => "system");
    agent._getActiveFileContext = jest.fn(() => "");
    agent._shouldUseRepoContextInFastMode = jest.fn(() => false);
    agent._buildPromptHistoryContext = jest.fn(() => "");
    agent._buildRequestOptions = jest.fn(() => ({
      url: "https://example.test",
      headers: {},
      body: "{}",
      parseChunk: jest.fn(() => "APPROVE")
    }));
    agent._createRequestSignal = jest.fn(() => undefined);
    agent._readResponseText = jest.fn(async () => "APPROVE");
    agent._parseResponse = jest.fn(() => ({ text: "APPROVE", actions: [] }));
    agent._appendConversationEntry = jest.fn();

    global.fetch = jest.fn(async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          cancel: jest.fn()
        })
      }
    }));

    await agent.chat("internal review", "/workspace", null, null, {
      skipHistory: true,
      runtimeConfig: { enabled: true, provider: "custom:test", timeout: 1000 }
    });

    expect(agent._appendConversationEntry).not.toHaveBeenCalled();
  });

  test("chat rejects image attachments for text-only models before requesting the provider", async () => {
    const agent = new AIAgent();
    agent.getConfig = jest.fn(() => ({
      enabled: true,
      provider: "custom:mystidia",
      model: "mystidia-coder",
      timeout: 1000
    }));
    agent._prepareRuntimeConfig = jest.fn(async (config) => config);

    const result = await agent.chat("what's in this screenshot?", "/workspace", null, null, {
      runtimeConfig: {
        enabled: true,
        provider: "custom:mystidia",
        model: "mystidia-coder",
        timeout: 1000
      },
      images: [
        {
          name: "ui.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          base64Data: "AAAA"
        }
      ]
    });

    expect(result).toEqual({
      error:
        "The selected model (mystidia-coder) does not support image input. Remove attached images or switch to a vision-capable model."
    });
    expect(agent._prepareRuntimeConfig).toHaveBeenCalled();
  });

  test("treats unknown custom models as image-capable unless they look text-only", () => {
    const agent = new AIAgent();

    expect(
      agent._modelSupportsImageInput(
        { provider: "custom:visionhub", model: "nova-pro" },
        "nova-pro"
      )
    ).toBe(true);
    expect(
      agent._modelSupportsImageInput(
        { provider: "custom:visionhub", model: "qwen2.5-coder:7b" },
        "qwen2.5-coder:7b"
      )
    ).toBe(false);
  });

  test("treats NVIDIA mistral-nemotron as text-only for image gating", () => {
    const agent = new AIAgent();

    expect(
      agent._modelSupportsImageInput(
        { provider: "nvidia", model: "mistralai/mistral-nemotron" },
        "mistralai/mistral-nemotron"
      )
    ).toBe(false);
  });

  test("strips streamed think tags without losing visible NVIDIA output", () => {
    const agent = new AIAgent();
    const state = { insideThink: false };

    expect(agent._stripThinkTaggedTextChunk("<think>plan", state)).toBe("");
    expect(state.insideThink).toBe(true);
    expect(
      agent._stripThinkTaggedTextChunk("ning</think>Hello world", state)
    ).toBe("Hello world");
    expect(state.insideThink).toBe(false);
  });

  test("forceStructuredEdits retries prose-only replies into executable edit actions", async () => {
    const agent = new AIAgent();
    agent._prepareRuntimeConfig = jest.fn(async (config) => config);
    agent.getConfig = jest.fn(() => ({ enabled: true, provider: "custom:test", timeout: 1000 }));
    agent._loadKnowledgeGraph = jest.fn(async () => "");
    agent._buildFetchedWebContext = jest.fn(async () => "");
    agent._getLatencyProfile = jest.fn(() => ({ relevantFileCount: 1, fileSnippetChars: 200, contextChars: 2000, maxTokens: 256 }));
    agent._getEditorState = jest.fn(() => ({ allOpenTabs: [] }));
    agent._resolveEditableTargets = jest.fn(() => ({ scope: "workspace", paths: [] }));
    agent._buildSystemInstruction = jest.fn(() => "system");
    agent._getActiveFileContext = jest.fn(() => "");
    agent._shouldUseRepoContextInFastMode = jest.fn(() => false);
    agent._buildPromptHistoryContext = jest.fn(() => "");
    agent._createRequestSignal = jest.fn(() => undefined);
    agent._buildRequestOptions = jest
      .fn()
      .mockImplementation((config, prompt, mode, intent) => ({
        url: "https://example.test",
        headers: {},
        body: JSON.stringify({ prompt, mode, intent }),
        parseChunk: jest.fn(() => null)
      }));
    agent._readResponseText = jest
      .fn()
      .mockResolvedValueOnce("I'll take care of that.")
      .mockResolvedValueOnce(
        [
          "PATCH: src/app.js",
          "SEARCH:",
          "```js",
          "const status = 'draft';",
          "```",
          "REPLACE:",
          "```js",
          "const status = 'ready';",
          "```"
        ].join("\n")
      );

    global.fetch = jest.fn(async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          cancel: jest.fn()
        })
      }
    }));

    const result = await agent.chat("handle the auth wiring", "/workspace", null, null, {
      intentOverride: "edit",
      forceStructuredEdits: true,
      runtimeConfig: { enabled: true, provider: "custom:test", timeout: 1000 }
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(agent._buildRequestOptions).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.stringContaining("Return ONLY executable actions now."),
      "fast",
      "edit"
    );
    expect(result.actions).toEqual([
      {
        type: "patch",
        path: "src/app.js",
        search: "const status = 'draft';\n",
        replace: "const status = 'ready';\n"
      }
    ]);
  });

  test("incomplete structured edits are rejected instead of applying partial file content", async () => {
    const agent = new AIAgent();
    agent._prepareRuntimeConfig = jest.fn(async (config) => config);
    agent.getConfig = jest.fn(() => ({ enabled: true, provider: "custom:test", timeout: 1000 }));
    agent._loadKnowledgeGraph = jest.fn(async () => "");
    agent._buildFetchedWebContext = jest.fn(async () => "");
    agent._getLatencyProfile = jest.fn(() => ({ relevantFileCount: 1, fileSnippetChars: 200, contextChars: 2000, maxTokens: 256 }));
    agent._getEditorState = jest.fn(() => ({ allOpenTabs: [] }));
    agent._resolveEditableTargets = jest.fn(() => ({ scope: "workspace", paths: [] }));
    agent._buildSystemInstruction = jest.fn(() => "system");
    agent._getActiveFileContext = jest.fn(() => "");
    agent._shouldUseRepoContextInFastMode = jest.fn(() => false);
    agent._buildPromptHistoryContext = jest.fn(() => "");
    agent._createRequestSignal = jest.fn(() => undefined);
    agent._buildRequestOptions = jest
      .fn()
      .mockImplementation((config, prompt, mode, intent) => ({
        url: "https://example.test",
        headers: {},
        body: JSON.stringify({ prompt, mode, intent }),
        parseChunk: jest.fn(() => null)
      }));
    agent._readResponseText = jest
      .fn()
      .mockResolvedValueOnce(
        [
          "FILE: index.html",
          "```html",
          "<!DOCTYPE html>",
          "<html>",
          "<head>"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "FILE: index.html",
          "```html",
          "<!DOCTYPE html>",
          "<html>",
          "<head>"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "FILE: index.html",
          "```html",
          "<!DOCTYPE html>",
          "<html>",
          "<head>"
        ].join("\n")
      );

    global.fetch = jest.fn(async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          cancel: jest.fn()
        })
      }
    }));

    const result = await agent.chat("build my portfolio website", "/workspace", null, null, {
      intentOverride: "create",
      forceStructuredEdits: true,
      runtimeConfig: { enabled: true, provider: "custom:test", timeout: 1000 }
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result.actions).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "Structured edit output appears incomplete; retrying may recover missing edits.",
        expect.stringContaining("did not apply partial file changes")
      ])
    );
    expect(result.text).toContain("did not apply partial file changes");
  });

  test("buffers split streamed lines before parsing tokens", async () => {
    const agent = new AIAgent();
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('data: {"choices":[{"delta":{"content":"Hel'),
      encoder.encode('lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n')
    ];
    let index = 0;

    const response = {
      body: {
        getReader: () => ({
          read: async () => {
            if (index >= chunks.length) {
              return { done: true, value: undefined };
            }
            return { done: false, value: chunks[index++] };
          },
          cancel: jest.fn()
        })
      }
    };

    const text = await agent._readResponseText(
      response,
      (line) =>
        line.startsWith("data: ")
          ? JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || null
          : null
    );

    expect(text).toBe("Hello world");
  });

  test("does not treat a far-earlier repeated block as stream repetition", () => {
    const agent = new AIAgent();
    const tail = ["alpha", "beta", "gamma"].join("\n");
    const text = `${tail}\n${"z".repeat(700)}\n${tail}`;

    expect(agent._isRepeatingResponse(text, "fast")).toBe(false);
  });

  test("detects repetition when the recent tail repeats consecutively", () => {
    const agent = new AIAgent();
    const tail = [
      "loop one with enough repeated detail to look like a stuck response",
      "loop two with enough repeated detail to look like a stuck response",
      "loop three with enough repeated detail to look like a stuck response"
    ].join("\n");
    const text = `${"intro\n".repeat(40)}${tail}\n${tail}`;

    expect(agent._isRepeatingResponse(text, "fast")).toBe(true);
  });
});
