// src/ai-agent/agent.js
const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

class AIAgent {
  constructor() {
    this.ollamaUrl = 'http://localhost:11434';
    this.model = 'codellama:latest';
    this.codebaseContext = new Map();
    this.conversationHistory = [];
  }

  async scanCodebase(workspaceFolder) {
    const files = await this._getAllFiles(workspaceFolder);
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf8');
        const relativePath = path.relative(workspaceFolder, file);
        this.codebaseContext.set(relativePath, { content, fullPath: file });
      } catch (error) {
        console.warn(`Failed to read ${file}:`, error.message);
      }
    }
    return files.length;
  }

  async _getAllFiles(dir, fileList = []) {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'build', 'venv', 'out'].includes(file)) {
          await this._getAllFiles(filePath, fileList);
        }
      } else if (/\.(js|py|java|c|cpp|h|html|css|json|md|txt)$/i.test(file)) {
        fileList.push(filePath);
      }
    }
    return fileList;
  }

  async chat(userMessage, workspaceFolder, streamCallback, abortSignal) {
    const relevantFiles = this._findRelevantFiles(userMessage);
    this.conversationHistory.push({ role: 'user', content: userMessage });
    
    // Get active editor file if available
    const activeEditor = vscode.window.activeTextEditor;
    let activeFileContext = '';
    if (activeEditor) {
      const activeFile = activeEditor.document.fileName;
      const activeContent = activeEditor.document.getText();
      const relativePath = path.relative(workspaceFolder, activeFile);
      activeFileContext = `\n\nActive File: ${relativePath}\n\`\`\`\n${activeContent.slice(0, 5000)}\n\`\`\``;
    }
    
    const context = this._buildContext(relevantFiles);
    const history = this._buildHistory();
    
    const prompt = `You are an AI coding assistant for Code Janitor VSCode extension.

Project: ${path.basename(workspaceFolder)}
Files scanned: ${this.codebaseContext.size}
${activeFileContext ? '\n**CURRENTLY OPEN FILE:**' + activeFileContext : ''}

${context}

${history}

User: ${userMessage}

Assistant:`;

    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: true,
          options: { temperature: 0.3, num_predict: 2048 }
        }),
        signal: abortSignal
      });

      if (!response.ok) throw new Error('Ollama request failed');
      
      let fullResponse = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        if (abortSignal?.aborted) break;
        
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.response) {
              fullResponse += data.response;
              if (streamCallback) streamCallback(data.response);
            }
          } catch (e) {}
        }
      }
      
      this.conversationHistory.push({ role: 'assistant', content: fullResponse });
      return this._parseResponse(fullResponse);
    } catch (error) {
      if (error.name === 'AbortError') {
        return { text: 'Generation stopped', changes: [] };
      }
      return { error: `AI Error: ${error.message}` };
    }
  }

  _findRelevantFiles(query) {
    const keywords = query.toLowerCase().split(/\s+/);
    const relevant = [];
    
    for (const [relativePath, fileData] of this.codebaseContext.entries()) {
      const fileContent = fileData.content.toLowerCase();
      const fileName = path.basename(relativePath).toLowerCase();
      const fileDir = path.dirname(relativePath).toLowerCase();
      
      let score = 0;
      for (const kw of keywords) {
        if (fileName.includes(kw)) score += 10;
        if (fileDir.includes(kw)) score += 5;
        if (fileContent.includes(kw)) score += 1;
      }
      
      if (score > 0) {
        relevant.push({ 
          path: relativePath, 
          content: fileData.content.slice(0, 3000), 
          score 
        });
      }
    }
    
    return relevant.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  _buildContext(files) {
    if (files.length === 0) return 'No specific files found. Using general knowledge.';
    return files.map(f => `File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
  }

  _buildHistory() {
    const recent = this.conversationHistory.slice(-4);
    return recent.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n\n');
  }

  _parseResponse(response) {
    const actions = [];
    
    // Parse FILE: actions
    const fileRegex = /FILE:\s*([^\n]+)\n```(\w+)?\n([\s\S]*?)```/g;
    let match;
    while ((match = fileRegex.exec(response)) !== null) {
      actions.push({ type: 'file', path: match[1].trim(), language: match[2] || 'text', content: match[3] });
    }
    
    // Parse CMD: actions
    const cmdRegex = /CMD:\s*(.+)/g;
    while ((match = cmdRegex.exec(response)) !== null) {
      actions.push({ type: 'cmd', command: match[1].trim() });
    }
    
    // Parse MKDIR: actions
    const mkdirRegex = /MKDIR:\s*(.+)/g;
    while ((match = mkdirRegex.exec(response)) !== null) {
      actions.push({ type: 'mkdir', path: match[1].trim() });
    }
    
    // Don't encode entities - let the UI handle it
    return { text: response, actions };
  }

  async applyChanges(filePath, newContent) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) return { success: false, error: 'No workspace' };
      
      const fullPath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(workspaceFolders[0].uri.fsPath, filePath);
      
      await fs.writeFile(fullPath, newContent, 'utf8');
      
      const relativePath = path.relative(workspaceFolders[0].uri.fsPath, fullPath);
      this.codebaseContext.set(relativePath, { content: newContent, fullPath });
      
      return { success: true, path: fullPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async createFolder(folderPath) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) return { success: false, error: 'No workspace' };
      
      const fullPath = path.isAbsolute(folderPath) 
        ? folderPath 
        : path.join(workspaceFolders[0].uri.fsPath, folderPath);
      
      await fs.mkdir(fullPath, { recursive: true });
      return { success: true, path: fullPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async executeCommand(command, workspaceFolder) {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      exec(command, { cwd: workspaceFolder }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: error.message, output: stderr });
        } else {
          resolve({ success: true, output: stdout || stderr });
        }
      });
    });
  }

  clearHistory() {
    this.conversationHistory = [];
  }
}

module.exports = AIAgent;
