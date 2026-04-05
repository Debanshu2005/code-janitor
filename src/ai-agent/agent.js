const vscode = require("vscode");
const fs = require("fs").promises;
const path = require("path");

const MAX_SCAN_FILE_SIZE = 200 * 1024;
const MAX_CONTEXT_CHARS = 14_000;
const MAX_FILE_SNIPPET = 2_500;
const MAX_RELEVANT_FILES = 8;
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

  async chat(userMessage, workspaceFolder, streamCallback, abortSignal) {
    const config = this.getConfig();
    if (!config.enabled) {
      return { error: "AI is disabled in Code Janitor settings." };
    }

    await this.ensureCodebaseScanned(workspaceFolder);
    this.conversationHistory.push({ role: "user", content: userMessage });

    const relevantFiles = this._findRelevantFiles(userMessage, workspaceFolder);
    const activeFileContext = this._getActiveFileContext(workspaceFolder);
    const prompt = this._buildPrompt(userMessage, relevantFiles, activeFileContext);

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
            num_predict: 900,
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
        content: fullResponse
      });

      return this._parseResponse(fullResponse);
    } catch (error) {
      if (error.name === "AbortError") {
        return { text: "Generation stopped", actions: [] };
      }

      return { error: `AI error: ${error.message}` };
    }
  }

  _getActiveFileContext(workspaceFolder) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return "";
    }

    const activeFile = activeEditor.document.fileName;
    const activeContent = activeEditor.document.getText().slice(0, 4_000);
    const relativePath = path.relative(workspaceFolder, activeFile);

    return `Active file: ${relativePath}\n\`\`\`\n${activeContent}\n\`\`\``;
  }

  _extractKeywords(query) {
    return query
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .filter((word) => word && word.length > 1 && !STOP_WORDS.has(word));
  }

  _extractPathHints(query) {
    const matches = query.match(
      /(?:[A-Za-z]:\\[^\s"'`]+|(?:[\w.-]+[\\/])+[\w.-]+(?:\.[\w]+)?|[\w.-]+\.[A-Za-z0-9]+)/g
    );

    return (matches || []).map((value) =>
      value.replace(/^["'`]|["'`]$/g, "").replace(/\\/g, "/").toLowerCase()
    );
  }

  _findRelevantFiles(query, workspaceFolder) {
    const keywords = this._extractKeywords(query);
    const pathHints = this._extractPathHints(query);
    const relevant = [];

    const activeEditor = vscode.window.activeTextEditor;
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

  _buildPrompt(userMessage, relevantFiles, activeFileContext) {
    const history = this.conversationHistory
      .slice(-4)
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
      context = "No directly relevant files found in the indexed workspace.\n";
    }

    return `You are the Code Janitor AI assistant for a VS Code extension.
You can read the indexed workspace context and propose direct file edits.
Prefer editing files in the workspace over suggesting shell commands.
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
${activeFileContext ? `${activeFileContext}\n\n` : ""}${context}
${history ? `${history}\n\n` : ""}User: ${userMessage}

Assistant:`;
  }

  _parseResponse(response) {
    const actions = [];

    const fileRegex = /FILE:\s*([^\n]+)\n```(\w+)?\n([\s\S]*?)```/g;
    let match;
    while ((match = fileRegex.exec(response)) !== null) {
      actions.push({
        type: "file",
        path: match[1].trim(),
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

    return { text: response, actions };
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

  async applyChanges(filePath, newContent) {
    try {
      const { workspaceRoot, fullPath } = this._resolveWorkspacePath(filePath);

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, newContent, "utf8");

      const relativePath = path.relative(workspaceRoot, fullPath);
      this.codebaseContext.set(relativePath, {
        content: newContent,
        fullPath,
        fileName: path.basename(relativePath).toLowerCase(),
        directory: path.dirname(relativePath).toLowerCase()
      });

      return { success: true, path: fullPath };
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
