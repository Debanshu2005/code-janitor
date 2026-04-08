const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const AIAgent = require("./agent");

class ChatPanel {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.agent = new AIAgent();
    this.abortController = null;
    this.lastActiveEditor = vscode.window.activeTextEditor || null;
    this.chatMode = "fast";
    this._confirmResolve = null;

    this.agent.setActiveEditor(this.lastActiveEditor);

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === "file") this.lastActiveEditor = editor;
    }, null, context.subscriptions);
  }

  async show() {
    this.lastActiveEditor = vscode.window.activeTextEditor || this.lastActiveEditor;
    this.agent.setActiveEditor(this.lastActiveEditor);

    if (this.panel) {
      this.panel.reveal();
      return;
    }

    // Show setup guide on first ever open
    const hasSeenSetup = this.context.globalState.get("codeJanitor.seenSetup", false);
    if (!hasSeenSetup) {
      this.context.globalState.update("codeJanitor.seenSetup", true);
      vscode.window.showInformationMessage(
        "👋 New to Code Janitor? Check the setup guide to configure AI models and API keys.",
        "Open Setup Guide"
      ).then(selection => {
        if (selection === "Open Setup Guide") {
          vscode.env.openExternal(vscode.Uri.parse("https://code-janitor-web.vercel.app"));
        }
      });
    }

    this.panel = vscode.window.createWebviewPanel(
      "codeJanitorChat",
      "Code Janitor AI",
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this._getHtmlContent();
    // Initial state is sent when the webview fires the "ready" message
    this._setupMessageHandler();
    this.panel.onDidDispose(() => { this.panel = null; });
  }

  async _runSyntaxScan(workspaceFolder, specificFiles) {
    if (!workspaceFolder) {
      this.panel.webview.postMessage({ type: "status", text: "No workspace open." });
      return;
    }
    this.panel.webview.postMessage({ type: "thinking" });
    await this.agent.ensureCodebaseScanned(workspaceFolder);
    const files = specificFiles || Array.from(this.agent.codebaseContext.keys()).filter(f =>
      /\.(js|jsx|ts|tsx|py|java)$/i.test(f)
    );
    let reply = `Scanning ${files.length} file(s) for syntax errors...\n`;
    this.panel.webview.postMessage({ type: "stream", text: reply });
    let found = false;
    for (const f of files) {
      const result = await this.agent._runSyntaxCheck(f.replace(/\\/g, "/"), workspaceFolder, null);
      if (result && !result.skipped && (!result.success || (result.output || "").trim())) {
        const msg = `\n\u274c ${f}:\n${result.error || result.output}`;
        this.panel.webview.postMessage({ type: "stream", text: msg });
        reply += msg;
        found = true;
      }
    }
    const summary = found ? "\n\nScan complete. Issues found above." : "\n\n\u2705 No syntax errors found.";
    this.panel.webview.postMessage({ type: "stream", text: summary });
    this.panel.webview.postMessage({ type: "done" });
  }

  _getHtmlContent() {
    return fs.readFileSync(path.join(__dirname, "chat-panel.html"), "utf8");
  }

  async _fetchAndSendModels() {
    // Only needed for Ollama — other providers populate models client-side
    try {
      const config = this.agent.getConfig();
      if (config.provider !== "ollama") return;
      const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map(m => m.name).filter(Boolean);
        if (models.length > 0 && this.panel) {
          this.panel.webview.postMessage({ type: "setModelOptions", models, provider: "ollama" });
          return;
        }
      }
    } catch (_) {}
    // Ollama unreachable or no models — show defaults
    if (this.panel) {
      this.panel.webview.postMessage({
        type: "setModelOptions",
        models: ["qwen2.5-coder:1.5b", "codellama:latest", "llama3:latest"],
        provider: "ollama"
      });
    }
  }

  _setupMessageHandler() {
    this.panel.webview.onDidReceiveMessage(async (message) => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (message.type === "chat") {
        const trimmedText = (message.text || "").trim();

        if (/^\/fast$/i.test(trimmedText)) {
          this.chatMode = "fast";
          this.panel.webview.postMessage({ type: "status", text: "Mode switched to Fast." });
          this.panel.webview.postMessage({ type: "done" });
          return;
        }
        if (/^\/heavy$/i.test(trimmedText)) {
          this.chatMode = "heavy";
          this.panel.webview.postMessage({ type: "status", text: "Mode switched to Heavy." });
          this.panel.webview.postMessage({ type: "done" });
          return;
        }
        if (/^\/scan$/i.test(trimmedText)) {
          this.panel.webview.postMessage({ type: "status", text: "Scanning workspace..." });
          this.panel.webview.postMessage({ type: "thinking" });
          const overview = await this.agent.getCodebaseOverview(workspaceFolder);
          this.panel.webview.postMessage({ type: "stream", text: overview });
          this.panel.webview.postMessage({ type: "done" });
          return;
        }

        this.agent.setActiveEditor(this.lastActiveEditor || vscode.window.activeTextEditor);
        this.panel.webview.postMessage({ type: "thinking" });
        this.abortController = new AbortController();

        let response;
        try {
          response = await this.agent.chat(
            trimmedText,
            workspaceFolder,
            (chunk) => { this.panel.webview.postMessage({ type: "stream", text: chunk }); },
            this.abortController.signal,
            {
              mode: this.chatMode,
              onStatus: (text) => { this.panel.webview.postMessage({ type: "status", text }); }
            }
          );
        } finally {
          this.abortController = null;
        }

        if (response.error) {
          this.panel.webview.postMessage({ type: "error", text: response.error });
          this.panel.webview.postMessage({ type: "done" });
          return;
        }

        this.panel.webview.postMessage({ type: "done" });

        if (response.warnings && response.warnings.length > 0) {
          for (const warning of response.warnings) {
            this.panel.webview.postMessage({ type: "status", text: warning });
          }
        }

        // Debug: show what was parsed
        if (response.actions && response.actions.length > 0) {
          this.panel.webview.postMessage({ type: "status", text: `Parsed ${response.actions.length} action(s): ${response.actions.map(a => `${a.type}:${a.path || a.command}`).join(", ")}` });
        }

        if (response.actions && response.actions.length > 0) {
          // Collect outside-workspace file actions and ask permission once
          const outsideFiles = [];
          const insideActions = [];
          for (const action of response.actions) {
            if (action.type === "file") {
              const probe = await this.agent.applyChanges(action.path, action.content);
              if (probe.error === "outside_workspace") {
                outsideFiles.push({ action, path: probe.path });
              } else {
                insideActions.push({ action, result: probe });
              }
            } else if (action.type === "mkdir") {
              // Skip MKDIR if a FILE: action already covers the same path
              // applyChanges creates parent dirs automatically
              const probe = await this.agent.createFolder(action.path);
              if (probe.error === "outside_workspace") {
                outsideFiles.push({ action, path: probe.path });
              } else {
                insideActions.push({ action, result: probe });
              }
            } else if (action.type === "cmd") {
              insideActions.push({ action, result: null });
            }
          }

          // Ask permission for outside-workspace files (once per session)
          let allowOutside = this._outsideWorkspaceAllowed || false;
          if (outsideFiles.length > 0 && !allowOutside) {
            const paths = outsideFiles.map(f => f.path).join("\n");
            this.panel.webview.postMessage({ type: "confirmOutsideEdit", path: paths });
            allowOutside = await new Promise((resolve) => { this._confirmResolve = resolve; });
            if (allowOutside) this._outsideWorkspaceAllowed = true;
          }

          // Process all actions
          const allActions = [
            ...insideActions,
            ...outsideFiles.map(f => ({ action: f.action, result: null, outside: true }))
          ];

          for (const { action, result: preResult, outside } of allActions) {
            if (action.type === "file") {
              if (outside && !allowOutside) {
                this.panel.webview.postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
                continue;
              }
              const result = outside
                ? await this.agent.applyChanges(action.path, action.content, true)
                : preResult;
              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                text: result.success
                  ? `\u2705 Created ${result.relativePath || action.path}`
                  : result.error
              });
              if (result.success && result.syntaxCheckCmd) {
                const checkResult = await this.agent.executeCommand(result.syntaxCheckCmd, workspaceFolder);
                const ok = checkResult.success && !(checkResult.output || "").trim();
                this.panel.webview.postMessage({
                  type: "status",
                  text: ok
                    ? `\u2705 No syntax errors in ${result.relativePath}`
                    : `\u274c Syntax issues in ${result.relativePath}:\n${checkResult.error || checkResult.output || ""}`
                });
              }
            } else if (action.type === "mkdir") {
              if (outside && !allowOutside) {
                this.panel.webview.postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
                continue;
              }
              const result = outside
                ? await this.agent.createFolder(action.path, true)
                : preResult;
              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                text: result.success ? `\u2705 Created folder ${result.path || action.path}` : result.error
              });
            } else if (action.type === "cmd") {
              const validation = this.agent.validateCommand(action.command);
              if (!validation.allowed) {
                this.panel.webview.postMessage({ type: "status", text: `Blocked: ${validation.reason}` });
                continue;
              }
              this.panel.webview.postMessage({ type: "confirm", command: action.command });
              const allowed = await new Promise((resolve) => { this._confirmResolve = resolve; });
              if (!allowed) {
                this.panel.webview.postMessage({ type: "status", text: `Denied: ${action.command}` });
                continue;
              }
              this.panel.webview.postMessage({ type: "status", text: `Running: ${action.command}` });
              const result = await this.agent.executeCommand(action.command, workspaceFolder);
              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                text: result.success ? (result.output || "Done.") : result.error
              });
            }
          }
        }

      } else if (message.type === "confirmResponse") {
        if (this._confirmResolve) {
          this._confirmResolve(message.allowed);
          this._confirmResolve = null;
        }
      } else if (message.type === "stop") {
        if (this.abortController) {
          this.abortController.abort();
          this.abortController = null;
          this.panel.webview.postMessage({ type: "done" });
        }
      } else if (message.type === "apply") {
        const result = await this.agent.applyChanges(message.filePath, message.content);
        this.panel.webview.postMessage({
          type: result.success ? "applied" : "error",
          text: result.success
            ? `Updated ${result.relativePath || message.filePath}\n${result.changeSummary || ""}`
            : result.error
        });
      } else if (message.type === "clear") {
        this.agent.clearHistory();
        this._outsideWorkspaceAllowed = false;
        this.panel.webview.postMessage({ type: "cleared" });
      } else if (message.type === "scanOverview") {
        this.panel.webview.postMessage({ type: "status", text: "Scanning workspace..." });
        this.panel.webview.postMessage({ type: "thinking" });
        const overview = await this.agent.getCodebaseOverview(workspaceFolder);
        this.panel.webview.postMessage({ type: "stream", text: overview });
        this.panel.webview.postMessage({ type: "done" });
      } else if (message.type === "syntaxScan") {
        // Triggered by action chip — run directly without model
        const files = message.activeOnly
          ? (this.lastActiveEditor ? [path.relative(workspaceFolder, this.lastActiveEditor.document.fileName).replace(/\\/g, "/")] : [])
          : null;
        await this._runSyntaxScan(workspaceFolder, files);
      } else if (message.type === "refreshOllamaModels" || message.type === "ready") {
        // Webview signals it's fully loaded or user switched to Ollama — send current state
        if (message.type === "ready") {
          const savedConfig = this.agent.getConfig();
          const hasGroqKey = !!savedConfig.groqApiKey;
          const hasOpenrouterKey = !!savedConfig.openrouterApiKey;
          const hasAnthropicKey = !!savedConfig.anthropicApiKey;
          const modelsByProvider = {
            groq: ["llama-3.1-8b-instant","llama-3.1-70b-versatile","llama3-8b-8192","llama3-70b-8192","mixtral-8x7b-32768","gemma2-9b-it"],
            openrouter: ["qwen/qwen-2.5-coder-32b-instruct","qwen/qwen3-coder:free","qwen/qwen3-coder","qwen/qwen3-32b","qwen/qwen3-14b","qwen/qwen3-8b","qwen/qwq-32b","qwen/qwen2.5-coder-7b-instruct","qwen/qwen-2.5-72b-instruct","deepseek/deepseek-r1-distill-qwen-32b","meta-llama/llama-3.3-70b-instruct","meta-llama/llama-3.1-8b-instruct:free","google/gemini-2.0-flash-exp:free","mistralai/mistral-7b-instruct:free"],
            anthropic: ["claude-opus-4-5","claude-sonnet-4-5","claude-3-5-sonnet-20241022","claude-3-5-haiku-20241022","claude-3-opus-20240229"]
          };
          const hasKey = (savedConfig.provider === "groq" && hasGroqKey) ||
                         (savedConfig.provider === "openrouter" && hasOpenrouterKey) ||
                         (savedConfig.provider === "anthropic" && hasAnthropicKey);
          const models = hasKey ? (modelsByProvider[savedConfig.provider] || null) : null;
          this.panel.webview.postMessage({
            type: "setCurrentProvider",
            provider: savedConfig.provider,
            model: savedConfig.model,
            hasGroqKey,
            hasOpenrouterKey,
            hasAnthropicKey,
            models
          });
        }
        this._fetchAndSendModels();
      } else if (message.type === "mode") {
        this.chatMode = message.value === "heavy" ? "heavy" : "fast";
      } else if (message.type === "setModel") {
        const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
        await cfg.update("model", message.model, vscode.ConfigurationTarget.Global);
      } else if (message.type === "setProvider") {
        const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
        await cfg.update("provider", message.provider, vscode.ConfigurationTarget.Global);
        if (message.apiKey && message.provider === "groq") {
          await cfg.update("groqApiKey", message.apiKey, vscode.ConfigurationTarget.Global);
        }
        if (message.apiKey && message.provider === "openrouter") {
          await cfg.update("openrouterApiKey", message.apiKey, vscode.ConfigurationTarget.Global);
        }
        if (message.apiKey && message.provider === "anthropic") {
          await cfg.update("anthropicApiKey", message.apiKey, vscode.ConfigurationTarget.Global);
        }
        // Wait for config to persist before fetching models
        await new Promise(r => setTimeout(r, 300));
        await this._fetchAndSendModels();
      }
    });
  }
}

module.exports = ChatPanel;
