const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const AIAgent = require("./agent");

const MODELS_BY_PROVIDER = {
  groq: ["llama-3.1-8b-instant","llama-3.1-70b-versatile","llama3-8b-8192","llama3-70b-8192","mixtral-8x7b-32768","gemma2-9b-it"],
  openrouter: ["qwen/qwen-2.5-coder-32b-instruct","qwen/qwen3-coder:free","qwen/qwen3-coder","qwen/qwen3-32b","qwen/qwen3-14b","qwen/qwen3-8b","qwen/qwq-32b","qwen/qwen2.5-coder-7b-instruct","qwen/qwen-2.5-72b-instruct","deepseek/deepseek-r1-distill-qwen-32b","meta-llama/llama-3.3-70b-instruct","meta-llama/llama-3.1-8b-instruct:free","google/gemini-2.0-flash-exp:free","mistralai/mistral-7b-instruct:free"],
  anthropic: ["claude-opus-4-5","claude-sonnet-4-5","claude-3-5-sonnet-20241022","claude-3-5-haiku-20241022","claude-3-opus-20240229"],
  nvidia: ["nvidia/minimax-m2.7","nvidia/llama-3.1-nemotron-70b-instruct","nvidia/mistral-nemo-minitron-8b-8k-instruct","nvidia/llama-3.1-nemotron-51b-instruct"]
};

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
    let errorCount = 0;
    for (const f of files) {
      const result = await this.agent._runSyntaxCheck(f.replace(/\\/g, "/"), workspaceFolder, null);
      if (!result) {
        // File type not supported for syntax checking
        continue;
      }
      if (result.skipped) {
        // C/C++ files that need manual checking
        const msg = `\n\u26a0\ufe0f ${f}: ${result.output}`;
        this.panel.webview.postMessage({ type: "stream", text: msg });
        reply += msg;
        continue;
      }
      if (!result.success) {
        // Syntax error found
        const errorMsg = result.error || result.output || "Unknown syntax error";
        const msg = `\n\u274c ${f}:\n${errorMsg}`;
        this.panel.webview.postMessage({ type: "stream", text: msg });
        reply += msg;
        errorCount++;
      }
    }
    const summary = errorCount > 0 
      ? `\n\n\u274c Found ${errorCount} file(s) with syntax errors.` 
      : "\n\n\u2705 No syntax errors found.";
    this.panel.webview.postMessage({ type: "stream", text: summary });
    this.panel.webview.postMessage({ type: "done" });
  }

  _getHtmlContent() {
    return fs.readFileSync(path.join(__dirname, "chat-panel.html"), "utf8");
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
    if (!configKey) return "";

    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const configValue = this._sanitizeApiKey(cfg.get(configKey, ""));
    if (configValue) return configValue;

    const secretValue = await this.context.secrets.get(this._getApiSecretKey(provider));
    return this._sanitizeApiKey(secretValue || "");
  }

  async _getEffectiveAiConfig() {
    const config = this.agent.getConfig();
    const [groqApiKey, openrouterApiKey, anthropicApiKey, nvidiaApiKey] = await Promise.all([
      this._getStoredApiKey("groq"),
      this._getStoredApiKey("openrouter"),
      this._getStoredApiKey("anthropic"),
      this._getStoredApiKey("nvidia")
    ]);

    return {
      ...config,
      groqApiKey,
      openrouterApiKey,
      anthropicApiKey,
      nvidiaApiKey
    };
  }

  async _persistApiKey(provider, apiKey) {
    const configKey = this._getApiKeyConfigKey(provider);
    const sanitized = this._sanitizeApiKey(apiKey);
    if (!configKey || !sanitized) return;
    
    console.log(`[ChatPanel] Persisting API key for ${provider}`);
    
    // Store in secrets first
    await this.context.secrets.store(this._getApiSecretKey(provider), sanitized);
    
    // Then update config
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    await cfg.update(configKey, sanitized, vscode.ConfigurationTarget.Global);
    
    // Verify it was saved
    const verify = cfg.get(configKey, "");
    console.log(`[ChatPanel] Verified ${provider} key saved:`, !!verify);
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
      const effectiveValue = configValue || secretValue || "";

      console.log(`[ChatPanel] Restoring ${provider}: config=${!!configValue}, secret=${!!secretValue}`);

      if (!configValue && secretValue) {
        const target = this._getConfigTargetForKey(configKey);
        await cfg.update(configKey, secretValue, target);
      }

      presence[provider] = !!effectiveValue;
    }

    return presence;
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
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    const applied = await editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, content);
    });

    if (!applied) {
      return { success: false, error: "Failed to update the open file." };
    }

    return {
      success: true,
      path: document.fileName,
      relativePath: path.basename(document.fileName)
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
      if (action.type !== "file" || !result?.success) continue;
      fileSummaries.push(`${result.created ? "add" : "edit"} ${action.path}`);
    }
    for (const { action } of outsideFiles) {
      if (action.type === "file") fileSummaries.push(`edit ${action.path}`);
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

  _readWorkspaceScripts(workspaceFolder) {
    if (!workspaceFolder) return {};
    const packageJsonPath = path.join(workspaceFolder, "package.json");
    if (!fs.existsSync(packageJsonPath)) return {};
    try {
      const raw = fs.readFileSync(packageJsonPath, "utf8");
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
      { script: "lint", command: "npm run lint" },
      { script: "typecheck", command: "npm run typecheck" },
      { script: "build", command: "npm run build" },
      { script: "test", command: "npm test" }
    ];

    return ordered
      .filter((item) => !!scripts[item.script])
      .map((item) => item.command)
      .slice(0, 2);
  }

  _summarizeCommandOutput(output) {
    const text = (output || "").trim();
    if (!text) return "";
    const lines = text.split(/\r?\n/).slice(0, 8);
    return lines.join("\n");
  }

  _isEditLikeIntent(intent, message) {
    if (intent === "edit" || intent === "create") return true;
    if ((intent === "debug" || intent === "refactor") && this.agent._isEditRequest(message || "")) {
      return true;
    }
    return false;
  }

  _hasExplicitCommandRequest(message) {
    return /\b(run|execute|exec|terminal|shell|command|cmd|powershell|bash)\b/i.test(
      message || ""
    );
  }

  _isSyntaxQuestion(message) {
    const text = message || "";
    return (
      /\b(syntax error|syntax errors|syntax issue|syntax issues|parse error|compile error|compile errors)\b/i.test(text) &&
      /\b(is there|are there|check|do we have|does this have|does the file have|any)\b/i.test(text)
    ) || /\b(check|scan|look for|find)\b.*\bsyntax errors?\b/i.test(text);
  }

  _isSyntaxFixRequest(message) {
    const text = message || "";
    return (
      /\b(fix|repair|resolve|correct|patch)\b/i.test(text) &&
      /\b(syntax error|syntax errors|syntax issue|syntax issues|parse error|compile error|compile errors)\b/i.test(text)
    ) || /\bfix\b.*\b(current|active|open|this)\s+(file|tab|editor)\b/i.test(text);
  }

  _shouldPrepareWorkspaceContext(intent, message) {
    if (this.chatMode === "heavy") return true;

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
        onStatus: (text) => {
          this.panel.webview.postMessage({
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
      writeOptions
    );
  }

  async _runPostEditVerification(workspaceFolder, changedFiles) {
    if (!workspaceFolder || !Array.isArray(changedFiles) || changedFiles.length === 0) {
      return;
    }

    const commands = this._getPostEditVerificationCommands(workspaceFolder);
    if (commands.length === 0) {
      this.panel.webview.postMessage({
        type: "status",
        text: "Post-edit checks: no lint/typecheck/build/test scripts found."
      });
      return;
    }

    this.panel.webview.postMessage({
      type: "status",
      text: `Post-edit checks: ${commands.join(", ")}`
    });

    for (const command of commands) {
      const validation = this.agent.validateCommand(command);
      if (!validation.allowed) {
        this.panel.webview.postMessage({
          type: "status",
          text: `Skipped check (${command}): ${validation.reason}`
        });
        continue;
      }

      this.panel.webview.postMessage({
        type: "status",
        text: `Running verification: ${command}`
      });
      const result = await this.agent.executeCommand(command, workspaceFolder);
      if (result.success) {
        this.panel.webview.postMessage({
          type: "status",
          text: `✅ Verification passed: ${command}`
        });
      } else {
        this.panel.webview.postMessage({
          type: "status",
          text: `❌ Verification failed: ${command}\n${this._summarizeCommandOutput(result.error || result.output)}`
        });
        break;
      }
    }
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

  _getDefaultModelForProvider(provider) {
    if (provider === "ollama") return "qwen2.5-coder:1.5b";
    if (provider === "nvidia") return "nvidia/minimax-m2.7";
    const providerModels = MODELS_BY_PROVIDER[provider];
    return Array.isArray(providerModels) && providerModels.length > 0
      ? providerModels[0]
      : "qwen2.5-coder:1.5b";
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

  _setupMessageHandler() {
    this.panel.webview.onDidReceiveMessage(async (message) => {
      console.log("[ChatPanel] Received message:", message.type);
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (message.type === "chat") {
        try {
          console.log("[ChatPanel] Processing chat message:", message.text?.substring(0, 50));
          const trimmedText = (message.text || "").trim();
        const intent = this.agent._detectIntent(trimmedText);
        const isEditLikeIntent = this._isEditLikeIntent(intent, trimmedText);
        const hasExplicitCommandRequest = this._hasExplicitCommandRequest(trimmedText);
        const wantsActiveFileEdit = /\b(current|open|active)\s+(file|tab|editor)\b/i.test(trimmedText);
        const hasExplicitDestructiveWriteIntent =
          /\b(delete|remove|clear|empty|truncate|wipe|blank\s*out)\b/i.test(trimmedText);
        const writeOptions = {
          allowEmpty: hasExplicitDestructiveWriteIntent,
          allowDocTruncate: hasExplicitDestructiveWriteIntent
        };

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
        if (/^\/ping$/i.test(trimmedText)) {
          this.panel.webview.postMessage({ type: "status", text: "Testing AI connection..." });
          this.panel.webview.postMessage({ type: "thinking" });
          const config = await this._getEffectiveAiConfig();
          try {
            if (config.provider === "ollama") {
              const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
              if (res.ok) {
                const data = await res.json();
                const models = (data.models || []).map(m => m.name);
                this.panel.webview.postMessage({ 
                  type: "stream", 
                  text: `✅ Ollama is running at ${config.ollamaUrl}\n\nAvailable models: ${models.join(", ") || "none"}\n\nCurrent model: ${config.model}` 
                });
              } else {
                this.panel.webview.postMessage({ type: "error", text: `❌ Ollama returned status ${res.status}` });
              }
            } else {
              this.panel.webview.postMessage({ type: "stream", text: `✅ Provider: ${config.provider}\nModel: ${config.model}\nTimeout: ${config.timeout}ms` });
            }
          } catch (err) {
            this.panel.webview.postMessage({ type: "error", text: `❌ Connection failed: ${err.message}\n\nMake sure Ollama is running: ollama serve` });
          }
          this.panel.webview.postMessage({ type: "done" });
          return;
        }

        if (this._isSyntaxFixRequest(trimmedText)) {
          const activeEditor = this.lastActiveEditor || vscode.window.activeTextEditor;
          if (!activeEditor || activeEditor.document.uri.scheme !== "file") {
            this.panel.webview.postMessage({
              type: "error",
              text: "Open the file you want to repair, then ask me to fix its syntax errors."
            });
            this.panel.webview.postMessage({ type: "done" });
            return;
          }

          const fileName = activeEditor.document.fileName;
          const fileContent = activeEditor.document.getText();
          const relativePath = workspaceFolder ? path.relative(workspaceFolder, fileName).replace(/\\/g, "/") : path.basename(fileName);

          this.panel.webview.postMessage({
            type: "status",
            text: `Analyzing ${relativePath} for syntax errors...`
          });
          this.panel.webview.postMessage({ type: "thinking" });

          // Run syntax check first
          const syntaxCheck = await this.agent._runSyntaxCheck(fileName.replace(/\\/g, "/"), workspaceFolder, fileContent);
          
          if (!syntaxCheck) {
            this.panel.webview.postMessage({
              type: "error",
              text: "Syntax checking is not supported for this file type."
            });
            this.panel.webview.postMessage({ type: "done" });
            return;
          }

          if (syntaxCheck.skipped) {
            this.panel.webview.postMessage({
              type: "status",
              text: syntaxCheck.output
            });
            this.panel.webview.postMessage({ type: "done" });
            return;
          }

          if (syntaxCheck.success) {
            this.panel.webview.postMessage({
              type: "stream",
              text: `✅ No syntax errors found in ${relativePath}.`
            });
            this.panel.webview.postMessage({ type: "done" });
            return;
          }

          // Syntax errors found - use AI to fix
          const errorOutput = syntaxCheck.error || syntaxCheck.output || "Unknown syntax error";
          this.panel.webview.postMessage({
            type: "stream",
            text: `❌ Syntax errors detected:\n${errorOutput}\n\nGenerating fix...`
          });

          const ext = path.extname(fileName).toLowerCase();
          const langMap = { ".js": "javascript", ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript",
                           ".py": "python", ".java": "java", ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp" };
          const language = langMap[ext] || "code";

          const fixPrompt = `Fix the syntax errors in this ${language} file. Return exactly one FILE action with the complete corrected file.\n\nFile: ${relativePath}\n\nSyntax errors:\n${errorOutput}\n\nCurrent file content:\n\`\`\`${language}\n${fileContent}\n\`\`\``;

          const runtimeConfig = await this._getEffectiveAiConfig();
          const response = await this.agent.chat(
            fixPrompt,
            workspaceFolder,
            (chunk) => { this.panel.webview.postMessage({ type: "stream", text: chunk }); },
            null,
            { mode: "heavy", runtimeConfig }
          );

          if (response.error) {
            this.panel.webview.postMessage({ type: "error", text: response.error });
            this.panel.webview.postMessage({ type: "done" });
            return;
          }

          const fileAction = (response.actions || []).find(a => a.type === "file" && a.content);
          if (!fileAction) {
            this.panel.webview.postMessage({
              type: "error",
              text: "AI did not generate a file fix. Try rephrasing your request or use a different AI model."
            });
            this.panel.webview.postMessage({ type: "done" });
            return;
          }

          // Apply the fix
          const applied = await activeEditor.edit((editBuilder) => {
            const fullRange = new vscode.Range(
              activeEditor.document.positionAt(0),
              activeEditor.document.positionAt(activeEditor.document.getText().length)
            );
            editBuilder.replace(fullRange, fileAction.content);
          });

          if (!applied) {
            this.panel.webview.postMessage({
              type: "error",
              text: "Failed to apply the fix to the editor."
            });
            this.panel.webview.postMessage({ type: "done" });
            return;
          }

          await activeEditor.document.save();

          // Verify the fix
          const verifyCheck = await this.agent._runSyntaxCheck(fileName.replace(/\\/g, "/"), workspaceFolder, activeEditor.document.getText());
          if (verifyCheck && verifyCheck.success) {
            this.panel.webview.postMessage({
              type: "stream",
              text: `\n\n✅ Syntax errors fixed successfully!`
            });
          } else {
            this.panel.webview.postMessage({
              type: "stream",
              text: `\n\n⚠️ Fix applied, but some syntax issues may remain. Please review the changes.`
            });
          }

          this.panel.webview.postMessage({ type: "done" });
          return;
        }

        if (this._isSyntaxQuestion(trimmedText)) {
          const activeOnly = /\b(active|current|open|this)\s+(file|tab|editor)\b/i.test(trimmedText) ||
            !/\b(workspace|repo|repository|project|codebase|all files|entire project)\b/i.test(trimmedText);
          const activeFiles =
            activeOnly && workspaceFolder && this.lastActiveEditor
              ? [path.relative(workspaceFolder, this.lastActiveEditor.document.fileName).replace(/\\/g, "/")]
              : null;
          await this._runSyntaxScan(
            workspaceFolder,
            activeFiles
          );
          return;
        }

        this.agent.setActiveEditor(this.lastActiveEditor || vscode.window.activeTextEditor);
        if (workspaceFolder && this._shouldPrepareWorkspaceContext(intent, trimmedText)) {
          const forcePrep = this.chatMode === "heavy" || intent === "scan";
          this.panel.webview.postMessage({ type: "status", text: "Studying workspace before responding..." });
          const prep = await this.agent.prepareWorkspaceContext(trimmedText, workspaceFolder, { force: forcePrep });
          this.panel.webview.postMessage({
            type: "status",
            text: `Studied workspace: indexed ${prep.indexedFiles} file(s).`
          });
          if (prep.activeFile) {
            this.panel.webview.postMessage({
              type: "status",
              text: `Active file in focus: ${prep.activeFile}`
            });
          }
          if (prep.relevantFiles.length > 0) {
            this.panel.webview.postMessage({
              type: "status",
              text: `Relevant files: ${prep.relevantFiles.slice(0, 5).join(", ")}${prep.relevantFiles.length > 5 ? ` +${prep.relevantFiles.length - 5} more` : ""}`
            });
          }
          if (["edit", "debug", "refactor"].includes(intent)) {
            const gitStatus = await this.agent.executeCommand("git status --short", workspaceFolder);
            if (gitStatus.success) {
              this.panel.webview.postMessage({
                type: "status",
                text: this._summarizeGitStatus(gitStatus.output)
              });
            }
          }
        }
        this.panel.webview.postMessage({ type: "thinking" });
        this.abortController = new AbortController();

        // Add timeout warning for slow models
        const config = await this._getEffectiveAiConfig();
        const timeoutMs = config.timeout || 300000;
        const warningTimer = setTimeout(() => {
          if (this.abortController && !this.abortController.signal.aborted) {
            this.panel.webview.postMessage({ 
              type: "status", 
              text: `⏳ Model is taking longer than expected. This may be normal for ${config.model}. You can stop generation anytime.` 
            });
          }
        }, 30000); // Warn after 30 seconds

        let response;
        try {
          console.log("[ChatPanel] Starting agent.chat with config:", {
            provider: config.provider,
            model: config.model,
            timeout: timeoutMs,
            mode: this.chatMode
          });
          response = await this.agent.chat(
            trimmedText,
            workspaceFolder,
            (chunk) => { this.panel.webview.postMessage({ type: "stream", text: chunk }); },
            this.abortController.signal,
            {
              mode: this.chatMode,
              runtimeConfig: config,
              onStatus: (text) => { this.panel.webview.postMessage({ type: "status", text }); }
            }
          );
        } catch (chatError) {
          console.error("[ChatPanel] Error in agent.chat:", chatError);
          const errorMsg = chatError.name === "AbortError" 
            ? "Generation stopped or timed out. Try a faster model or increase timeout in settings."
            : `AI error: ${chatError.message}`;
          this.panel.webview.postMessage({ type: "error", text: errorMsg });
          this.panel.webview.postMessage({ type: "done" });
          return;
        } finally {
          clearTimeout(warningTimer);
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
          const actionSummary = response.actions.map(a => {
            if (a.type === 'graphify') return 'graphify:open';
            return `${a.type}:${a.path || a.command || ''}`;
          }).join(", ");
          this.panel.webview.postMessage({ type: "status", text: `Parsed ${response.actions.length} action(s): ${actionSummary}` });
        }

        if (response.actions && response.actions.length > 0) {
          const hasFileAction = response.actions.some(
            (action) =>
              action.type === "file" &&
              typeof action.content === "string" &&
              action.content.trim().length > 0
          );
          if (isEditLikeIntent && !hasFileAction) {
            this.panel.webview.postMessage({
              type: "status",
              text: "Blocked execution: edit requests must include at least one FILE action."
            });
            this.panel.webview.postMessage({
              type: "error",
              text: "No executable file edits were generated. Please retry with the target file path and expected change."
            });
            return;
          }

          if (!workspaceFolder) {
            this.panel.webview.postMessage({
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
                this.panel.webview.postMessage({
                  type: "status",
                  text: shouldApplyToOpenFile
                    ? `Editing open file: ${path.basename(activeEditor.document.fileName)}`
                    : `Opening draft: ${action.path}`
                });
                const result = shouldApplyToOpenFile
                  ? await this._applyToEditor(activeEditor, action.content)
                  : await this._openDraftFile(action.path, action.content);
                this.panel.webview.postMessage({
                  type: result.success ? "applied" : "error",
                  filePath: result.success ? result.path : undefined,
                  text: result.success
                    ? shouldApplyToOpenFile
                      ? `\u2705 Updated open file ${result.relativePath || result.path}`
                      : `\u2705 Opened draft ${result.path}`
                    : result.error
                });
              } else if (action.type === "mkdir") {
                this.panel.webview.postMessage({
                  type: "status",
                  text: `Skipped folder creation for ${action.path}. Save the draft files where you want them.`
                });
              } else if (action.type === "cmd") {
                if (isEditLikeIntent && !hasExplicitCommandRequest) {
                  this.panel.webview.postMessage({
                    type: "status",
                    text: `Suppressed command during edit request: ${action.command}`
                  });
                  continue;
                }
                this.panel.webview.postMessage({
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
          const fileActionPaths = new Set(
            response.actions
              .filter((a) => a.type === "file" && a.path)
              .map((a) => a.path.replace(/\\/g, "/").toLowerCase())
          );
          for (const action of response.actions) {
            if (action.type === "file") {
              const probe = await this.agent.applyChanges(
                action.path,
                action.content,
                false,
                writeOptions
              );
              if (probe.error === "outside_workspace") {
                outsideFiles.push({ action, path: probe.path });
              } else {
                insideActions.push({ action, result: probe });
              }
            } else if (action.type === "mkdir") {
              const mkdirPath = (action.path || "").replace(/\\/g, "/").toLowerCase();
              const mkdirParent = path.dirname(mkdirPath);
              if (fileActionPaths.has(mkdirPath) || fileActionPaths.has(mkdirParent)) {
                this.panel.webview.postMessage({
                  type: "status",
                  text: `Skipped redundant MKDIR: ${action.path}`
                });
                continue;
              }

              // applyChanges creates parent dirs automatically.
              const probe = await this.agent.createFolder(action.path);
              if (probe.error === "outside_workspace") {
                outsideFiles.push({ action, path: probe.path });
              } else {
                insideActions.push({ action, result: probe });
              }
            } else if (action.type === "cmd") {
              if (isEditLikeIntent && !hasExplicitCommandRequest) {
                this.panel.webview.postMessage({
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
            this.panel.webview.postMessage({ type: "confirmOutsideEdit", path: paths });
            allowOutside = await new Promise((resolve) => { this._confirmResolve = resolve; });
            if (allowOutside) this._outsideWorkspaceAllowed = true;
          }

          const planSummary = this._summarizePlannedActions(
            response.actions,
            insideActions,
            outsideFiles
          );
          if (planSummary) {
            this.panel.webview.postMessage({ type: "status", text: planSummary });
          }

          // Process all actions
          const allActions = [
            ...insideActions,
            ...outsideFiles.map(f => ({ action: f.action, result: null, outside: true }))
          ];
          const changedFiles = [];
          let stopFurtherActions = false;

          for (const { action, result: preResult, outside } of allActions) {
            if (stopFurtherActions) {
              break;
            }
            if (action.type === "file") {
              if (outside && !allowOutside) {
                this.panel.webview.postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
                continue;
              }
              let result = outside
                ? await this.agent.applyChanges(
                    action.path,
                    action.content,
                    true,
                    writeOptions
                  )
                : preResult;

              if (
                !result.success &&
                isEditLikeIntent &&
                this._isReadmePath(action.path) &&
                this._isDocTruncateGuardError(result.error)
              ) {
                this.panel.webview.postMessage({
                  type: "status",
                  text: "README guard blocked truncation. Retrying with strict full-file README rewrite..."
                });
                result = await this._retryReadmeRewrite(
                  trimmedText,
                  workspaceFolder,
                  writeOptions
                );
                if (!result.success) {
                  this.panel.webview.postMessage({
                    type: "error",
                    text: `README retry failed: ${result.error}`
                  });
                  stopFurtherActions = true;
                } else {
                  this.panel.webview.postMessage({
                    type: "status",
                    text: "README retry succeeded with a full-file rewrite."
                  });
                }
              }

              if (stopFurtherActions) {
                break;
              }
              const operation = result.created ? "Adding file" : "Editing file";
              this.panel.webview.postMessage({ type: "status", text: `${operation}: ${action.path}` });
              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                filePath: result.success ? result.path : undefined,
                text: result.success
                  ? result.created
                    ? `\u2705 Added ${result.relativePath || action.path}\n${result.changeSummary || ""}`
                    : `\u2705 Updated ${result.relativePath || action.path}\n${result.changeSummary || ""}`
                  : result.error
              });
              if (result.success && !outside) {
                changedFiles.push(result.relativePath || action.path);
                await this._revealWorkspaceFile(result.path);
              }
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
            } else if (action.type === "graphify") {
              this.panel.webview.postMessage({ type: "status", text: "Opening Graphify visualization..." });
              try {
                await vscode.commands.executeCommand("codeJanitor.openGraphify");
                this.panel.webview.postMessage({
                  type: "applied",
                  text: "\u2705 Graphify panel opened. You can now visualize the codebase structure."
                });
              } catch (err) {
                this.panel.webview.postMessage({
                  type: "error",
                  text: `Failed to open Graphify: ${err.message}`
                });
              }
            } else if (action.type === "cmd") {
              if (isEditLikeIntent && !hasExplicitCommandRequest) {
                this.panel.webview.postMessage({
                  type: "status",
                  text: `Suppressed command during edit request: ${action.command}`
                });
                continue;
              }
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
              const resultText = result.success
                ? (result.output || "Done.")
                : `${result.error}${result.output ? `\n${result.output}` : ""}`;
              const suffix = result.outputTruncated
                ? "\n[Command output was truncated for safety.]"
                : "";
              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                text: `${resultText}${suffix}`
              });
            }
          }

          if (stopFurtherActions) {
            return;
          }

          await this._runPostEditVerification(workspaceFolder, changedFiles);
        }
        } catch (error) {
          console.error("[ChatPanel] Error in chat handler:", error);
          this.panel.webview.postMessage({ type: "error", text: `Chat error: ${error.message}` });
          this.panel.webview.postMessage({ type: "done" });
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
          filePath: result.success ? result.path : undefined,
          text: result.success
            ? `Updated ${result.relativePath || message.filePath}\n${result.changeSummary || ""}`
            : result.error
        });
        if (result.success) {
          await this._revealWorkspaceFile(result.path);
        }
      } else if (message.type === "clear") {
        this.agent.clearHistory();
        this._outsideWorkspaceAllowed = false;
        this.panel.webview.postMessage({ type: "cleared" });
      } else if (message.type === "openFile") {
        await this._revealWorkspaceFile(message.path);
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
          const restoredKeys = await this._restoreApiKeys();
          const savedConfig = this.agent.getConfig();
          const hasGroqKey = restoredKeys.groq;
          const hasOpenrouterKey = restoredKeys.openrouter;
          const hasAnthropicKey = restoredKeys.anthropic;
          const hasNvidiaKey = restoredKeys.nvidia;
          const hasKey = (savedConfig.provider === "groq" && hasGroqKey) ||
                         (savedConfig.provider === "openrouter" && hasOpenrouterKey) ||
                         (savedConfig.provider === "anthropic" && hasAnthropicKey) ||
                         (savedConfig.provider === "nvidia" && hasNvidiaKey);
          const models = hasKey ? (MODELS_BY_PROVIDER[savedConfig.provider] || null) : null;
          this.panel.webview.postMessage({
            type: "setCurrentProvider",
            provider: savedConfig.provider,
            model: savedConfig.model,
            hasGroqKey,
            hasOpenrouterKey,
            hasAnthropicKey,
            hasNvidiaKey,
            models
          });
        }
        this._fetchAndSendModels();
      } else if (message.type === "mode") {
        this.chatMode = message.value === "heavy" ? "heavy" : "fast";
      } else if (message.type === "setModel") {
        const cfg = await this._updateAiConfig("model", message.model);
        const provider = cfg.get("provider", "ollama");
        this._saveProviderModel(provider, message.model);
      } else if (message.type === "setProvider") {
        await this._updateAiConfig("provider", message.provider);
        const defaultModel = this._getDefaultModelForProvider(message.provider);
        const savedModel = this._getSavedProviderModel(message.provider);
        const nextModel = savedModel || defaultModel;
        await this._updateAiConfig("model", nextModel);
        if (message.apiKey && message.provider === "groq") {
          await this._persistApiKey("groq", message.apiKey);
        }
        if (message.apiKey && message.provider === "openrouter") {
          await this._persistApiKey("openrouter", message.apiKey);
        }
        if (message.apiKey && message.provider === "anthropic") {
          await this._persistApiKey("anthropic", message.apiKey);
        }
        if (message.apiKey && message.provider === "nvidia") {
          await this._persistApiKey("nvidia", message.apiKey);
        }
        // Wait for config to persist before fetching models
        await new Promise(r => setTimeout(r, 300));
        const restoredKeys = await this._restoreApiKeys();
        if (this.panel) {
          const hasKey = (message.provider === "groq" && restoredKeys.groq) ||
                         (message.provider === "openrouter" && restoredKeys.openrouter) ||
                         (message.provider === "anthropic" && restoredKeys.anthropic) ||
                         (message.provider === "nvidia" && restoredKeys.nvidia);
          this.panel.webview.postMessage({
            type: "setCurrentProvider",
            provider: message.provider,
            model: nextModel,
            hasGroqKey: restoredKeys.groq,
            hasOpenrouterKey: restoredKeys.openrouter,
            hasAnthropicKey: restoredKeys.anthropic,
            hasNvidiaKey: restoredKeys.nvidia,
            models: hasKey ? (MODELS_BY_PROVIDER[message.provider] || null) : null
          });
        }
        if (this.panel) {
          this.panel.webview.postMessage({
            type: "status",
            text: `Provider switched to ${message.provider}. Model set to ${nextModel}.`
          });
        }
        await this._fetchAndSendModels();
      }
    });
  }
}

module.exports = ChatPanel;
