const vscode = require("vscode");
const fs = require("fs").promises;
const path = require("path");

const MAX_SCAN_FILE_SIZE = 200 * 1024;
const MAX_CONTEXT_CHARS = 10_000;
const MAX_FILE_SNIPPET = 1_800;
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

class AIAgent {
  constructor() {
    this.codebaseContext = new Map();
    this.conversationHistory = [];
    this.scanVersion = 0;
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

    const files = await this._getAllFiles(workspaceFolder);
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        if (stat.size > MAX_SCAN_FILE_SIZE) {
          continue;
        }

        const content = await fs.readFile(file, "utf8");
        const relativePath = path.relative(workspaceFolder, file);
        this.codebaseContext.set(relativePath, { content, fullPath: file });
      } catch (error) {
        console.warn(`Failed to read ${file}:`, error.message);
      }
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

      if (
        /\.(js|jsx|ts|tsx|py|java|c|cpp|h|html|css|json|md)$/i.test(entry.name)
      ) {
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

    this.conversationHistory.push({ role: "user", content: userMessage });

    const relevantFiles = this._findRelevantFiles(userMessage);
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
            num_predict: 768,
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
    const activeContent = activeEditor.document.getText().slice(0, 3_000);
    const relativePath = path.relative(workspaceFolder, activeFile);

    return `Active file: ${relativePath}\n\`\`\`\n${activeContent}\n\`\`\``;
  }

  _extractKeywords(query) {
    return query
      .toLowerCase()
      .split(/[^a-z0-9_.-]+/)
      .filter((word) => word && word.length > 1 && !STOP_WORDS.has(word));
  }

  _findRelevantFiles(query) {
    const keywords = this._extractKeywords(query);
    const relevant = [];

    for (const [relativePath, fileData] of this.codebaseContext.entries()) {
      const fileContent = fileData.content.toLowerCase();
      const fileName = path.basename(relativePath).toLowerCase();
      const fileDir = path.dirname(relativePath).toLowerCase();

      let score = 0;
      for (const keyword of keywords) {
        if (fileName.includes(keyword)) score += 8;
        if (fileDir.includes(keyword)) score += 4;
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

    return relevant.sort((a, b) => b.score - a.score).slice(0, 6);
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
Answer concisely and propose precise code changes.
If you want to create or modify files, use this exact format:
FILE: relative/path.ext
\`\`\`language
full file contents
\`\`\`
If you want to create a folder, use:
MKDIR: relative/path
If you want to suggest a terminal command, use:
CMD: command
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

  async applyChanges(filePath, newContent) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        return { success: false, error: "No workspace" };
      }

      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath);

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, newContent, "utf8");

      const relativePath = path.relative(workspaceRoot, fullPath);
      this.codebaseContext.set(relativePath, { content: newContent, fullPath });

      return { success: true, path: fullPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async createFolder(folderPath) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        return { success: false, error: "No workspace" };
      }

      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const fullPath = path.isAbsolute(folderPath)
        ? folderPath
        : path.join(workspaceRoot, folderPath);

      await fs.mkdir(fullPath, { recursive: true });
      return { success: true, path: fullPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async executeCommand(command, workspaceFolder) {
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
