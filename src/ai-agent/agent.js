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
    this._lastActiveEditor = null;

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) this._lastActiveEditor = editor;
    });
  }

  getConfig() {
    const config = vscode.workspace.getConfiguration("codeJanitor.ai");
    return {
      enabled: config.get("enabled", true),
      ollamaUrl: config.get("ollamaUrl", "http://localhost:11434"),
      model: config.get("model", "qwen2.5-coder:1.5b"),
      timeout: config.get("timeout", 20_000)
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

  async chat(userMessage, workspaceFolder, streamCallback, abortSignal, options = {}) {
    const config = this.getConfig();
    if (!config.enabled) {
      return { error: "AI is disabled in Code Janitor settings." };
    }

    const mode = options.mode === "heavy" ? "heavy" : "fast";
    this.conversationHistory.push({ role: "user", content: userMessage });
    const isTabQuestion = this._isTabQuestion(userMessage);
    const useHeavyContext = mode === "heavy";

    if (useHeavyContext && workspaceFolder) {
      await this.ensureCodebaseScanned(workspaceFolder);
    }

    const relevantFiles = useHeavyContext ? this._findRelevantFiles(userMessage, workspaceFolder) : [];
    const activeFileContext = this._isEditRequest(userMessage)
      ? this._getActiveFileContext(workspaceFolder)
      : "";
    const editorState = this._getEditorState(workspaceFolder);
    const editorStateContext = useHeavyContext ? this._buildEditorStateContext(editorState) : "";
    const openTabSnippetContext = useHeavyContext ? this._getOpenTabSnippetContext(editorState.allOpenTabs) : "";
    const editableTargets = this._resolveEditableTargets(
      userMessage,
      workspaceFolder,
      editorState
    );
    this.currentEditableTargets = editableTargets.paths.length
      ? new Set(editableTargets.paths)
      : null;
    const prompt = this._buildPrompt(
      userMessage,
      relevantFiles,
      activeFileContext,
      editorStateContext,
      openTabSnippetContext,
      isTabQuestion,
      editableTargets,
      mode
    );

    try {
      const response = await fetch(`${config.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortSignal || AbortSignal.timeout(config.timeout),
        body: JSON.stringify({
          model: config.model,
          prompt,
          stream: true,
          options: {
            temperature: 0.1,
            num_predict: mode === "heavy" ? 400 : 120,
            top_k: 20,
            top_p: 0.8
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed with status ${response.status}`);
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
            const data = JSON.parse(line);
            if (data.response) {
              const nextResponse = fullResponse + data.response;
              if (this._isRepeatingResponse(nextResponse)) {
                repetitionDetected = true;
                streamDone = true;
                if (!abortSignal?.aborted) {
                  try {
                    reader.cancel();
                  } catch (cancelError) {
                    // Ignore cancel failures from already-closing streams.
                  }
                }
                break;
              }

              fullResponse += data.response;
              if (streamCallback) {
                streamCallback(data.response);
              }
            }
          } catch (parseError) {
            // Ignore partial streaming chunks that are not valid JSON yet.
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

    const activeFile = activeEditor.document.fileName;
    const activeContent = activeEditor.document.getText().slice(0, 4_000);
    const relativePath = path.relative(workspaceFolder, activeFile);

    return `Active file: ${relativePath}\n\`\`\`\n${activeContent}\n\`\`\``;
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
      return "Editor state: unavailable. If asked about active, visible, or open tabs, say you do not have access to them.\n";
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

  _getOpenTabSnippetContext(openTabPaths) {
    const snippetBlocks = [];

    for (const tabPath of openTabPaths) {
      const fileData = this.codebaseContext.get(tabPath);
      if (!fileData) {
        continue;
      }

      snippetBlocks.push(
        `Open tab content: ${tabPath}\n\`\`\`\n${fileData.content.slice(
          0,
          MAX_FILE_SNIPPET
        )}\n\`\`\`\n\n`
      );

      if (snippetBlocks.length >= MAX_OPEN_TAB_SNIPPETS) {
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
      return "I do not have access to the current open tabs.";
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
      ? this.conversationHistory.filter((entry) => entry.role === "user").slice(-2)
      : this.conversationHistory.slice(-MAX_HISTORY_ENTRIES);
    const history = historyEntries
      .map((entry) =>
        `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`
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
      context = mode === "heavy"
        ? "No directly relevant files found in the indexed workspace.\n"
        : "No indexed workspace context attached in Fast mode.\n";
    }

    const editableTargetsContext = this._buildEditableTargetsContext(
      editableTargets
    );

    return `You are the Code Janitor AI assistant for a VS Code extension.
Mode: ${mode}.
${mode === "fast"
  ? "In Fast mode, use the simple pipeline: prefer concise conversational replies, avoid repo-wide reasoning, and rely only on the directly attached context."
  : "In Heavy mode, use the repo-aware context to help with code, files, and workspace edits."}
You can read the indexed workspace context and propose direct file edits.
Prefer editing files in the workspace over suggesting shell commands.
Only claim to know the active tab, visible tabs, or open tabs when they are listed in the provided context.
If editor-state data is unavailable, say exactly that you do not have access to the current open tabs.
Do not infer, guess, or invent tabs, active files, or workspace state.
For questions asking which tabs are open, visible, or active, do not provide sample code, API guidance, or general VS Code advice.
If editor-state context is present, answer tab questions by repeating only the exact tab entries from that context.
If editor-state context is unavailable, answer only with: I do not have access to the current open tabs.
If the user asks about a file that appears in the open-tab lists or indexed file context, answer the file question directly instead of repeating the tab-access disclaimer.
Treat open-tab visibility and file-analysis ability as separate: you may analyze a file from indexed or snippet context even if tab visibility is limited.
Respect the editable targets context. If a restricted target list is provided, only create or modify those files.
If you want to create or modify files, use this exact format:
FILE: relative/path.ext
\`\`\`language
full file contents
\`\`\`
If you want to create a folder, use:
MKDIR: relative/path
Only use CMD when the user explicitly asks to run a terminal command and the command is project-scoped.
Never suggest package installation, global installs, network downloads, or system-wide setup commands.
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

    const cmdRegex = /CMD:\s*(.+)/g;
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
      "node ",
      "git status",
      "git diff",
      "git log",
      "git rev-parse",
      "python ",
      "python3 ",
      "pytest",
      "eslint ",
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
        changed: changeSummary.changed
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
