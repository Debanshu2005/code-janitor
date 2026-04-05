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
      if (editor) this.lastActiveEditor = editor;
    }, null, context.subscriptions);
  }

  async show() {
    this.lastActiveEditor = vscode.window.activeTextEditor || this.lastActiveEditor;
    this.agent.setActiveEditor(this.lastActiveEditor);

    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "codeJanitorChat",
      "Code Janitor AI",
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this._getHtmlContent();
    this._setupMessageHandler();
    this.panel.onDidDispose(() => { this.panel = null; });

    // Populate model list from Ollama
    this._fetchAndSendModels();
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
    try {
      const config = this.agent.getConfig();
      if (config.provider === "groq") {
        const models = [
          "llama-3.1-8b-instant", "llama-3.1-70b-versatile",
          "llama3-8b-8192", "llama3-70b-8192",
          "mixtral-8x7b-32768", "gemma2-9b-it"
        ];
        if (this.panel) this.panel.webview.postMessage({ type: "setModelOptions", models, provider: "groq" });
        return;
      }
      if (config.provider === "openrouter") {
        const models = [
          "meta-llama/llama-3.1-8b-instruct:free",
          "meta-llama/llama-3.1-70b-instruct:free",
          "microsoft/phi-3-mini-128k-instruct:free",
          "google/gemma-2-9b-it:free",
          "deepseek/deepseek-coder",
          "qwen/qwen-2.5-coder-32b-instruct"
        ];
        if (this.panel) this.panel.webview.postMessage({ type: "setModelOptions", models, provider: "openrouter" });
        return;
      }
      // Ollama — fetch live
      const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map(m => m.name).filter(Boolean);
        if (models.length > 0 && this.panel) {
          this.panel.webview.postMessage({ type: "setModelOptions", models, provider: "ollama" });
        }
      }
    } catch (_) {}
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

        const response = await this.agent.chat(
          trimmedText,
          workspaceFolder,
          (chunk) => { this.panel.webview.postMessage({ type: "stream", text: chunk }); },
          this.abortController.signal,
          {
            mode: this.chatMode,
            onStatus: (text) => { this.panel.webview.postMessage({ type: "status", text }); }
          }
        );

        if (response.error) {
          this.panel.webview.postMessage({ type: "error", text: response.error });
          return;
        }

        this.panel.webview.postMessage({ type: "done" });

        if (response.warnings && response.warnings.length > 0) {
          for (const warning of response.warnings) {
            this.panel.webview.postMessage({ type: "status", text: warning });
          }
        }

        if (response.actions && response.actions.length > 0) {
          for (const action of response.actions) {
            if (action.type === "file") {
              const result = await this.agent.applyChanges(action.path, action.content);
              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                text: result.success
                  ? `Updated ${result.relativePath || action.path}\n${result.changeSummary || ""}`
                  : result.error
              });
              // Auto syntax-check the written file
              if (result.success && result.syntaxCheckCmd) {
                this.panel.webview.postMessage({ type: "status", text: `Checking syntax: ${result.relativePath}` });
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
              const result = await this.agent.createFolder(action.path);
              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                text: result.success ? `Created folder ${action.path}` : result.error
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
        this._fetchAndSendModels();
      }
    });
  }
}

module.exports = ChatPanel;
