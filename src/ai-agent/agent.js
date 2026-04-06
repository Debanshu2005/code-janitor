const vscode = require("vscode");
const fs = require("fs").promises;
const path = require("path");

const MAX_SCAN_FILE_SIZE = 200 * 1024;
const MAX_CONTEXT_CHARS = 8_000;
const MAX_FILE_SNIPPET = 1_200;
const MAX_RELEVANT_FILES = 4;
const MAX_OPEN_TAB_SNIPPETS = 2;
const MAX_HISTORY_ENTRIES = 4;
const REPETITION_WINDOW = 180;
const SCAN_STALE_MS = 30_000;
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
const CODE_EXTENSIONS = /\.(js|jsx|ts|tsx|py|java|c|cpp|h|html|css|json|md)$/i;

class AIAgent {
  constructor() {
    this.codebaseContext = new Map();
    this.conversationHistory = [];
    this.scanVersion = 0;
    this.lastScanAt = 0;
    this.workspaceRoot = null;
    this.currentEditableTargets = null;
    this._lastActiveEditor = vscode.window.activeTextEditor || null;

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) this._lastActiveEditor = editor;
    });
  }

  setActiveEditor(editor) {
    if (editor) {
      this._lastActiveEditor = editor;
    }
  }

  getConfig() {
    const config = vscode.workspace.getConfiguration("codeJanitor.ai");
    const provider = config.get("provider", "ollama");
    return {
      enabled: config.get("enabled", true),
      provider,
      ollamaUrl: config.get("ollamaUrl", "http://localhost:11434"),
      model: config.get("model", provider === "groq" ? "llama-3.1-8b-instant" : provider === "openrouter" ? "meta-llama/llama-3.1-8b-instruct:free" : provider === "anthropic" ? "claude-3-5-haiku-20241022" : "codellama:latest"),
      groqApiKey: config.get("groqApiKey", ""),
      openrouterApiKey: config.get("openrouterApiKey", ""),
      anthropicApiKey: config.get("anthropicApiKey", ""),
      timeout: config.get("timeout", 90_000)
    };
  }

  _buildRequestOptions(config, prompt) {
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
          max_tokens: 1024,
          stream: true,
          messages: [{ role: "user", content: prompt }]
        }),
        parseChunk: (line) => {
          if (!line.startsWith("data: ")) return null;
          try {
            const d = JSON.parse(line.slice(6));
            return d.type === "content_block_delta" ? d.delta?.text || null : null;
          } catch { return null; }
        }
      };
    }
    if (config.provider === "groq") {
      return {
        url: "https://api.groq.com/openai/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.groqApiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          temperature: 0.05,
          max_tokens: 512
        }),
        parseChunk: (line) => {
          if (!line.startsWith("data: ") || line === "data: [DONE]") return null;
          try { return JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || null; } catch { return null; }
        }
      };
    }
    if (config.provider === "openrouter") {
      return {
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.openrouterApiKey}`,
          "HTTP-Referer": "https://github.com/Debanshu2005/code-janitor",
          "X-Title": "Code Janitor"
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          temperature: 0.05,
          max_tokens: 512
        }),
        parseChunk: (line) => {
          if (!line.startsWith("data: ") || line === "data: [DONE]") return null;
          try { return JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || null; } catch { return null; }
        }
      };
    }
    // Default: Ollama
    return {
      url: `${config.ollamaUrl}/api/generate`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        prompt,
        stream: true,
        options: { temperature: 0.05, num_predict: 512, top_k: 10, top_p: 0.7 }
      }),
      parseChunk: (line) => {
        try { const d = JSON.parse(line); return d.response || null; } catch { return null; }
      }
    };
  }

  async scanCodebase(workspaceFolder) {
    this.codebaseContext.clear();
    this.scanVersion += 1;
    this.workspaceRoot = workspaceFolder;

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
        const sampleText = samples.length > 0 ? ` Examples: ${samples.join(", ")}` : "";
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

  async chat(userMessage, workspaceFolder, streamCallback, abortSignal, options = {}) {
    const config = this.getConfig();
    if (!config.enabled) {
      return { error: "AI is disabled in Code Janitor settings." };
    }

    const mode = options.mode === "heavy" ? "heavy" : "fast";
    const reportStatus =
      typeof options.onStatus === "function" ? options.onStatus : null;

    this.conversationHistory.push({ role: "user", content: userMessage });
    const isTabQuestion = this._isTabQuestion(userMessage);

    // Only intercept factual questions the model cannot answer
    const lowerMsg = userMessage.trim().toLowerCase();
    if (/\b(what('?s| is)\s+(today'?s?|the|current)\s+date|what date is it|today'?s date)\b/i.test(lowerMsg)) {
      const reply = `Today is ${new Date().toDateString()}.`;
      if (streamCallback) streamCallback(reply);
      this.conversationHistory.push({ role: "assistant", content: reply });
      return { text: reply, actions: [] };
    }
    if (/\b(what (time|day) is it|current time|what'?s the time)\b/i.test(lowerMsg)) {
      const reply = `Current date and time: ${new Date().toString()}.`;
      if (streamCallback) streamCallback(reply);
      this.conversationHistory.push({ role: "assistant", content: reply });
      return { text: reply, actions: [] };
    }

    // Inject active file path so the model never needs to ask for it
    const activeEditor = vscode.window.activeTextEditor || this._lastActiveEditor;
    let resolvedMessage = userMessage;
    if (
      activeEditor &&
      workspaceFolder &&
      /\b(active|current)\s*(file|tab)?\b/i.test(userMessage) &&
      !/[/\\]/.test(userMessage)
    ) {
      const rel = path.relative(workspaceFolder, activeEditor.document.fileName).replace(/\\/g, "/");
      resolvedMessage = userMessage.replace(/\b(active|current)\s*(file|tab)?\b/gi, `"${rel}"`);
    }

    let prompt;
    if (mode === "fast") {
      reportStatus?.("Preparing fast reply...");
      const activeFileContext = this._getActiveFileContext(workspaceFolder);
      let fastContext = "";
      if (
        workspaceFolder &&
        this._shouldUseRepoContextInFastMode(userMessage)
      ) {
        reportStatus?.("Scanning relevant files for fast mode...");
        await this.ensureCodebaseScanned(workspaceFolder);
        const relevantFiles = this._findRelevantFiles(userMessage, workspaceFolder);
        fastContext = this._buildRelevantFileContext(relevantFiles);
      }
      const history = this.conversationHistory.slice(-4, -1)
        .map(e => `${e.role === "user" ? "User" : "Assistant"}: ${e.content}`)
        .join("\n\n");
      prompt = `You are a concise coding assistant embedded in VS Code. Answer directly and helpfully.
To run a shell command, write it on its own line starting with CMD: followed by the exact command.
To edit a file, use FILE: path then a code block.
Never ask the user for a file path — use the file paths shown in the context below.${activeFileContext ? `\n\n${activeFileContext}` : ""}${fastContext ? `\n\n${fastContext}` : ""}${history ? `\n\n${history}` : ""}\n\nUser: ${resolvedMessage}\n\nAssistant:`;
    } else {
      const editorState = this._getEditorState(workspaceFolder);
      const editableTargets = this._resolveEditableTargets(
        userMessage,
        workspaceFolder,
        editorState
      );
      const isScopedActiveFileEdit =
        this._isActiveFileScanRequest(userMessage) &&
        this._isEditRequest(userMessage) &&
        editableTargets.paths.length > 0;

      reportStatus?.(
        isScopedActiveFileEdit
          ? "Scanning active files..."
          : "Scanning workspace..."
      );
      await this.ensureCodebaseScanned(workspaceFolder);
      const relevantFiles = this._findRelevantFiles(userMessage, workspaceFolder);
      const activeFileContext = this._getActiveFileContext(workspaceFolder);
      const editorStateContext = this._buildEditorStateContext(editorState);
      const openTabSnippetContext = isScopedActiveFileEdit
        ? this._getTargetSnippetContext(editableTargets.paths, workspaceFolder)
        : this._getOpenTabSnippetContext(
            editorState.allOpenTabs,
            workspaceFolder
          );
      this.currentEditableTargets = editableTargets.paths.length ? new Set(editableTargets.paths) : null;
      prompt = this._buildPrompt(
        resolvedMessage, relevantFiles, activeFileContext,
        editorStateContext, openTabSnippetContext,
        isTabQuestion, editableTargets, mode
      );
    }

    try {
      reportStatus?.("Contacting Ollama...");
      const reqOpts = this._buildRequestOptions(config, prompt);
      const response = await fetch(reqOpts.url, {
        method: "POST",
        headers: reqOpts.headers,
        signal: abortSignal || AbortSignal.timeout(config.timeout),
        body: reqOpts.body
      });

      if (!response.ok) {
        throw new Error(`AI request failed with status ${response.status}`);
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
            if (this._isRepeatingResponse(nextResponse)) {
              repetitionDetected = true;
              streamDone = true;
              if (!abortSignal?.aborted) { try { reader.cancel(); } catch (_) {} }
              break;
            }
            fullResponse += token;
            if (streamCallback) streamCallback(token);
          } catch (parseError) {
            // ignore partial chunks
          }
        }
      }

      this.conversationHistory.push({
        role: "assistant",
        content: repetitionDetected
          ? `${fullResponse}\n\n[stopped repetitive output]`
          : fullResponse || this._getEmptyResponseFallback(mode)
      });

      return this._parseResponse(
        repetitionDetected
          ? `${fullResponse}\n\nStopped because the response started repeating.`
          : fullResponse || this._getEmptyResponseFallback(mode)
      );
    } catch (error) {
      if (error.name === "AbortError") {
        return { text: "Generation stopped", actions: [] };
      }

      return { error: `AI error: ${error.message}` };
    } finally {
      this.currentEditableTargets = null;
    }
  }

  _getActiveFileContext(workspaceFolder) {
    const activeEditor = vscode.window.activeTextEditor || this._lastActiveEditor;
    if (!activeEditor || !workspaceFolder) {
      return "";
    }

    // Skip files outside the workspace (output panels, extensions, etc.)
    const filePath = activeEditor.document.fileName;
    const relative = path.relative(workspaceFolder, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return "";
    }

    return this._buildDocumentContext(
      "Active file",
      activeEditor.document,
      workspaceFolder,
      4_000
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
    const activeEditor = vscode.window.activeTextEditor || this._lastActiveEditor;
    const activeTabPath = this._toWorkspaceRelativePath(
      activeEditor?.document?.fileName,
      workspaceFolder
    );

    if (vscode.window.tabGroups?.all) {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input;
          const filePath = input?.uri?.fsPath || input?.modified?.fsPath || null;
          const relativePath = this._toWorkspaceRelativePath(
            filePath,
            workspaceFolder
          );

          if (relativePath) {
            allOpenTabs.add(relativePath);
          }
        }
      }
    }

    if (Array.isArray(vscode.window.visibleTextEditors)) {
      for (const editor of vscode.window.visibleTextEditors) {
        const relativePath = this._toWorkspaceRelativePath(
          editor?.document?.fileName,
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

        snippet =
          `Open tab content: ${tabPath}\n\`\`\`\n${fileData.content.slice(
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

  _getTargetSnippetContext(targetPaths, workspaceFolder, maxSnippets = MAX_RELEVANT_FILES) {
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
          MAX_FILE_SNIPPET
        );
      } else {
        const fileData = this.codebaseContext.get(targetPath);
        if (!fileData) {
          continue;
        }

        snippet =
          `Editable target content: ${targetPath}\n\`\`\`\n${fileData.content.slice(
            0,
            MAX_FILE_SNIPPET
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
    return /\b(scan|inspect|analyze|review|check|read|summari[sz]e)\b/i.test(
      message || ""
    ) && this._mentionsEditorFiles(message);
  }

  _isEditRequest(message) {
    return /\b(edit|update|modify|change|fix|refactor|rewrite|rename|patch|improve|clean up|format)\b/i.test(
      message || ""
    );
  }

  _getFastLocalResponse(userMessage) {
    const message = (userMessage || "").trim().toLowerCase();
    if (!message) {
      return null;
    }

    if (/^(hi|hello|hey|yo|sup|hola|hii+)[!. ]*$/.test(message)) {
      return "Hello! How can I help?";
    }

    if (/^(thanks|thank you|thx)[!. ]*$/.test(message)) {
      return "You're welcome.";
    }

    return null;
  }

  _getEmptyResponseFallback(mode) {
    return mode === "heavy"
      ? "I didn't produce a response. Please try again or switch to Fast mode for lighter questions."
      : "I didn't produce a quick reply. Try asking again, switch to Heavy mode for code-heavy tasks, or use /heavy.";
  }

  _shouldUseRepoContextInFastMode(message) {
    return /\b(scan|codebase|repo|repository|project|workspace|relevant files|entire codebase|why|broken|issue|bug|error|not working|failing|cannot|can't)\b/i.test(
      message || ""
    );
  }

  _isLikelyActiveFileFollowUp(message) {
    const text = (message || "").trim();
    if (!text) {
      return false;
    }

    if (this._mentionsEditorFiles(text) || this._extractPathHints(text).length > 0) {
      return false;
    }

    if (/\b(codebase|repo|repository|project|workspace|all files?)\b/i.test(text)) {
      return false;
    }

    return /\b(find|check|inspect|analy[sz]e|review|look(?:\s+for)?|explain|summari[sz]e|debug)\b/i.test(text) ||
      /\b(issue|issues|problem|problems|bug|bugs|error|errors|wrong|fix)\b/i.test(text) ||
      /\b(this|it|that)\b/i.test(text);
  }

  _buildRelevantFileContext(relevantFiles) {
    if (!Array.isArray(relevantFiles) || relevantFiles.length === 0) {
      return "";
    }

    let context = "Relevant workspace files:\n";
    for (const file of relevantFiles) {
      const block = `File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
      if ((context + block).length > MAX_CONTEXT_CHARS) {
        break;
      }
      context += block;
    }

    return context.trim();
  }

  _isRepeatingResponse(text) {
    if (!text || text.length < REPETITION_WINDOW * 2) {
      return false;
    }

    const tail = text.slice(-REPETITION_WINDOW);
    const previousText = text.slice(0, -REPETITION_WINDOW);
    return previousText.includes(tail);
  }

  _extractPathHints(query) {
    const matches = query.match(
      /(?:[A-Za-z]:\\[^\s"'`]+|(?:[\w.-]+[\\/])+[\w.-]+(?:\.[\w]+)?|[\w.-]+\.[A-Za-z0-9]+)/g
    );

    return (matches || []).map((value) =>
      value.replace(/^["'`]|["'`]$/g, "").replace(/\\/g, "/").toLowerCase()
    );
  }

  _matchPathsFromHints(pathHints) {
    const matches = new Set();

    for (const hint of pathHints) {
      const normalizedHint = hint.replace(/\\/g, "/").toLowerCase();
      const hintedBaseName = path.basename(normalizedHint);

      for (const relativePath of this.codebaseContext.keys()) {
        const normalizedPath = relativePath.replace(/\\/g, "/").toLowerCase();
        const baseName = path.basename(normalizedPath);

        if (
          normalizedPath === normalizedHint ||
          normalizedPath.endsWith(`/${normalizedHint}`) ||
          baseName === hintedBaseName
        ) {
          matches.add(relativePath.replace(/\\/g, "/"));
        }
      }
    }

    return Array.from(matches).sort();
  }

  _resolveEditableTargets(userMessage, workspaceFolder, editorState) {
    const message = userMessage || "";
    const explicitPaths = this._matchPathsFromHints(this._extractPathHints(message));
    const targetPaths = new Set(explicitPaths);
    const isEditRequest = this._isEditRequest(message);

    if (/\b(active|current)\s+(tab|file|editor)\b/i.test(message) && editorState.activeTabPath) {
      targetPaths.add(editorState.activeTabPath);
    }

    if (/\bvisible\s+tabs?\b/i.test(message)) {
      for (const tabPath of editorState.visibleTabs) {
        targetPaths.add(tabPath);
      }
    }

    if (/\b(all\s+)?open\s+tabs?\b/i.test(message) || /\bthese\s+tabs?\b/i.test(message)) {
      for (const tabPath of editorState.allOpenTabs) {
        targetPaths.add(tabPath);
      }
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
    return {
      scope: paths.length > 0 ? "restricted" : "workspace",
      paths
    };
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
      /\b(all\s+)?open\s+tabs?\b/.test(message) || /\bcurrent\s+open\s+tabs?\b/.test(message);
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
    if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) return `node --check ${rel}`;
    if (ext === ".py") return `python -m py_compile ${rel}`;
    if (ext === ".java") return `javac ${rel}`;
    if ([".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".ino"].includes(ext)) return `node -e "process.exit(0)" && echo "C/C++ syntax check requires a compiler - run: gcc -fsyntax-only ${rel}"`;
    if (ext === ".html") return null; // HTML checked via parse5 in fixer
    return null;
  }

  async _runSyntaxCheck(relPath, workspaceFolder, streamCallback) {
    const cmd = this._getSyntaxCheckCommand(relPath);
    if (!cmd) return null;

    // C/C++ — just report the command to run, can't execute compiler here
    if (cmd.includes("gcc -fsyntax-only")) {
      const msg = `C/C++ syntax check: run \`gcc -fsyntax-only ${relPath}\` in your terminal.`;
      if (streamCallback) streamCallback(msg);
      return { success: true, output: msg, skipped: true };
    }

    if (!this.validateCommand(cmd).allowed) return null;
    const result = await this.executeCommand(cmd, workspaceFolder);
    return result;
  }

  _findRelevantFiles(query, workspaceFolder) {
    const keywords = this._extractKeywords(query);
    const pathHints = this._extractPathHints(query);
    const relevant = [];

    const activeEditor = vscode.window.activeTextEditor || this._lastActiveEditor;
    const activeRelativePath = activeEditor
      ? path.relative(workspaceFolder, activeEditor.document.fileName).replace(/\\/g, "/").toLowerCase()
      : "";

    for (const [relativePath, fileData] of this.codebaseContext.entries()) {
      const normalizedPath = relativePath.replace(/\\/g, "/").toLowerCase();
      const fileContent = fileData.content.toLowerCase();
      const fileName = fileData.fileName;
      const directory = fileData.directory;

      let score = 0;

      if (activeRelativePath && normalizedPath === activeRelativePath) {
        score += 40;
      }

      for (const hint of pathHints) {
        if (normalizedPath === hint || fileName === path.basename(hint)) {
          score += 80;
        } else if (normalizedPath.includes(hint) || hint.includes(fileName)) {
          score += 30;
        }
      }

      for (const keyword of keywords) {
        if (fileName.includes(keyword)) score += 10;
        if (directory.includes(keyword)) score += 5;
        if (normalizedPath.includes(keyword)) score += 4;
        if (fileContent.includes(keyword)) score += 1;
      }

      if (score > 0) {
        relevant.push({
          path: relativePath,
          score,
          content: fileData.content.slice(0, MAX_FILE_SNIPPET)
        });
      }
    }

    return relevant
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RELEVANT_FILES);
  }

  _buildPrompt(
    userMessage,
    relevantFiles,
    activeFileContext,
    editorStateContext,
    openTabSnippetContext,
    isTabQuestion,
    editableTargets,
    mode
  ) {
    const historyEntries = isTabQuestion
      ? this.conversationHistory.filter((entry) => entry.role === "user").slice(-2, -1)
      : this.conversationHistory.slice(-MAX_HISTORY_ENTRIES, -1);
    const history = historyEntries
      .map((entry) =>
        `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content.slice(0, 300)}`
      )
      .join("\n\n");

    let context = "";
    for (const file of relevantFiles) {
      const block = `File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
      if ((context + block).length > MAX_CONTEXT_CHARS) {
        break;
      }
      context += block;
    }

    if (!context) {
      const allFiles = Array.from(this.codebaseContext.keys()).map(p => p.replace(/\\/g, "/")).sort();
      if (allFiles.length > 0) {
        // If it's a general codebase scan request, include actual file snippets
        const isCodbaseScan = /\b(scan|review|analyze|what does|what is|overview|summarize|describe|syntax|error|errors|bug|bugs|issue|issues|logical|logic|problem|problems|check|inspect|audit)\b/i.test(userMessage);
        if (isCodbaseScan) {
          let snippetContext = "";
          for (const [relativePath, fileData] of this.codebaseContext.entries()) {
            const block = `File: ${relativePath.replace(/\\/g, "/")}\n\`\`\`\n${fileData.content.slice(0, 500)}\n\`\`\`\n\n`;
            if ((snippetContext + block).length > MAX_CONTEXT_CHARS) break;
            snippetContext += block;
          }
          context = snippetContext || `Workspace files:\n${allFiles.map(f => `- ${f}`).join("\n")}\n`;
        } else {
          context = `Workspace files:\n${allFiles.map(f => `- ${f}`).join("\n")}\n`;
        }
      } else {
        context = "No indexed files found.\n";
      }
    }

    const editableTargetsContext = this._buildEditableTargetsContext(
      editableTargets
    );
    const implicitActiveFileGuidance =
      activeFileContext && this._isLikelyActiveFileFollowUp(userMessage)
        ? "Treat short follow-up requests without an explicit file path, such as 'find issues if any' or 'explain this', as referring to the active file context attached below unless the user clearly asks for the whole workspace.\n"
        : "";

    return `You are the Code Janitor AI assistant embedded in VS Code. Answer directly and helpfully.
Mode: ${mode}.
To run a shell command write it on its own line as: CMD: <command>
To edit a file write: FILE: relative/path then a code block with the full contents.
To create a folder write: MKDIR: relative/path
Never ask the user for a file path — use the exact paths shown in the context below.
Do not wrap the whole response in markdown.

Indexed files: ${this.codebaseContext.size}
${editorStateContext ? `${editorStateContext}\n` : ""}${editableTargetsContext}${activeFileContext ? `${activeFileContext}\n\n` : ""}${openTabSnippetContext}${context}
${history ? `${history}\n\n` : ""}User: ${userMessage}

Assistant:`;
  }

  _parseResponse(response) {
    const actions = [];
    const warnings = [];

    const fileRegex = /FILE:\s*([^\n]+)\n```(\w+)?\n([\s\S]*?)```/g;
    let match;
    while ((match = fileRegex.exec(response)) !== null) {
      const normalizedPath = match[1].trim().replace(/\\/g, "/");

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
        language: match[2] || "text",
        content: match[3]
      });
    }

    const cmdRegex = /(?:```\w*\s*)?CMD:\s*(.+?)(?:\s*```)?$/gm;
    while ((match = cmdRegex.exec(response)) !== null) {
      actions.push({ type: "cmd", command: match[1].trim() });
    }

    const mkdirRegex = /MKDIR:\s*(.+)/g;
    while ((match = mkdirRegex.exec(response)) !== null) {
      actions.push({ type: "mkdir", path: match[1].trim() });
    }

    return { text: response, actions, warnings };
  }

  _resolveWorkspacePath(inputPath) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      throw new Error("No workspace");
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const resolved = path.resolve(
      path.isAbsolute(inputPath) ? inputPath : path.join(workspaceRoot, inputPath)
    );

    const relative = path.relative(workspaceRoot, resolved);
    const escapesWorkspace =
      relative.startsWith("..") || path.isAbsolute(relative);

    if (escapesWorkspace) {
      throw new Error("Path must stay inside the workspace");
    }

    return { workspaceRoot, fullPath: resolved };
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
      /\bformat\b/
    ];

    if (blockedPatterns.some((pattern) => pattern.test(normalized))) {
      return {
        allowed: false,
        reason: "Blocked unsafe, global, or network command"
      };
    }

    const allowedPrefixes = [
      "npm run ",
      "npm test",
      "npx ",
      "node --check",
      "node -e",
      "node ",
      "git status",
      "git diff",
      "git log",
      "git rev-parse",
      "python -m py_compile",
      "python -m flake8",
      "python -m pylint",
      "python ",
      "python3 -m py_compile",
      "python3 -m flake8",
      "python3 -m pylint",
      "python3 ",
      "pytest",
      "eslint ",
      "javac ",
      "java ",
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
      count <= 0 ? "none" : startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;

    const removedBlock = removedLines.length
      ? removedLines.slice(0, 12).map((line) => `- ${line}`).join("\n")
      : "- <none>";
    const addedBlock = addedLines.length
      ? addedLines.slice(0, 12).map((line) => `+ ${line}`).join("\n")
      : "+ <none>";

    return {
      changed: true,
      summary:
        `Replaced old line(s) ${formatRange(removedStartLine, removedEndLine, removedLines.length)} ` +
        `with new line(s) ${formatRange(addedStartLine, addedEndLine, addedLines.length)}.\n` +
        `${removedBlock}\n${addedBlock}`
    };
  }

  async applyChanges(filePath, newContent) {
    try {
      const { workspaceRoot, fullPath } = this._resolveWorkspacePath(filePath);
      let oldContent = "";

      try {
        oldContent = await fs.readFile(fullPath, "utf8");
      } catch (readError) {
        if (readError.code !== "ENOENT") {
          throw readError;
        }
      }

      const changeSummary = this._summarizeLineChanges(oldContent, newContent);

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, newContent, "utf8");

      const relativePath = path.relative(workspaceRoot, fullPath);
      this.codebaseContext.set(relativePath, {
        content: newContent,
        fullPath,
        fileName: path.basename(relativePath).toLowerCase(),
        directory: path.dirname(relativePath).toLowerCase()
      });

      return {
        success: true,
        path: fullPath,
        relativePath,
        changeSummary: changeSummary.summary,
        changed: changeSummary.changed,
        syntaxCheckCmd: this._getSyntaxCheckCommand(relativePath.replace(/\\/g, "/"))
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async createFolder(folderPath) {
    try {
      const { fullPath } = this._resolveWorkspacePath(folderPath);
      await fs.mkdir(fullPath, { recursive: true });
      return { success: true, path: fullPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async executeCommand(command, workspaceFolder) {
    const validation = this.validateCommand(command);
    if (!validation.allowed) {
      return { success: false, error: validation.reason };
    }

    return new Promise((resolve) => {
      const { exec } = require("child_process");
      exec(command, { cwd: workspaceFolder }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: error.message, output: stderr });
          return;
        }

        resolve({ success: true, output: stdout || stderr });
      });
    });
  }

  clearHistory() {
    this.conversationHistory = [];
  }
}

module.exports = AIAgent;
