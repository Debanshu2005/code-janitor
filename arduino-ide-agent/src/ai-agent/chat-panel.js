const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const AIAgent = require("./agent");
const { ArduinoDiagnostics } = require("./arduino-diagnostics");
const { computeMinimalReplacement } = require("../utils/minimal-diff");

const MODELS_BY_PROVIDER = {
  groq: [
    "llama-3.1-8b-instant",
    "llama-3.1-70b-versatile",
    "llama3-8b-8192",
    "llama3-70b-8192",
    "mixtral-8x7b-32768",
    "gemma2-9b-it"
  ],
  openrouter: [
    "qwen/qwen-2.5-coder-32b-instruct",
    "qwen/qwen3-coder:free",
    "qwen/qwen3-coder",
    "qwen/qwen3-32b",
    "qwen/qwen3-14b",
    "qwen/qwen3-8b",
    "qwen/qwq-32b",
    "qwen/qwen2.5-coder-7b-instruct",
    "qwen/qwen-2.5-72b-instruct",
    "deepseek/deepseek-r1-distill-qwen-32b",
    "meta-llama/llama-3.3-70b-instruct",
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemini-2.0-flash-exp:free",
    "mistralai/mistral-7b-instruct:free"
  ],
  anthropic: ["claude-opus-4-5","claude-sonnet-4-5","claude-3-5-sonnet-20241022","claude-3-5-haiku-20241022","claude-3-opus-20240229"],
  nvidia: [
    "meta/llama-3.1-8b-instruct",
    "nvidia/nvidia-nemotron-nano-9b-v2",
    "minimaxai/minimax-m2.7",
    "mistralai/mistral-nemotron",
    "meta/llama-3.1-70b-instruct",
    "nvidia/llama-3.3-nemotron-super-49b-v1.5"
  ]
};

class ChatPanel {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.welcomePanel = null;
    this.sidebarView = null;
    this.circuitPreviewPanel = null;
    this.agent = new AIAgent(context); // Pass context to agent
    this.arduinoDiagnostics = new ArduinoDiagnostics(vscode);
    this.abortController = null;
    this.lastActiveEditor = vscode.window.activeTextEditor || null;
    this.chatMode = "fast";
    this._confirmResolve = null;
    this._providerSwitchVersion = 0;
    this._modelSelectionVersion = 0;
    this._undoStack = [];
    this._undoIdCounter = 0;
    this.showThinking = !!this.context.globalState.get(
      "codeJanitor.ai.showThinking",
      false
    );
    this.agent.showThinking = this.showThinking;

    this.agent.setActiveEditor(this.lastActiveEditor);

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === "file") this.lastActiveEditor = editor;
    }, null, context.subscriptions);
  }

  // Unified message routing: reply to every live Code Janitor webview. The
  // welcome sidebar can remain alive while the chat panel is active, so choosing
  // only one target can strand UI state like "Saving..." in the wrong webview.
  _postMessage(message) {
    const targets = [this.panel?.webview, this.sidebarView?.webview].filter(Boolean);
    for (const webview of new Set(targets)) {
      webview.postMessage(message);
    }
  }

  _postSessionState(extra = {}) {
    this._postMessage({
      type: "sessionState",
      ...this.agent.getSessionState(),
      ...extra
    });
  }

  _postAssistantImages(images = []) {
    const safeImages = Array.isArray(images)
      ? images.filter((url) => typeof url === "string" && /^data:image\//i.test(url))
      : []
    if (safeImages.length === 0) return
    this._postMessage({
      type: "assistantImages",
      images: safeImages
    })
  }

  async _setThinkingMode(enabled) {
    this.showThinking = !!enabled;
    this.agent.showThinking = this.showThinking;
    await this.context.globalState.update(
      "codeJanitor.ai.showThinking",
      this.showThinking
    );
    this._postMessage({
      type: "thinkingState",
      enabled: this.showThinking
    });
  }

  // Push a recently-applied edit onto the undo stack and return an id the
  // webview can use to trigger a revert. Returns null when there is nothing
  // worth undoing (no real change, or no before-snapshot available).
  _getCurrentChatSessionId() {
    return this.agent?.getSessionState?.().currentSessionId || null;
  }

  _registerEditForUndo({ filePath, before, after, label }) {
    if (typeof before !== "string" || typeof after !== "string") return null;
    if (before === after) return null;
    const sessionId = this._getCurrentChatSessionId();
    const id = `undo-${++this._undoIdCounter}-${Date.now()}`;
    this._undoStack.push({
      id,
      sessionId: sessionId || null,
      filePath: String(filePath || ""),
      before,
      after,
      label: label || "edit",
      ts: Date.now()
    });
    if (this._undoStack.length > 50) this._undoStack.shift();
    return id;
  }

  _findEditorForFile(filePath) {
    if (!filePath) return null;
    const target = String(filePath).replace(/\\/g, "/").toLowerCase();
    for (const editor of vscode.window.visibleTextEditors || []) {
      const docPath = editor?.document?.uri?.fsPath || editor?.document?.fileName || "";
      const norm = String(docPath).replace(/\\/g, "/").toLowerCase();
      if (norm === target) return editor;
    }
    return null;
  }

  // Revert the matching entry (by id) or the most recent edit (when id is
  // omitted). On success the entry is removed; on failure it is restored so
  // the user can retry.
  async _undoEdit(id) {
    if (!this.panel?.webview) return { success: false, error: "no_panel" };
    if (this._undoStack.length === 0) {
      this._postMessage({
        type: "status",
        text: "Nothing to undo."
      });
      return { success: false, error: "empty_stack" };
    }

    let idx = -1;
    if (id) {
      idx = this._undoStack.findIndex((e) => e.id === id);
      if (idx < 0) {
        this._postMessage({
          type: "status",
          text: "That edit has already been undone."
        });
        return { success: false, error: "not_found" };
      }
    } else {
      idx = this._undoStack.length - 1;
    }

    const entry = this._undoStack.splice(idx, 1)[0];
    const baseName = entry.filePath ? path.basename(entry.filePath) : "file";

    let result;
    const editor = this._findEditorForFile(entry.filePath);
    if (editor) {
      result = await this._applyToEditor(editor, entry.before);
    } else {
      result = await this.agent.applyChanges(
        entry.filePath,
        entry.before,
        true,
        { allowEmpty: true, allowDocTruncate: true }
      );
    }

    if (result && result.success) {
      this._postMessage({ type: "editUndone", id: entry.id });
      this._postMessage({
        type: "applied",
        filePath: result.path || entry.filePath,
        text: `↶ Undid edit to ${baseName}`
      });
      return { success: true };
    }

    this._undoStack.splice(idx, 0, entry);
    this._postMessage({
      type: "error",
      text: `Undo failed for ${baseName}: ${result?.error || "unknown error"}`
    });
    return { success: false, error: result?.error || "unknown" };
  }

  // Free-form intent detector. /undo is matched separately so it works even
  // when the user includes context like "/undo last".
  _isUndoRequest(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return false;
    if (/^undo\b/.test(t)) return true;
    if (/^(revert|rollback|roll back|take back|take that back)\b/.test(t)) return true;
    if (/\b(undo|revert|rollback|roll back)\b.*\b(that|last|previous|recent|edit|change|fix|patch|rectif)/.test(t)) return true;
    return false;
  }

  _resolveArduinoProjectRoot(workspaceFolder) {
    return this.arduinoDiagnostics.resolveProjectRoot(
      workspaceFolder,
      this.lastActiveEditor || vscode.window.activeTextEditor
    );
  }

  async _walkArduinoSourceFiles(rootDir, bucket = []) {
    return this.arduinoDiagnostics.walkSourceFiles(rootDir, bucket);
  }

  async show() {
    this.lastActiveEditor = vscode.window.activeTextEditor || this.lastActiveEditor;
    this.agent.setActiveEditor(this.lastActiveEditor);

    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const currentProvider = cfg.get("provider", "nvidia");
    const missingKeyForSelectedProvider =
      (currentProvider === "groq" && !cfg.get("groqApiKey", "")) ||
      (currentProvider === "openrouter" && !cfg.get("openrouterApiKey", "")) ||
      (currentProvider === "anthropic" && !cfg.get("anthropicApiKey", "")) ||
      (currentProvider === "nvidia" && !cfg.get("nvidiaApiKey", ""));

    if (missingKeyForSelectedProvider) {
      await this._updateAiConfig("provider", "ollama");
      await this.context.globalState.update("codeJanitor.ai.provider", "ollama");
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
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(__dirname))]
      }
    );

    this.panel.webview.html = this._getHtmlContent(this.panel.webview);
    // Initial state is sent when the webview fires the "ready" message
    this._setupMessageHandler();
    this.panel.onDidDispose(() => { this.panel = null; });
  }

  async runEspDoctor() {
    await this.show();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    await this._runEspBoardDoctor(workspaceFolder);
  }

  async _runSyntaxScanLegacy(workspaceFolder, specificFiles) {
    if (!workspaceFolder) {
      this._postMessage({ type: "status", text: "No workspace open." });
      return;
    }
    
    this._postMessage({ type: "thinking" });
    
    // Get current board and port configuration
    let boardInfo = "";
    let detectedBoard = null;
    let detectedPort = null;
    
    try {
      // Try to get Arduino board configuration from multiple sources
      const arduinoConfig = vscode.workspace.getConfiguration('arduino');
      
      // Try different config keys that Arduino IDE 2.x might use
      let board = arduinoConfig.get('board') || 
                  arduinoConfig.get('selectedBoard') || 
                  arduinoConfig.get('defaultBoard');
      
      let port = arduinoConfig.get('port') || 
                 arduinoConfig.get('selectedPort') || 
                 arduinoConfig.get('defaultPort');
      
      // If not in config, try to get from Arduino CLI or IDE commands
      if (!board || !port) {
        try {
          // Try to execute Arduino board list command to detect connected boards
          const boardListResult = await vscode.commands.executeCommand('arduino-ide.boardList');
          if (boardListResult) {
            console.log('[Arduino] Board list result:', boardListResult);
          }
        } catch (err) {
          console.log('[Arduino] Could not get board list:', err.message);
        }
        
        // Try alternative methods to get board info
        try {
          const workbench = vscode.workspace.getConfiguration('arduino.workbench');
          board = board || workbench.get('board');
          port = port || workbench.get('port');
        } catch (err) {
          console.log('[Arduino] Could not read workbench config:', err.message);
        }
        
        // Last resort: try to detect via system commands
        if (!port) {
          try {
            const os = require('os');
            const platform = os.platform();
            let detectCmd = '';
            
            if (platform === 'win32') {
              // Windows: use mode command to list COM ports
              detectCmd = 'mode';
            } else if (platform === 'darwin') {
              // macOS: list USB serial devices
              detectCmd = 'ls /dev/cu.* 2>/dev/null || echo "No devices"';
            } else {
              // Linux: list ttyUSB and ttyACM devices
              detectCmd = 'ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || echo "No devices"';
            }
            
            const portDetectResult = await this.agent.executeCommand(detectCmd, workspaceFolder);
            if (portDetectResult.success && portDetectResult.output) {
              const output = portDetectResult.output.trim();
              if (output && !output.includes('No devices')) {
                // Parse the first available port
                const lines = output.split('\n').filter(l => l.trim());
                if (lines.length > 0) {
                  if (platform === 'win32') {
                    // Extract COM port from Windows mode output
                    const comMatch = output.match(/COM\d+/i);
                    if (comMatch) {
                      port = comMatch[0];
                      console.log(`[Arduino] Detected port via system: ${port}`);
                    }
                  } else {
                    // Use first device on Unix-like systems
                    port = lines[0].trim();
                    console.log(`[Arduino] Detected port via system: ${port}`);
                  }
                }
              }
            }
          } catch (err) {
            console.log('[Arduino] System port detection failed:', err.message);
          }
        }
      }
      
      detectedBoard = board;
      detectedPort = port;
      
      // Format board info for display
      if (board) {
        // Handle board object or string - extract meaningful info
        let boardName = 'Unknown Board';
        
        if (typeof board === 'object') {
          // Try to extract board name from various possible properties
          boardName = board.name || 
                     board.boardName || 
                     board.fqbn || 
                     board.board || 
                     board.selectedBoard ||
                     board.type ||
                     board.id;
          
          // If still an object or empty, try to parse FQBN
          if (typeof boardName === 'object' || !boardName) {
            const fqbn = board.fqbn || board.FQBN || '';
            if (fqbn && typeof fqbn === 'string') {
              // Extract board name from FQBN (e.g., "arduino:avr:uno" -> "Uno")
              const parts = fqbn.split(':');
              if (parts.length >= 3) {
                boardName = parts[2].charAt(0).toUpperCase() + parts[2].slice(1);
              }
            }
          }
          
          // Last resort: show JSON but filter out empty/useless fields
          if (typeof boardName === 'object' || !boardName || boardName === 'Unknown Board') {
            const filtered = {};
            for (const key in board) {
              if (board[key] && board[key] !== '' && key !== 'certificates') {
                filtered[key] = board[key];
              }
            }
            if (Object.keys(filtered).length > 0) {
              boardName = JSON.stringify(filtered);
            }
          }
        } else {
          boardName = String(board);
        }
        
        boardInfo = `📟 Board: ${boardName}`;
        
        if (port) {
          let portName = 'Unknown Port';
          
          if (typeof port === 'object') {
            portName = port.address || 
                      port.port || 
                      port.portName ||
                      port.name ||
                      port.device;
            
            if (typeof portName === 'object' || !portName) {
              portName = JSON.stringify(port);
            }
          } else {
            portName = String(port);
          }
          
          boardInfo += ` | Port: ${portName}`;
        } else {
          boardInfo += ` | Port: Not detected`;
        }
        
        this._postMessage({ type: "status", text: boardInfo });
      } else {
        // No board detected - provide helpful message
        const noBoard = "⚠️ No board detected. Please:\n" +
                       "1. Connect your Arduino board via USB\n" +
                       "2. Select board from Arduino toolbar (top-right)\n" +
                       "3. Select port from Arduino toolbar\n" +
                       "4. Try again";
        this._postMessage({ type: "status", text: noBoard });
        
        // Try to open board selector
        try {
          const selection = await vscode.window.showInformationMessage(
            'No Arduino board detected. Would you like to select a board?',
            'Select Board',
            'Cancel'
          );
          
          if (selection === 'Select Board') {
            // Try to open board selector
            const boardCommands = [
              'arduino-ide.selectBoard',
              'arduino.selectBoard',
              'arduino.changeBoardType'
            ];
            
            for (const cmd of boardCommands) {
              try {
                await vscode.commands.executeCommand(cmd);
                break;
              } catch (err) {
                continue;
              }
            }
          }
        } catch (err) {
          console.log('[Arduino] Could not prompt for board selection:', err.message);
        }
      }
    } catch (err) {
      console.error('[Arduino] Error reading board config:', err);
      this._postMessage({ 
        type: "status", 
        text: `⚠️ Could not detect Arduino board. Error: ${err.message}` 
      });
    }
    
    this._postMessage({ type: "status", text: "Checking Arduino sketch for errors..." });
    
    // Instead of relying on arduino.verify command, use VS Code diagnostics
    // which are populated by Arduino Language Server automatically
    try {
      // First, try to trigger a compilation/verification if possible
      const possibleCommands = [
        'arduino-ide.verify',
        'arduino.languageserver.verify', 
        'arduino.verify',
        'arduino-cli.verify',
        'arduino-ide.compile',
        'arduino.compile'
      ];
      
      let commandExecuted = false;
      let executedCommand = '';
      
      // Try to execute verify/compile command
      for (const cmd of possibleCommands) {
        try {
          // Check if command exists first
          const allCommands = await vscode.commands.getCommands();
          if (!allCommands.includes(cmd)) {
            console.log(`[Arduino] Command ${cmd} not registered`);
            continue;
          }
          
          console.log(`[Arduino] Trying command: ${cmd}`);
          await vscode.commands.executeCommand(cmd);
          commandExecuted = true;
          executedCommand = cmd;
          console.log(`[Arduino] Successfully executed: ${cmd}`);
          this._postMessage({ 
            type: "status", 
            text: `Running verification using: ${cmd}` 
          });
          break;
        } catch (err) {
          console.log(`[Arduino] Command ${cmd} failed: ${err.message}`);
          continue;
        }
      }
      
      if (!commandExecuted) {
        // Fallback: just read diagnostics without triggering verify
        // Arduino Language Server should populate diagnostics automatically
        this._postMessage({ 
          type: "status", 
          text: "No verify command available. Reading diagnostics from Arduino Language Server..." 
        });
        
        // List all available commands for debugging
        try {
          const allCommands = await vscode.commands.getCommands();
          const arduinoCommands = allCommands.filter(cmd => 
            cmd.toLowerCase().includes('arduino')
          ).slice(0, 10);
          
          if (arduinoCommands.length > 0) {
            console.log('[Arduino] Available Arduino commands:', arduinoCommands.join(', '));
            this._postMessage({ 
              type: "status", 
              text: `Available Arduino commands: ${arduinoCommands.slice(0, 5).join(', ')}${arduinoCommands.length > 5 ? '...' : ''}` 
            });
          } else {
            this._postMessage({ 
              type: "status", 
              text: "No Arduino commands found. Make sure Arduino IDE extension is active." 
            });
          }
        } catch (err) {
          console.log('[Arduino] Could not list commands:', err.message);
        }
      }
      
      // Wait a bit for compilation to complete and diagnostics to update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Now check diagnostics for compilation errors
      const diagnostics = vscode.languages.getDiagnostics();
      const errorsFound = [];
      
      for (const [uri, fileDiagnostics] of diagnostics) {
        if (uri.scheme !== 'file') continue;
        
        const relativePath = path.relative(workspaceFolder, uri.fsPath).replace(/\\/g, '/');
        
        // If specific files requested, filter to those
        if (specificFiles && !specificFiles.includes(relativePath)) continue;
        
        // Only show errors and warnings
        const errors = fileDiagnostics.filter(d => 
          d.severity === vscode.DiagnosticSeverity.Error || 
          d.severity === vscode.DiagnosticSeverity.Warning
        );
        
        if (errors.length > 0) {
          for (const diag of errors) {
            const severity = diag.severity === vscode.DiagnosticSeverity.Error ? '❌' : '⚠️';
            const line = diag.range.start.line + 1;
            const errorText = `${severity} Line ${line}: ${diag.message}`;
            
            errorsFound.push({
              file: relativePath,
              error: errorText,
              line: line,
              isLibraryError: /library|import|include|module|package|cannot find|no such file/i.test(diag.message)
            });
          }
        }
      }
      
      let reply = `Arduino Verify completed.\n`;
      if (boardInfo) {
        reply += `${boardInfo}\n`;
      }
      this._postMessage({ type: "stream", text: reply });
      
      if (errorsFound.length === 0) {
        const summary = "\n\n✅ Sketch verified successfully! No errors found.";
        this._postMessage({ type: "stream", text: summary });
        this._postMessage({ type: "done" });
        return;
      }
      
      // Show errors
      for (const { file, error } of errorsFound) {
        const msg = `\n${error} in ${file}`;
        this._postMessage({ type: "stream", text: msg });
        reply += msg;
      }
      
      const summary = `\n\nFound ${errorsFound.length} issue(s). AI will now fix them...`;
      this._postMessage({ type: "stream", text: summary });
      
      // Group errors by file
      const errorsByFile = new Map();
      for (const { file, error, isLibraryError } of errorsFound) {
        if (!errorsByFile.has(file)) {
          errorsByFile.set(file, []);
        }
        errorsByFile.get(file).push({ error, isLibraryError });
      }
      
      // AI fixes each file
      for (const [file, errors] of errorsByFile) {
        const hasLibraryError = errors.some(e => e.isLibraryError);
        
        if (hasLibraryError) {
          const libraryMsg = `\n\n📚 ${file}: Missing library detected. Use "📚 Check libraries" to compare imports vs installed and get install commands.`;
          this._postMessage({ type: "stream", text: libraryMsg });
          continue;
        }
        
        this._postMessage({ type: "stream", text: `\n\n🔧 Fixing ${file}...` });
        
        const errorList = errors.map(e => e.error).join('\n');
        const fixPrompt = `Fix the Arduino compilation errors in ${file}:\n\nErrors:\n${errorList}\n\nReturn the complete corrected file using FILE: ${file} format.`;
        
        try {
          const fixResponse = await this.agent.chat(
            fixPrompt,
            workspaceFolder,
            null,
            null,
            { mode: "fast", onStatus: (text) => {
              this._postMessage({ type: "status", text });
            }}
          );
          
          if (fixResponse.error) {
            this._postMessage({ type: "stream", text: `\n❌ Failed to fix: ${fixResponse.error}` });
            continue;
          }
          
          if (fixResponse.actions && fixResponse.actions.length > 0) {
            const fileAction = fixResponse.actions.find(a => a.type === "file" && a.path === file);
            if (fileAction) {
              const applyResult = await this.agent.applyChanges(file, fileAction.content, false, {});
              if (applyResult.success) {
                this._postMessage({ type: "stream", text: `\n✅ Fixed ${file}` });
              } else {
                this._postMessage({ type: "stream", text: `\n❌ Failed to apply fix: ${applyResult.error}` });
              }
            }
          }
        } catch (err) {
          this._postMessage({ type: "stream", text: `\n❌ Error fixing ${file}: ${err.message}` });
        }
      }
      
      this._postMessage({ type: "stream", text: "\n\n✅ Syntax check and fix complete." });
      this._postMessage({ type: "done" });
      
    } catch (err) {
      this._postMessage({ 
        type: "error", 
        text: `Arduino Verify failed: ${err.message}. Make sure a sketch is open and a board is selected.` 
      });
      this._postMessage({ type: "done" });
    }
  }

  _formatArduinoIssue(issue) {
    const marker = issue.severity === "error" ? "ERROR" : "WARN";
    return `${marker} ${issue.file}:${issue.line} - ${issue.message}`;
  }

  _groupArduinoIssuesByFile(issues) {
    const grouped = new Map();
    for (const issue of issues || []) {
      if (!grouped.has(issue.file)) grouped.set(issue.file, []);
      grouped.get(issue.file).push(issue);
    }
    return grouped;
  }

  async _collectArduinoHealth(workspaceFolder, specificFiles, statusPrefix = "") {
    return this.arduinoDiagnostics.collectProjectHealth({
      workspaceFolder,
      activeEditor: this.lastActiveEditor || vscode.window.activeTextEditor,
      specificFiles,
      commandRunner: (command, cwd) => this.agent.executeCommand(command, cwd),
      onStatus: (text) => {
        this._postMessage({
          type: "status",
          text: statusPrefix ? `${statusPrefix}: ${text}` : text
        });
      }
    });
  }

  async _promptForBoardSelectionIfMissing(health) {
    if (!health || health.board) return;

    const selection = await vscode.window.showInformationMessage(
      "No Arduino board detected. Would you like to select a board?",
      "Select Board",
      "Cancel"
    );

    if (selection !== "Select Board") return;

    const boardCommands = [
      "arduino-ide.selectBoard",
      "arduino.selectBoard",
      "arduino.changeBoardType"
    ];

    for (const command of boardCommands) {
      try {
        await vscode.commands.executeCommand(command);
        return;
      } catch (_) {
        // Try the next host-specific board selector.
      }
    }
  }

  _buildArduinoHealthReport(health, includeFixHint = true) {
    const lines = ["Arduino Verify completed."];
    if (health.boardInfo) {
      lines.push(health.boardInfo);
    } else {
      lines.push(
        "No board detected. Select a board and port from the Arduino toolbar for compile-accurate checks."
      );
    }

    if (!health.commandExecuted) {
      lines.push("No Arduino verify command was available; using current diagnostics.");
      if (health.availableArduinoCommands?.length) {
        lines.push(
          `Available Arduino commands: ${health.availableArduinoCommands
            .slice(0, 5)
            .join(", ")}`
        );
      }
    }

    if (!health.issues.length) {
      lines.push("");
      lines.push("Sketch diagnostics are clean. No errors or warnings were found.");
      return lines.join("\n");
    }

    lines.push("");
    lines.push(`Found ${health.issues.length} issue(s):`);
    for (const issue of health.issues) {
      lines.push(`- ${this._formatArduinoIssue(issue)}`);
    }

    if (includeFixHint) {
      lines.push("");
      lines.push("Use Actions > Fix Compile Error to generate and apply a targeted patch.");
    }

    return lines.join("\n");
  }

  _isArduinoSafetyModeEnabled() {
    return true;
  }

  _isBlockedArduinoPath(filePath) {
    const normalized = String(filePath || "").replace(/\\/g, "/").toLowerCase();
    if (!normalized) return false;
    if (/(^|\/)(\.git|node_modules|build|dist|out|\.pio\/build|\.arduinoide)(\/|$)/.test(normalized)) {
      return true;
    }
    return /(^|\/)(\.env|id_rsa|id_dsa|id_ecdsa|id_ed25519|known_hosts)$/.test(normalized) ||
      /\.(pem|p12|pfx|key)$/i.test(normalized);
  }

  _validateArduinoSafetyAction(action) {
    if (!this._isArduinoSafetyModeEnabled() || !action) {
      return { allowed: true };
    }

    if (action.type === "cmd") {
      const command = String(action.command || "").trim();
      const validation = this.agent.validateCommand(command);
      if (!validation.allowed) {
        return {
          allowed: false,
          reason: validation.reason || "Blocked unsafe command"
        };
      }
      return { allowed: true };
    }

    if (action.type === "file" || action.type === "patch" || action.type === "mkdir") {
      if (this._isBlockedArduinoPath(action.path)) {
        return {
          allowed: false,
          reason: `Arduino Safety Mode blocked a sensitive/generated path: ${action.path}`
        };
      }
    }

    return { allowed: true };
  }

  _detectEspFamilyFromHealth(health, facts = {}) {
    const raw = [
      health?.boardName,
      health?.boardInfo,
      health?.board?.fqbn,
      health?.board?.FQBN,
      health?.board?.name,
      health?.board?.id,
      ...(facts.includes || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (/\besp32\b|arduino:esp32|espressif:esp32/.test(raw)) return "esp32";
    if (/\besp8266\b|arduino:esp8266|esp8266:esp8266/.test(raw)) return "esp8266";
    return "";
  }

  _resolveEspPinToken(token, constants) {
    const raw = String(token || "").trim().replace(/[()]/g, "");
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Number(raw);
    if (constants && constants.has(raw)) return constants.get(raw);
    const dMatch = raw.match(/^D(\d+)$/i);
    if (dMatch) {
      const map = new Map([
        [0, 16],
        [1, 5],
        [2, 4],
        [3, 0],
        [4, 2],
        [5, 14],
        [6, 12],
        [7, 13],
        [8, 15]
      ]);
      return map.get(Number(dMatch[1])) ?? null;
    }
    return null;
  }

  _collectEspPinUses(content, constants) {
    const uses = [];
    const addUse = (kind, token, mode = "") => {
      const pin = this._resolveEspPinToken(token, constants);
      if (pin === null || Number.isNaN(pin)) return;
      uses.push({
        kind,
        token: String(token || "").trim(),
        pin,
        mode
      });
    };

    let match;
    const pinModeRegex = /\bpinMode\s*\(\s*([^,\)]+)\s*,\s*([A-Z0-9_]+)\s*\)/g;
    while ((match = pinModeRegex.exec(content))) {
      addUse("pinMode", match[1], match[2]);
    }

    const writeRegex = /\b(?:digitalWrite|analogWrite|ledcAttachPin)\s*\(\s*([^,\)]+)/g;
    while ((match = writeRegex.exec(content))) {
      addUse("write", match[1], "OUTPUT");
    }

    const readRegex = /\banalogRead\s*\(\s*([^,\)]+)/g;
    while ((match = readRegex.exec(content))) {
      addUse("analogRead", match[1], "INPUT");
    }

    return uses;
  }

  async _collectEspSketchFacts(projectRoot) {
    const files = await this._walkArduinoSourceFiles(projectRoot);
    const constants = new Map();
    const includes = new Set();
    const serialBauds = new Set();
    const pinUses = [];
    const hardcodedSecrets = [];
    const featureFlags = new Set();

    for (const file of files.slice(0, 80)) {
      let content = "";
      try {
        content = await fs.promises.readFile(file, "utf8");
      } catch (_) {
        continue;
      }

      const rel = path.relative(projectRoot, file).replace(/\\/g, "/");
      let match;

      const defineRegex = /^\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(\d+)\b/gm;
      while ((match = defineRegex.exec(content))) {
        constants.set(match[1], Number(match[2]));
      }

      const constRegex = /\b(?:const\s+)?(?:int|byte|uint8_t|uint16_t|gpio_num_t)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)\s*;/g;
      while ((match = constRegex.exec(content))) {
        constants.set(match[1], Number(match[2]));
      }

      const includeRegex = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm;
      while ((match = includeRegex.exec(content))) {
        includes.add(match[1]);
      }

      const baudRegex = /\bSerial(?:\d)?\.begin\s*\(\s*(\d+)/g;
      while ((match = baudRegex.exec(content))) {
        serialBauds.add(match[1]);
      }

      if (/\bWiFi\./.test(content) || /#\s*include\s*[<"](?:WiFi|ESP8266WiFi)\.h[>"]/.test(content)) {
        featureFlags.add("WiFi");
      }
      if (/BluetoothSerial|BLEDevice|NimBLEDevice/.test(content)) {
        featureFlags.add("Bluetooth/BLE");
      }
      if (/WebServer|ESP8266WebServer|AsyncWebServer/.test(content)) {
        featureFlags.add("Web server");
      }
      if (/ArduinoOTA|ElegantOTA|HTTPUpdate|Update\.h/.test(content)) {
        featureFlags.add("OTA/update");
      }
      if (/PubSubClient|MQTTClient|AsyncMqttClient/.test(content)) {
        featureFlags.add("MQTT");
      }

      if (/\b(?:ssid|password|wifi_pass|wifi_password)\b\s*(?:\[\])?\s*=\s*["'][^"']{3,}["']/i.test(content)) {
        hardcodedSecrets.push(rel);
      }

      for (const use of this._collectEspPinUses(content, constants)) {
        pinUses.push({ ...use, file: rel });
      }
    }

    return {
      files: files.map((file) => path.relative(projectRoot, file).replace(/\\/g, "/")),
      includes: Array.from(includes).sort(),
      serialBauds: Array.from(serialBauds).sort(),
      pinUses,
      hardcodedSecrets: Array.from(new Set(hardcodedSecrets)),
      featureFlags: Array.from(featureFlags).sort()
    };
  }

  _buildEspPinWarnings(family, facts) {
    const warnings = [];
    const pins = facts.pinUses || [];
    const uniqueByPin = new Map();
    for (const use of pins) {
      if (!uniqueByPin.has(use.pin)) uniqueByPin.set(use.pin, []);
      uniqueByPin.get(use.pin).push(use);
    }

    const describeUses = (uses) =>
      uses
        .slice(0, 3)
        .map((use) => `${use.file} ${use.kind}(${use.token}${use.mode ? `, ${use.mode}` : ""})`)
        .join("; ");

    if (family === "esp32") {
      for (const pin of [6, 7, 8, 9, 10, 11]) {
        if (uniqueByPin.has(pin)) {
          warnings.push(`GPIO${pin}: usually connected to flash on ESP32; avoid using it. ${describeUses(uniqueByPin.get(pin))}`);
        }
      }
      for (const pin of [34, 35, 36, 39]) {
        const outputUses = (uniqueByPin.get(pin) || []).filter((use) =>
          /OUTPUT/i.test(use.mode || "") || use.kind === "write"
        );
        if (outputUses.length) {
          warnings.push(`GPIO${pin}: input-only on ESP32, but used as output/write. ${describeUses(outputUses)}`);
        }
      }
      for (const pin of [0, 2, 4, 5, 12, 15]) {
        if (uniqueByPin.has(pin)) {
          warnings.push(`GPIO${pin}: ESP32 strapping/boot-sensitive pin; verify external pullups/pulldowns. ${describeUses(uniqueByPin.get(pin))}`);
        }
      }
      if ((facts.featureFlags || []).includes("WiFi")) {
        for (const pin of [0, 2, 4, 12, 13, 14, 15, 25, 26, 27]) {
          const adcUses = (uniqueByPin.get(pin) || []).filter((use) => use.kind === "analogRead");
          if (adcUses.length) {
            warnings.push(`GPIO${pin}: ADC2 reads can conflict with WiFi on many ESP32 boards. ${describeUses(adcUses)}`);
          }
        }
      }
    } else if (family === "esp8266") {
      for (const pin of [6, 7, 8, 9, 10, 11]) {
        if (uniqueByPin.has(pin)) {
          warnings.push(`GPIO${pin}: connected to flash on ESP8266; avoid using it. ${describeUses(uniqueByPin.get(pin))}`);
        }
      }
      for (const pin of [0, 2, 15]) {
        if (uniqueByPin.has(pin)) {
          warnings.push(`GPIO${pin}: ESP8266 boot strap pin; wiring can prevent boot/upload. ${describeUses(uniqueByPin.get(pin))}`);
        }
      }
      for (const pin of [1, 3]) {
        if (uniqueByPin.has(pin)) {
          warnings.push(`GPIO${pin}: shared with Serial TX/RX on ESP8266. ${describeUses(uniqueByPin.get(pin))}`);
        }
      }
    }

    return warnings;
  }

  _buildEspDoctorReport(health, facts) {
    const family = this._detectEspFamilyFromHealth(health, facts);
    const lines = ["ESP Board Doctor"];
    lines.push("");
    lines.push(`Project: ${health.projectRoot || "No project root"}`);
    lines.push(`Board: ${health.boardInfo || "Not detected"}`);
    lines.push(`ESP family: ${family ? family.toUpperCase() : "Not detected"}`);
    lines.push(`Port: ${health.portName || "Not detected"}`);

    if (!health.commandExecuted) {
      lines.push("Verify command: not available; using current diagnostics.");
    } else {
      lines.push(`Verify command: ${health.executedCommand}`);
    }

    lines.push("");
    lines.push("Sketch signals:");
    lines.push(`- Source files: ${facts.files.length}`);
    lines.push(`- Includes: ${facts.includes.length ? facts.includes.slice(0, 12).join(", ") : "none found"}`);
    lines.push(`- Serial baud: ${facts.serialBauds.length ? facts.serialBauds.join(", ") : "not found"}`);
    lines.push(`- Features: ${facts.featureFlags.length ? facts.featureFlags.join(", ") : "none detected"}`);

    const warnings = [];
    if (!family) {
      if (facts.includes.some((header) => /^(WiFi|ESP8266WiFi|BluetoothSerial|BLEDevice|AsyncTCP|ESPAsyncTCP)\.h$/i.test(header))) {
        warnings.push("Sketch looks ESP-related, but the selected board is not clearly ESP32/ESP8266.");
      } else {
        warnings.push("Selected board does not look like ESP32/ESP8266. Choose an ESP board before using ESP-specific checks.");
      }
    }
    if (!health.port) {
      warnings.push("No serial port detected. Select the ESP port before upload/monitor.");
    }
    if (!facts.serialBauds.length) {
      warnings.push("No Serial.begin(...) baud rate found; serial monitor settings may be unclear.");
    }
    if (facts.hardcodedSecrets.length) {
      warnings.push(`Hardcoded WiFi credentials may be present in: ${facts.hardcodedSecrets.join(", ")}. Consider secrets.h placeholders.`);
    }
    warnings.push(...this._buildEspPinWarnings(family, facts));

    lines.push("");
    lines.push("ESP checks:");
    if (warnings.length) {
      for (const warning of warnings) {
        lines.push(`- WARN: ${warning}`);
      }
    } else {
      lines.push("- No ESP-specific pin or configuration warnings found.");
    }

    lines.push("");
    if (health.issues.length) {
      lines.push(`Compile diagnostics: ${health.issues.length} issue(s)`);
      for (const issue of health.issues) {
        lines.push(`- ${this._formatArduinoIssue(issue)}`);
      }
    } else {
      lines.push("Compile diagnostics: clean");
    }

    lines.push("");
    lines.push("Safe next steps:");
    lines.push("- Use Check Syntax before wiring or uploading.");
    lines.push("- Use Fix Compile Error for targeted code fixes.");
    lines.push("- Upload/serial monitor actions remain manual and require explicit user control.");

    return lines.join("\n");
  }

  async _runEspBoardDoctor(workspaceFolder) {
    this._postMessage({ type: "thinking" });
    this._postMessage({
      type: "status",
      text: "Running ESP Board Doctor..."
    });

    const health = await this._collectArduinoHealth(workspaceFolder, null, "ESP Doctor");
    if (health.error) {
      this._postMessage({ type: "error", text: health.error });
      this._postMessage({ type: "done" });
      return;
    }

    await this._promptForBoardSelectionIfMissing(health);
    const facts = await this._collectEspSketchFacts(health.projectRoot || workspaceFolder);
    this._postMessage({
      type: "stream",
      text: this._buildEspDoctorReport(health, facts)
    });
    this._postMessage({ type: "done" });
  }

  async _runSyntaxScan(workspaceFolder, specificFiles) {
    this._postMessage({ type: "thinking" });
    this._postMessage({
      type: "status",
      text: "Checking Arduino project health..."
    });

    const health = await this._collectArduinoHealth(workspaceFolder, specificFiles);
    if (health.error) {
      this._postMessage({ type: "error", text: health.error });
      this._postMessage({ type: "done" });
      return;
    }

    await this._promptForBoardSelectionIfMissing(health);
    this._postMessage({
      type: "stream",
      text: this._buildArduinoHealthReport(health, true)
    });
    this._postMessage({ type: "done" });
  }

  async _applyCompileFixActions(actions, workspaceFolder, allowedFiles) {
    const allowed = new Set(
      Array.from(allowedFiles || []).map((file) => file.replace(/\\/g, "/"))
    );
    let appliedCount = 0;

    for (const action of actions || []) {
      if (!action || (action.type !== "patch" && action.type !== "file")) {
        continue;
      }

      const actionPath = String(action.path || "").replace(/\\/g, "/");
      if (!allowed.has(actionPath)) {
        this._postMessage({
          type: "status",
          text: `Skipped edit outside compile-error files: ${actionPath}`
        });
        continue;
      }

      if (action.type === "patch") {
        const fullPath = this._resolveActionFilePath(workspaceFolder, actionPath);
        let currentContent = "";
        try {
          currentContent = await fs.promises.readFile(fullPath, "utf8");
        } catch (_) {
          this._postMessage({
            type: "error",
            text: `Cannot patch ${actionPath}: file not found or unreadable.`
          });
          continue;
        }

        const patchResult = this._buildPatchedContent(
          currentContent,
          action.search,
          action.replace
        );
        if (!patchResult.matched) {
          this._postMessage({
            type: "error",
            text:
              patchResult.reason === "ambiguous_search"
                ? `Cannot patch ${actionPath}: SEARCH matched multiple locations.`
                : `Cannot patch ${actionPath}: SEARCH content was not found.`
          });
          continue;
        }

        const result = await this.agent.applyChanges(
          actionPath,
          patchResult.content,
          false,
          {}
        );
        const undoId = result.success
          ? this._registerEditForUndo({
              filePath: result.path || actionPath,
              before: result.previousContent,
              after: result.newContent,
              label: "compile fix"
            })
          : null;
        this._postMessage({
          type: result.success ? "applied" : "error",
          filePath: result.success ? result.path : undefined,
          undoId,
          text: result.success
            ? `Patched ${result.relativePath || actionPath}\n${result.changeSummary || ""}`
            : result.error
        });
        if (result.success) {
          appliedCount += 1;
          await this._revealWorkspaceFile(result.path);
        }
        continue;
      }

      const result = await this.agent.applyChanges(
        actionPath,
        action.content,
        false,
        {}
      );
      const undoId =
        result.success && !result.created
          ? this._registerEditForUndo({
              filePath: result.path || actionPath,
              before: result.previousContent,
              after: result.newContent,
              label: "compile fix"
            })
          : null;
      this._postMessage({
        type: result.success ? "applied" : "error",
        filePath: result.success ? result.path : undefined,
        undoId,
        text: result.success
          ? `Updated ${result.relativePath || actionPath}\n${result.changeSummary || ""}`
          : result.error
      });
      if (result.success) {
        appliedCount += 1;
        await this._revealWorkspaceFile(result.path);
      }
    }

    return appliedCount;
  }

  async _runFixCompileErrors(workspaceFolder, specificFiles) {
    this._postMessage({ type: "thinking" });
    this._postMessage({
      type: "status",
      text: "Running Arduino verify before fixing compile errors..."
    });

    const health = await this._collectArduinoHealth(
      workspaceFolder,
      specificFiles,
      "Compile fix"
    );
    if (health.error) {
      this._postMessage({ type: "error", text: health.error });
      this._postMessage({ type: "done" });
      return;
    }

    await this._promptForBoardSelectionIfMissing(health);
    this._postMessage({
      type: "stream",
      text: this._buildArduinoHealthReport(health, false)
    });

    if (!health.issues.length) {
      this._postMessage({ type: "done" });
      return;
    }

    const grouped = this._groupArduinoIssuesByFile(health.issues);
    const editableFiles = new Set(
      Array.from(grouped.entries())
        .filter(([, issues]) => !issues.some((issue) => issue.isLibraryError))
        .map(([file]) => file)
    );
    const libraryFiles = Array.from(grouped.entries())
      .filter(([, issues]) => issues.some((issue) => issue.isLibraryError))
      .map(([file]) => file);

    if (libraryFiles.length > 0) {
      this._postMessage({
        type: "stream",
        text:
          "\n\nMissing library diagnostics were not edited automatically. Run Check Libraries for install suggestions:\n" +
          libraryFiles.map((file) => `- ${file}`).join("\n")
      });
    }

    if (editableFiles.size === 0) {
      this._postMessage({ type: "done" });
      return;
    }

    const diagnosticsText = Array.from(editableFiles)
      .map((file) => {
        const issues = grouped.get(file) || [];
        return [
          `File: ${file}`,
          ...issues.map((issue) => `- ${this._formatArduinoIssue(issue)}`)
        ].join("\n");
      })
      .join("\n\n");

    const fixPrompt = `Fix these Arduino compile diagnostics with the smallest safe edits.

Diagnostics:
${diagnosticsText}

Rules:
- Prefer PATCH actions over full FILE rewrites.
- Only edit these files: ${Array.from(editableFiles).join(", ")}.
- Do not output CMD, MKDIR, library install commands, or unrelated refactors.
- Preserve the existing sketch behavior unless a diagnostic requires a change.`;

    const response = await this.agent.chat(
      fixPrompt,
      health.projectRoot || workspaceFolder,
      null,
      null,
      {
        mode: "fast",
        onStatus: (text) => {
          this._postMessage({ type: "status", text: `Compile fix: ${text}` });
        }
      }
    );

    if (response.error) {
      this._postMessage({ type: "error", text: response.error });
      this._postMessage({ type: "done" });
      return;
    }

    const appliedCount = await this._applyCompileFixActions(
      response.actions || [],
      health.projectRoot || workspaceFolder,
      editableFiles
    );

    if (appliedCount === 0) {
      this._postMessage({
        type: "status",
        text: "No compile fix edits were applied."
      });
      this._postMessage({ type: "done" });
      return;
    }

    this._postMessage({
      type: "status",
      text: "Re-running Arduino verify after compile fix..."
    });
    const afterHealth = await this._collectArduinoHealth(
      health.projectRoot || workspaceFolder,
      specificFiles,
      "Post-fix verify"
    );
    this._postMessage({
      type: "stream",
      text: `\n\nPost-fix result:\n${this._buildArduinoHealthReport(afterHealth, false)}`
    });
    this._postMessage({ type: "done" });
  }

  _isLibraryAuditRequest(message) {
    const text = message || "";
    return (
      /\b(check|scan|find|compare|audit|verify)\b.*\b(librar(?:y|ies)|#include|import(?:ed|s)?)\b/i.test(text) &&
      /\b(installed|missing|not installed|install|imported|included)\b/i.test(text)
    ) || /\bwhich libraries are installed\b/i.test(text);
  }

  _extractIncludeHeaders(content) {
    const headers = new Set();
    const includeRegex = /^\s*#include\s*[<"]([^">]+)[">]/gm;
    let match;
    while ((match = includeRegex.exec(content || "")) !== null) {
      const header = (match[1] || "").trim();
      if (header) headers.add(header);
    }
    return Array.from(headers);
  }

  _normalizeLibraryToken(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  _isCoreOrSystemHeader(header) {
    const normalized = String(header || "").trim().toLowerCase();
    const base = path.basename(normalized).replace(/\.(h|hpp)$/i, "");
    const coreHeaders = new Set([
      "arduino",
      "binary",
      "ctype",
      "errno",
      "float",
      "limits",
      "math",
      "new",
      "pgmspace",
      "pins_arduino",
      "stdbool",
      "stdint",
      "stdio",
      "stdlib",
      "stream",
      "string",
      "time",
      "utility",
      "vector",
      "wiring_private"
    ]);
    return (
      coreHeaders.has(base) ||
      normalized.startsWith("avr/") ||
      normalized.startsWith("sys/") ||
      normalized.startsWith("bits/")
    );
  }

  async _collectArduinoImports(workspaceFolder) {
    const projectRoot = this._resolveArduinoProjectRoot(workspaceFolder);
    if (!projectRoot) {
      return new Map();
    }

    const files = await this._walkArduinoSourceFiles(projectRoot);
    const imports = new Map();
    for (const filePath of files) {
      const relativePath = path
        .relative(projectRoot, filePath)
        .replace(/\\/g, "/");
      try {
        const content = await fs.promises.readFile(filePath, "utf8");
        imports.set(relativePath, this._extractIncludeHeaders(content));
      } catch (_) {
        // Ignore unreadable files; audit should continue.
      }
    }
    return imports;
  }

  _parseInstalledLibraries(listOutput) {
    const names = new Set();
    const raw = (listOutput || "").trim();
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      const queue = Array.isArray(parsed) ? parsed.slice() : [parsed];
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;
        if (Array.isArray(item)) {
          queue.push(...item);
          continue;
        }
        if (typeof item === "object") {
          const candidateName =
            item.name ||
            item.library?.name ||
            item.Library?.Name ||
            item.Name;
          if (candidateName && typeof candidateName === "string") {
            names.add(candidateName.trim());
          }
          for (const value of Object.values(item)) {
            if (value && typeof value === "object") queue.push(value);
          }
        }
      }
    } catch (_) {
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || /^name\s+/i.test(trimmed) || /^[-=]{3,}/.test(trimmed)) continue;
        const columnSplit = trimmed.split(/\s{2,}/);
        const candidate = columnSplit[0]?.trim();
        if (candidate && !/^library$/i.test(candidate)) {
          names.add(candidate);
        }
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  _getArduinoCliCandidates() {
    const candidates = ["arduino-cli", "arduino-cli.exe"];
    const localAppData =
      process.env.LOCALAPPDATA ||
      path.join(process.env.USERPROFILE || "", "AppData", "Local");
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 =
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    const roots = [
      path.join(localAppData, "Programs", "Arduino IDE"),
      path.join(programFiles, "Arduino IDE"),
      path.join(programFilesX86, "Arduino IDE")
    ];

    const execDir = path.dirname(process.execPath || "");
    if (execDir) {
      roots.push(
        execDir,
        path.resolve(execDir, ".."),
        path.resolve(execDir, "..", "..")
      );
    }

    const pathEntries = String(process.env.PATH || "")
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const entry of pathEntries) {
      candidates.push(
        path.join(entry, "arduino-cli.exe"),
        path.join(entry, "arduino-cli.cmd"),
        path.join(entry, "arduino-cli.bat")
      );
    }

    const suffixes = [
      "arduino-cli.exe",
      path.join(
        "resources",
        "app",
        "node_modules",
        "arduino-ide-extension",
        "build",
        "arduino-cli.exe"
      ),
      path.join("resources", "app", "lib", "backend", "resources", "arduino-cli.exe"),
      path.join("resources", "arduino-cli.exe"),
      path.join("lib", "backend", "resources", "arduino-cli.exe")
    ];

    for (const root of roots) {
      for (const suffix of suffixes) {
        const fullPath = path.join(root, suffix);
        if (fs.existsSync(fullPath)) {
          candidates.push(fullPath);
        }
      }
    }

    return Array.from(new Set(candidates)).filter((candidate) => {
      if (/^arduino-cli(\.exe)?$/i.test(candidate)) {
        return true;
      }
      return fs.existsSync(candidate);
    });
  }

  async _runArduinoCli(args, workspaceFolder) {
    const { execFile } = require("child_process");
    const cliCandidates = this._getArduinoCliCandidates();
    let lastError = "";

    for (const cliPath of cliCandidates) {
      const result = await new Promise((resolve) => {
        execFile(
          cliPath,
          args,
          {
            cwd: workspaceFolder,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024
          },
          (error, stdout, stderr) => {
            const output = [stdout, stderr].filter(Boolean).join("\n").trim();
            if (error) {
              resolve({
                success: false,
                error: error.message,
                output
              });
              return;
            }
            resolve({
              success: true,
              output
            });
          }
        );
      });

      if (result.success) {
        return {
          ...result,
          commandPath: cliPath
        };
      }

      lastError = result.error || result.output || lastError;
      if (
        /not recognized|ENOENT|cannot find the file|spawn .*UNKNOWN/i.test(
          `${result.error || ""}\n${result.output || ""}`
        )
      ) {
        continue;
      }

      return {
        ...result,
        commandPath: cliPath
      };
    }

    return {
      success: false,
      error:
        lastError ||
        `Arduino CLI was not found. Tried: ${cliCandidates.join(", ")}`
    };
  }

  async _searchArduinoLibraryCandidates(workspaceFolder, term) {
    const safeTerm = String(term || "").replace(/"/g, "").trim();
    if (!safeTerm) return [];

    const result = await this._runArduinoCli(
      ["lib", "search", safeTerm, "--format", "json"],
      workspaceFolder
    );
    if (!result.success) return [];

    try {
      const parsed = JSON.parse(result.output || "{}");
      const items = Array.isArray(parsed?.libraries)
        ? parsed.libraries
        : Array.isArray(parsed)
          ? parsed
          : [];
      return items
        .map((entry) => entry?.name || entry?.library?.name || entry?.Name)
        .filter((name) => typeof name === "string" && name.trim().length > 0)
        .slice(0, 3);
    } catch (_) {
      return [];
    }
  }

  _looksLikeConfidentLibraryMatch(header, candidateName) {
    const baseName = path.basename(String(header || "")).replace(/\.(h|hpp)$/i, "");
    const headerToken = this._normalizeLibraryToken(baseName);
    const candidateToken = this._normalizeLibraryToken(candidateName || "");
    if (!headerToken || !candidateToken) return false;
    return (
      candidateToken.includes(headerToken) ||
      headerToken.includes(candidateToken)
    );
  }

  async _fetchInternetLibraryGuidance(libraryOrHeader) {
    if (typeof fetch !== "function") return null;
    const baseName = path.basename(String(libraryOrHeader || "")).replace(/\.(h|hpp)$/i, "");
    if (!baseName) return null;

    const query = `Arduino IDE 2 install library ${baseName}`;
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    try {
      const timeoutSignal =
        typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(12000)
          : undefined;
      const response = await fetch(url, {
        headers: { "User-Agent": "Code-Janitor-Arduino/1.0" },
        signal: timeoutSignal
      });
      if (!response.ok) return null;

      const data = await response.json();
      const summary = (data?.AbstractText || "").trim();
      const sourceUrl = (data?.AbstractURL || "").trim();

      const related = [];
      const collectRelated = (items) => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (!item) continue;
          if (Array.isArray(item.Topics)) {
            collectRelated(item.Topics);
            continue;
          }
          const text = (item.Text || "").trim();
          const link = (item.FirstURL || "").trim();
          if (text && link) related.push({ text, link });
          if (related.length >= 3) return;
        }
      };
      collectRelated(data?.RelatedTopics);

      if (!summary && !sourceUrl && related.length === 0) {
        return null;
      }

      return { summary, sourceUrl, related };
    } catch (_) {
      return null;
    }
  }

  async _runArduinoLibraryAudit(workspaceFolder) {
    const projectRoot = this._resolveArduinoProjectRoot(workspaceFolder);
    if (!projectRoot) {
      this._postMessage({
        type: "error",
        text: "Open an Arduino sketch first so I can inspect imports and installed libraries."
      });
      this._postMessage({ type: "done" });
      return;
    }

    this._postMessage({ type: "thinking" });
    this._postMessage({
      type: "status",
      text: "Auditing Arduino libraries (imports vs installed)..."
    });

    const importMap = await this._collectArduinoImports(projectRoot);
    const importedHeaders = new Set();
    for (const headers of importMap.values()) {
      for (const header of headers) {
        importedHeaders.add(header);
      }
    }

    if (importedHeaders.size === 0) {
      this._postMessage({
        type: "stream",
        text: "No `#include` imports were found in Arduino source files."
      });
      this._postMessage({ type: "done" });
      return;
    }

    const installedResult = await this._runArduinoCli(
      ["lib", "list", "--format", "json"],
      projectRoot
    );
    if (!installedResult.success) {
      this._postMessage({
        type: "error",
        text:
          `Could not list installed Arduino libraries. ${installedResult.error || "Run Arduino CLI manually."}\n` +
          "Tip: In Arduino IDE you can still use Sketch > Include Library > Manage Libraries..."
      });
      this._postMessage({ type: "done" });
      return;
    }

    this._postMessage({
      type: "status",
      text: `Using Arduino CLI: ${installedResult.commandPath || "arduino-cli"}`
    });

    const installedLibraries = this._parseInstalledLibraries(installedResult.output);
    const installedTokens = new Set(
      installedLibraries.map((name) => this._normalizeLibraryToken(name)).filter(Boolean)
    );

    const matched = [];
    const missing = [];
    const ignoredCore = [];

    for (const header of Array.from(importedHeaders).sort((a, b) => a.localeCompare(b))) {
      if (this._isCoreOrSystemHeader(header)) {
        ignoredCore.push(header);
        continue;
      }

      const baseName = path.basename(header).replace(/\.(h|hpp)$/i, "");
      const token = this._normalizeLibraryToken(baseName);
      const isInstalled = Array.from(installedTokens).some((installedToken) =>
        installedToken.includes(token) || token.includes(installedToken)
      );

      if (isInstalled) {
        matched.push(header);
      } else {
        missing.push(header);
      }
    }

    let report = `📚 Arduino Library Audit\n\n`;
    report += `Imported headers: ${importedHeaders.size}\n`;
    report += `Installed libraries detected: ${installedLibraries.length}\n`;
    report += `Matched imports: ${matched.length}\n`;
    report += `Missing imports: ${missing.length}\n`;

    if (matched.length > 0) {
      report += `\n✅ Matched imports:\n`;
      for (const header of matched.slice(0, 10)) {
        report += `- ${header}\n`;
      }
    }

    if (ignoredCore.length > 0) {
      report += `\nℹ️ Ignored core/system headers:\n`;
      for (const header of ignoredCore.slice(0, 8)) {
        report += `- ${header}\n`;
      }
    }

    if (missing.length === 0) {
      report += `\n✅ No missing libraries detected from your imports.\n`;
      this._postMessage({ type: "stream", text: report });
      this._postMessage({ type: "done" });
      return;
    }

    report += `\n❌ Missing library candidates:\n`;
    this._postMessage({
      type: "status",
      text: "Checking internet guidance for uncertain library matches..."
    });
    for (const header of missing) {
      const baseName = path.basename(header).replace(/\.(h|hpp)$/i, "");
      const suggestions = await this._searchArduinoLibraryCandidates(projectRoot, baseName);
      const suggestedName = suggestions[0] || baseName;
      const searchQuery = encodeURIComponent(`Arduino ${baseName} library install`);
      const confident = this._looksLikeConfidentLibraryMatch(header, suggestedName);
      const webGuidance = confident
        ? null
        : await this._fetchInternetLibraryGuidance(baseName);
      report += `\nHeader: ${header}\n`;
      report += `Try install: arduino-cli lib install "${suggestedName}"\n`;
      report += `Search command: arduino-cli lib search "${baseName}"\n`;
      report += `Library Manager: Sketch > Include Library > Manage Libraries...\n`;
      report += `Web search: https://duckduckgo.com/?q=${searchQuery}\n`;
      if (!confident) {
        report += `Confidence: low (name match uncertain)\n`;
      }
      if (webGuidance?.summary) {
        report += `Internet guidance: ${webGuidance.summary}\n`;
      }
      if (webGuidance?.sourceUrl) {
        report += `Internet source: ${webGuidance.sourceUrl}\n`;
      }
      if (Array.isArray(webGuidance?.related) && webGuidance.related.length > 0) {
        report += `Related references:\n`;
        for (const item of webGuidance.related) {
          report += `- ${item.text}: ${item.link}\n`;
        }
      }
    }

    report += `\nOfficial docs:\n`;
    report += `- Arduino CLI lib install: https://arduino.github.io/arduino-cli/latest/commands/arduino-cli_lib_install/\n`;
    report += `- Arduino IDE library install guide: https://support.arduino.cc/hc/en-us/articles/5145457742236-Add-libraries-to-Arduino-IDE\n`;
    this._postMessage({ type: "stream", text: report });
    this._postMessage({ type: "done" });
  }

  _getHtmlContent(webview = null) {
    const logoPath = vscode.Uri.file(path.join(__dirname, "logo.png"));
    const logoUri = webview
      ? webview.asWebviewUri(logoPath).toString()
      : "";
    let html = fs.readFileSync(path.join(__dirname, "chat-panel.html"), "utf8");
    html = html.replace(
      "</head>",
      `<script>window.LOGO_URI = ${JSON.stringify(logoUri)};</script>\n  </head>`
    );
    return html;
  }

  _getWelcomeHtmlContent(webview = null) {
    const logoPath = vscode.Uri.file(path.join(__dirname, "logo.png"));
    const logoUri = webview
      ? webview.asWebviewUri(logoPath).toString()
      : "";
    let html = fs.readFileSync(path.join(__dirname, "welcome.html"), "utf8");
    html = html.replace(
      "</head>",
      `<script>window.LOGO_URI = ${JSON.stringify(logoUri)};</script>\n  </head>`
    );
    return html;
  }

  resolveWebviewView(webviewView) {
    this.sidebarView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(__dirname))
      ]
    };
    webviewView.webview.html = this._getWelcomeHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "welcomeDismiss") {
        await vscode.commands.executeCommand("workbench.action.closeSidebar");
      } else if (message.type === "welcomeOpenChat") {
        await this.show();
        setTimeout(() => {
          vscode.commands.executeCommand("workbench.action.closeSidebar");
        }, 0);
      }
    });

    webviewView.onDidDispose(() => {
      if (this.sidebarView === webviewView) {
        this.sidebarView = null;
      }
    });
  }

  async _focusWelcomeSidebar() {
    if (this.welcomePanel) {
      this.welcomePanel.dispose();
      this.welcomePanel = null;
    }

    await vscode.commands.executeCommand("workbench.view.extension.codeJanitorArduinoSidebar");
    await new Promise((resolve) => setTimeout(resolve, 150));

    if (this.sidebarView?.webview) {
      this.sidebarView.webview.html = this._getWelcomeHtmlContent(this.sidebarView.webview);
      if (this.sidebarView.show) {
        this.sidebarView.show(false);
      }
      return;
    }

    await vscode.commands.executeCommand("codeJanitorArduino.welcomeSidebar.focus");
  }

  async showWelcome() {
    await this._focusWelcomeSidebar();
  }

  _getApiSecretKey(provider) {
    return `codeJanitor.ai.${provider}.apiKey`;
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
      ".svg": "plaintext",
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
    try {
      await vscode.languages.setTextDocumentLanguage(
        editor.document,
        this._getLanguageIdForPath(filePath)
      );
    } catch (_) {
      // Some Arduino IDE hosts do not expose the same language IDs as VS Code.
    }
    return { success: true, path: suggested };
  }

  async _openWorkspacePreviewFile(workspaceFolder, fileName, content) {
    if (!workspaceFolder) {
      return this._openDraftFile(fileName, content);
    }

    const previewDir = path.join(workspaceFolder, ".code-janitor-previews");
    const targetPath = path.join(previewDir, fileName);
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
    await this._revealWorkspaceFile(targetPath);
    return { success: true, path: targetPath };
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
    const currentText = document.getText();

    if (currentText === content) {
      return {
        success: true,
        path: document.fileName,
        relativePath: path.basename(document.fileName),
        previousContent: currentText,
        newContent: content
      };
    }

    const diff = computeMinimalReplacement(currentText, content);
    const applied = await editor.edit((editBuilder) => {
      if (diff) {
        const range = new vscode.Range(
          document.positionAt(diff.startOffset),
          document.positionAt(diff.endOffset)
        );
        editBuilder.replace(range, diff.replacement);
      } else {
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(currentText.length)
        );
        editBuilder.replace(fullRange, content);
      }
    });

    if (!applied) {
      return { success: false, error: "Failed to update the open file." };
    }

    return {
      success: true,
      path: document.fileName,
      relativePath: path.basename(document.fileName),
      previousContent: currentText,
      newContent: content
    };
  }

  _inferCircuitFromSketch(code) {
    const text = String(code || "");
    const pins = new Map();
    const looksLikeHardwareLabel = (value) =>
      /\b(pin|led|btn|button|switch|relay|echo|trig|trigger|servo|buzzer|motor|pwm|dir|en|enable|sensor|ultra|sonar|ir|rx|tx|sda|scl|pot|temp|humid|dht|pir|motion|lcd|display|oled)\b/i.test(
        String(value || "")
      );
    const registerPin = (rawPin, labelHint, modeHint) => {
      const pin = String(rawPin || "").trim();
      if (!pin || !/^(A\d+|\d+)$/i.test(pin)) return;
      const normalizedPin = pin.toUpperCase();
      const existing = pins.get(normalizedPin) || {
        pin: normalizedPin,
        labels: new Set(),
        modes: new Set()
      };
      if (labelHint) existing.labels.add(String(labelHint).trim());
      if (modeHint) existing.modes.add(String(modeHint).trim().toUpperCase());
      pins.set(normalizedPin, existing);
    };

    const definitions = new Map();
    const definitionRegex =
      /^\s*(?:const\s+)?(?:byte|int|uint8_t|short|long|auto)\s+([A-Za-z_]\w*)\s*=\s*(A\d+|\d+)\s*;/gm;
    let match;
    while ((match = definitionRegex.exec(text)) !== null) {
      definitions.set(match[1], match[2].toUpperCase());
      if (looksLikeHardwareLabel(match[1])) {
        registerPin(match[2], match[1], null);
      }
    }

    const defineRegex = /^\s*#define\s+([A-Za-z_]\w*)\s+(A\d+|\d+)\b/gm;
    while ((match = defineRegex.exec(text)) !== null) {
      definitions.set(match[1], match[2].toUpperCase());
      if (looksLikeHardwareLabel(match[1])) {
        registerPin(match[2], match[1], null);
      }
    }

    const resolvePin = (token) => {
      const trimmed = String(token || "").trim();
      if (/^(A\d+|\d+)$/i.test(trimmed)) return trimmed.toUpperCase();
      return definitions.get(trimmed) || "";
    };

    const pinModeRegex = /pinMode\s*\(\s*([A-Za-z_]\w*|A\d+|\d+)\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)/g;
    while ((match = pinModeRegex.exec(text)) !== null) {
      const resolved = resolvePin(match[1]);
      registerPin(resolved, match[1], match[2]);
    }

    const pinUseRegex = /\b(?:digitalWrite|digitalRead|analogWrite|analogRead|tone|noTone|servo\.attach|attach)\s*\(\s*([A-Za-z_]\w*|A\d+|\d+)/g;
    while ((match = pinUseRegex.exec(text)) !== null) {
      const resolved = resolvePin(match[1]);
      registerPin(resolved, match[1], null);
    }

    const classify = (entry) => {
      const combined = Array.from(entry.labels).join(" ").toLowerCase();
      
      // More specific component detection
      if (/\bred.*led|led.*red\b/.test(combined)) return "Red LED";
      if (/\bgreen.*led|led.*green\b/.test(combined)) return "Green LED";
      if (/\bblue.*led|led.*blue\b/.test(combined)) return "Blue LED";
      if (/\byellow.*led|led.*yellow\b/.test(combined)) return "Yellow LED";
      if (/\bled\b/.test(combined)) return "LED";
      
      if (/\bpush.*button|button.*push\b/.test(combined)) return "Pushbutton";
      if (/\bbutton|switch|key\b/.test(combined)) return "Button";
      
      if (/\bbuzzer|speaker|tone\b/.test(combined)) return "Piezo Buzzer";
      if (/\bservo\b/.test(combined)) return "Servo Motor";
      if (/\brelay\b/.test(combined)) return "Relay Module";
      
      if (/\btrig|echo|ultra|sonar|hcsr04|hc-sr04\b/.test(combined)) return "Ultrasonic Sensor (HC-SR04)";
      if (/\bdht22\b/.test(combined)) return "DHT22 Temperature Sensor";
      if (/\bdht11\b/.test(combined)) return "DHT11 Temperature Sensor";
      if (/\bdht|temp|humid\b/.test(combined)) return "Temperature/Humidity Sensor";
      
      if (/\bpot|potentiometer\b/.test(combined)) return "Potentiometer";
      if (/\bldr|light.*sensor\b/.test(combined)) return "LDR (Light Sensor)";
      if (/\bpir|motion\b/.test(combined)) return "PIR Motion Sensor";
      if (/\bir.*sensor\b/.test(combined)) return "IR Sensor";
      
      if (/\blcd.*16.*2|lcd.*1602\b/.test(combined)) return "LCD 16x2 Display";
      if (/\blcd\b/.test(combined)) return "LCD Display";
      if (/\boled\b/.test(combined)) return "OLED Display";
      
      if (/\bmotor.*driver|l298n|l293d\b/.test(combined)) return "Motor Driver Module";
      if (/\bmotor\b/.test(combined)) return "DC Motor";
      
      if (/\bsda|scl|i2c\b/.test(combined)) return "I2C Device";
      if (/\brx|tx|serial\b/.test(combined)) return "Serial Device";
      
      // Fallback based on mode
      if (entry.modes.has("OUTPUT")) {
        const label = Array.from(entry.labels)[0] || "";
        return label ? `${label} (Output)` : "Output Device";
      }
      if (entry.modes.has("INPUT") || entry.modes.has("INPUT_PULLUP")) {
        const label = Array.from(entry.labels)[0] || "";
        return label ? `${label} (Input)` : "Input Device";
      }
      
      // Use the label itself if nothing matches
      const label = Array.from(entry.labels)[0];
      return label || "Component";
    };

    return Array.from(pins.values())
      .sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }))
      .map((entry) => ({
        pin: entry.pin,
        label: Array.from(entry.labels)[0] || entry.pin,
        mode: Array.from(entry.modes)[0] || "VERIFY",
        component: classify(entry)
      }));
  }

  _buildCircuitSvg(fileName, circuitEntries) {
    const entries = Array.isArray(circuitEntries) ? circuitEntries.slice(0, 10) : [];
    const width = 980;
    const headerHeight = 84;
    const rowHeight = 62;
    const height = Math.max(360, headerHeight + 120 + entries.length * rowHeight);
    const boardX = 60;
    const boardY = 110;
    const boardWidth = 250;
    const boardHeight = Math.max(180, entries.length * 28 + 70);
    const componentX = 640;

    const escapeXml = (value) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const palette = ["#ff6b35", "#2a9d8f", "#e63946", "#457b9d", "#6d597a", "#43aa8b"];
    const pins = entries
      .map((entry, index) => {
        const y = boardY + 38 + index * 28;
        return `
  <circle cx="${boardX + boardWidth}" cy="${y}" r="5" fill="#0f172a" />
  <text x="${boardX + boardWidth - 16}" y="${y + 4}" font-size="13" text-anchor="end" fill="#0f172a">${escapeXml(entry.pin)}</text>
  <line x1="${boardX + boardWidth + 6}" y1="${y}" x2="${componentX - 36}" y2="${headerHeight + 70 + index * rowHeight}" stroke="${palette[index % palette.length]}" stroke-width="3" />
  <rect x="${componentX - 20}" y="${headerHeight + 44 + index * rowHeight}" width="250" height="40" rx="10" fill="#ffffff" stroke="${palette[index % palette.length]}" stroke-width="2" />
  <text x="${componentX - 4}" y="${headerHeight + 68 + index * rowHeight}" font-size="14" font-weight="700" fill="#0f172a">${escapeXml(entry.component)}</text>
  <text x="${componentX + 122}" y="${headerHeight + 68 + index * rowHeight}" font-size="12" text-anchor="end" fill="#475569">${escapeXml(entry.label)}</text>`;
      })
      .join("\n");

    const notes = entries.length
      ? "Verify resistor values, power rails, and exact sensor module variants in the sketch before wiring."
      : "No obvious pin mappings were found automatically. Use the text tutorial and verify connections manually.";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc" />
  <rect x="28" y="24" width="${width - 56}" height="${height - 48}" rx="24" fill="url(#panel)" stroke="#cbd5e1" />
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fff7ed" />
      <stop offset="100%" stop-color="#eef6ff" />
    </linearGradient>
  </defs>
  <text x="56" y="64" font-size="28" font-weight="700" fill="#0f172a">TinkerCAD Wiring Preview</text>
  <text x="56" y="90" font-size="14" fill="#475569">${escapeXml(fileName)}</text>
  <rect x="${boardX}" y="${boardY}" width="${boardWidth}" height="${boardHeight}" rx="18" fill="#2563eb" />
  <text x="${boardX + 24}" y="${boardY + 32}" font-size="24" font-weight="700" fill="#ffffff">Arduino Uno R3</text>
  <text x="${boardX + 24}" y="${boardY + 56}" font-size="12" fill="#dbeafe">Detected signal pins from sketch</text>
${pins}
  <text x="56" y="${height - 42}" font-size="13" fill="#334155">${escapeXml(notes)}</text>
</svg>`;
  }

  _buildCircuitPreviewHtml(fileName, svgContent) {
    const escapedTitle = String(fileName || "Circuit Preview")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const embeddedSvg = String(svgContent || "").replace(
      /^\s*<\?xml[^>]*>\s*/i,
      ""
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle} Circuit Preview</title>
  <style>
    body {
      margin: 0;
      font-family: Segoe UI, Arial, sans-serif;
      background: linear-gradient(135deg, #fff7ed 0%, #eff6ff 100%);
      color: #0f172a;
    }
    .wrap {
      max-width: 1100px;
      margin: 0 auto;
      padding: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }
    p {
      margin: 0 0 16px;
      color: #475569;
    }
    .frame {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 18px;
      overflow: auto;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapedTitle} Wiring Preview</h1>
    <p>This is an auto-generated visual summary from the sketch. Verify pins and component values before building.</p>
    <div class="frame">
${embeddedSvg}
    </div>
  </div>
</body>
</html>`;
  }

  _buildCircuitMermaid(fileName, circuitEntries) {
    const entries = Array.isArray(circuitEntries) ? circuitEntries : [];
    const sanitizeId = (value) =>
      String(value || "node")
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "") || "node";
    const escapeLabel = (value) =>
      String(value || "")
        .replace(/"/g, "'")
        .replace(/\n/g, " ");

    // Get component icon/emoji
    const getComponentIcon = (component) => {
      const c = String(component || "").toLowerCase();
      if (/led/.test(c)) return "💡";
      if (/button|switch/.test(c)) return "🔘";
      if (/buzzer|speaker/.test(c)) return "🔊";
      if (/servo|motor/.test(c)) return "⚙️";
      if (/relay/.test(c)) return "🔌";
      if (/ultrasonic|sensor/.test(c)) return "📡";
      if (/temperature|humid|dht/.test(c)) return "🌡️";
      if (/potentiometer/.test(c)) return "🎚️";
      if (/motion|pir/.test(c)) return "👁️";
      if (/display|lcd|oled/.test(c)) return "📺";
      if (/light|ldr/.test(c)) return "☀️";
      return "🔧";
    };

    const lines = [
      "%%{init: {'theme':'base', 'themeVariables': { 'primaryColor':'#2563eb','primaryTextColor':'#fff','primaryBorderColor':'#1e40af','lineColor':'#64748b','secondaryColor':'#00979d','tertiaryColor':'#f59e0b'}}}%%",
      "flowchart TB",
      `  sketch[\"📄 ${escapeLabel(fileName || "Arduino Sketch")}\"]:::sketchStyle`,
      '  uno[\"🔷 Arduino Uno R3\"]:::arduinoStyle',
      '  gnd[\"⏚ GND\"]:::powerStyle',
      '  vcc[\"⚡ 5V\"]:::powerStyle'
    ];

    if (entries.length === 0) {
      lines.push('  note[\"⚠️ No hardware pins detected automatically\"]:::noteStyle');
      lines.push("  sketch --> uno");
      lines.push("  uno -.-> note");
    } else {
      lines.push("  sketch --> uno");
      
      // Group components by type for better organization
      const grouped = {};
      entries.forEach((entry) => {
        const type = entry.component.split(" ")[0]; // Get first word (LED, Button, etc.)
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(entry);
      });

      entries.forEach((entry, index) => {
        const pinId = `pin_${sanitizeId(entry.pin)}`;
        const componentId = `comp_${index}_${sanitizeId(entry.label || entry.pin)}`;
        const icon = getComponentIcon(entry.component);
        const componentLabel = `${icon} ${escapeLabel(entry.component)}`;
        const pinLabel = `Pin ${escapeLabel(entry.pin)}`;
        const varName = entry.label !== entry.pin ? `<br/><small>${escapeLabel(entry.label)}</small>` : "";
        
        // Determine wire style based on mode
        const wireStyle = entry.mode === "OUTPUT" ? "-->" : entry.mode === "INPUT" ? "-.->" : "---";
        const modeLabel = entry.mode === "OUTPUT" ? "OUTPUT" : entry.mode === "INPUT" ? "INPUT" : entry.mode === "INPUT_PULLUP" ? "INPUT_PULLUP" : "";
        
        lines.push(`  ${pinId}[\"${pinLabel}${varName}\"]:::pinStyle`);
        lines.push(`  ${componentId}[\"${componentLabel}\"]:::componentStyle`);
        lines.push(`  uno ${wireStyle}|${modeLabel}| ${pinId}`);
        lines.push(`  ${pinId} --> ${componentId}`);
        
        // Add power connections if component needs them
        if (/led|buzzer|sensor|display|motor|relay/.test(entry.component.toLowerCase())) {
          lines.push(`  gnd -.-> ${componentId}`);
          if (!/button|switch/.test(entry.component.toLowerCase())) {
            lines.push(`  vcc -.-> ${componentId}`);
          }
        }
      });
    }

    // Add styling classes
    lines.push("");
    lines.push("  classDef sketchStyle fill:#f0f9ff,stroke:#0284c7,stroke-width:3px,color:#0c4a6e");
    lines.push("  classDef arduinoStyle fill:#2563eb,stroke:#1e40af,stroke-width:4px,color:#fff,font-weight:bold");
    lines.push("  classDef pinStyle fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e3a8a");
    lines.push("  classDef componentStyle fill:#00979d,stroke:#006d75,stroke-width:3px,color:#fff,font-weight:bold");
    lines.push("  classDef powerStyle fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#78350f");
    lines.push("  classDef noteStyle fill:#fef2f2,stroke:#ef4444,stroke-width:2px,color:#7f1d1d");

    return lines.join("\n");
  }

  _buildCircuitMermaidPreviewHtml(fileName, mermaidCode) {
    const escapedTitle = String(fileName || "Circuit Preview")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const escapedCode = String(mermaidCode || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle} Circuit Diagram</title>
  <style>
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      background: linear-gradient(135deg, #fff7ed 0%, #eff6ff 100%);
      color: #0f172a;
    }
    .wrap {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }
    .panel {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 18px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }
    .head {
      padding: 18px 22px;
      border-bottom: 1px solid #e2e8f0;
      background: rgba(255,255,255,0.82);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 24px;
    }
    p {
      margin: 0;
      color: #475569;
    }
    .diagram {
      padding: 32px 24px;
      overflow: auto;
      background: #fff;
      min-height: 400px;
    }
    .source {
      padding: 18px 22px;
      border-top: 1px solid #e2e8f0;
      background: #0f172a;
      color: #e2e8f0;
      position: relative;
    }
    .copy-btn {
      position: absolute;
      top: 18px;
      right: 22px;
      padding: 6px 14px;
      background: #00979d;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    }
    .copy-btn:hover {
      background: #00b4ba;
      transform: translateY(-1px);
    }
    .copy-btn:active {
      transform: translateY(0);
    }
    pre {
      margin: 0;
      margin-top: 32px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    .fallback {
      padding: 14px 18px;
      background: #fff7ed;
      color: #9a3412;
      border: 1px solid #fdba74;
      border-radius: 12px;
      margin-bottom: 16px;
      display: none;
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: #64748b;
      font-size: 14px;
    }
  </style>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    
    mermaid.initialize({ 
      startOnLoad: false, 
      theme: "base",
      themeVariables: {
        primaryColor: '#2563eb',
        primaryTextColor: '#fff',
        primaryBorderColor: '#1e40af',
        lineColor: '#64748b',
        secondaryColor: '#00979d',
        tertiaryColor: '#f59e0b'
      },
      securityLevel: "loose",
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      }
    });
    
    window.addEventListener('DOMContentLoaded', async () => {
      try {
        const diagramDiv = document.querySelector('.diagram');
        const mermaidDiv = document.querySelector('.mermaid');
        const fallbackDiv = document.getElementById('fallback');
        const loadingDiv = document.querySelector('.loading');
        
        if (!mermaidDiv) {
          fallbackDiv.style.display = 'block';
          loadingDiv.style.display = 'none';
          return;
        }
        
        // Render the diagram
        await mermaid.run({ nodes: [mermaidDiv] });
        loadingDiv.style.display = 'none';
      } catch (error) {
        console.error('Mermaid rendering error:', error);
        document.getElementById('fallback').style.display = 'block';
        document.querySelector('.loading').style.display = 'none';
      }
    });
    
    // Copy button functionality
    window.copyMermaidCode = () => {
      const code = document.querySelector('pre').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.copy-btn');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      }).catch(err => {
        console.error('Copy failed:', err);
      });
    };
  </script>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <div class="head">
        <h1>${escapedTitle} Circuit Diagram</h1>
        <p>Auto-generated Mermaid diagram from Arduino sketch. Shows all detected components with actual names.</p>
      </div>
      <div class="diagram">
        <div class="fallback" id="fallback">⚠️ Mermaid failed to render. The source code is shown below so you can copy it.</div>
        <div class="loading">⏳ Rendering circuit diagram...</div>
        <div class="mermaid">
${mermaidCode}
        </div>
      </div>
      <div class="source">
        <button class="copy-btn" onclick="copyMermaidCode()">📋 Copy Code</button>
        <pre>${escapedCode}</pre>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  _showCircuitMermaidPreview(fileName, mermaidCode) {
    if (this.circuitPreviewPanel) {
      this.circuitPreviewPanel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.circuitPreviewPanel = vscode.window.createWebviewPanel(
        "codeJanitorArduinoCircuitPreview",
        `Circuit Preview: ${path.basename(fileName)}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      this.circuitPreviewPanel.onDidDispose(() => {
        this.circuitPreviewPanel = null;
      });
    }

    this.circuitPreviewPanel.title = `Circuit Preview: ${path.basename(fileName)}`;
    this.circuitPreviewPanel.webview.html = this._buildCircuitMermaidPreviewHtml(
      fileName,
      mermaidCode
    );
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
      if (action.type === "patch") {
        fileSummaries.push(`patch ${action.path}`);
        continue;
      }
      if (action.type !== "file" || !result?.success) continue;
      fileSummaries.push(`${result.created ? "add" : "edit"} ${action.path}`);
    }
    for (const { action } of outsideFiles) {
      if (action.type === "file") fileSummaries.push(`edit ${action.path}`);
      if (action.type === "patch") fileSummaries.push(`patch ${action.path}`);
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

  async _isGitRepository(workspaceFolder) {
    if (!workspaceFolder) return false;
    const gitDir = path.join(workspaceFolder, '.git');
    try {
      const stat = await fs.promises.stat(gitDir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  _resolveActionFilePath(workspaceFolder, filePath) {
    const targetPath = String(filePath || "").trim();
    if (!targetPath) {
      return "";
    }
    if (!workspaceFolder) {
      return path.resolve(targetPath);
    }
    return path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(workspaceFolder, targetPath);
  }

  _buildPatchedContent(currentContent, searchContent, replaceContent) {
    const source = String(currentContent || "");
    const search = String(searchContent || "");
    const replace = String(replaceContent || "");
    const countOccurrences = (haystack, needle) => {
      if (!needle) return 0;
      let count = 0;
      let index = 0;
      while ((index = haystack.indexOf(needle, index)) !== -1) {
        count += 1;
        index += Math.max(needle.length, 1);
      }
      return count;
    };

    if (!search) {
      return { matched: false, reason: "empty_search" };
    }

    // Splice without going through String.prototype.replace, which would
    // interpret $&, $1, $`, $', $$ inside the replacement when the search
    // arg is a string. Real source code can legitimately contain those
    // sequences, so we slice on the matched index instead.
    const literalSplice = (haystack, needle, repl) => {
      const idx = haystack.indexOf(needle);
      return haystack.slice(0, idx) + repl + haystack.slice(idx + needle.length);
    };

    if (source.includes(search)) {
      const exactMatchCount = countOccurrences(source, search);
      if (exactMatchCount !== 1) {
        return {
          matched: false,
          reason: "ambiguous_search",
          matchCount: exactMatchCount
        };
      }
      return {
        matched: true,
        content: literalSplice(source, search, replace)
      };
    }

    const normalizeLineEndings = (text) => text.replace(/\r\n/g, "\n");
    const currentUnix = normalizeLineEndings(source);
    const searchUnix = normalizeLineEndings(search);
    const replaceUnix = normalizeLineEndings(replace);
    const prefersCrlf = source.includes("\r\n");

    if (currentUnix.includes(searchUnix)) {
      const normalizedMatchCount = countOccurrences(currentUnix, searchUnix);
      if (normalizedMatchCount !== 1) {
        return {
          matched: false,
          reason: "ambiguous_search",
          matchCount: normalizedMatchCount
        };
      }
      let content = literalSplice(currentUnix, searchUnix, replaceUnix);
      if (prefersCrlf) {
        content = content.replace(/\n/g, "\r\n");
      }
      return { matched: true, content };
    }

    const normalizeWhitespace = (text) => text.replace(/\s+/g, " ").trim();
    const normalizedCurrent = normalizeWhitespace(source);
    const normalizedSearch = normalizeWhitespace(search);

    if (!normalizedSearch || !normalizedCurrent.includes(normalizedSearch)) {
      return { matched: false, reason: "search_not_found" };
    }

    const whitespaceAwarePattern = new RegExp(
      search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
    );
    const whitespaceAwareMatches =
      source.match(
        new RegExp(
          search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
          "g"
        )
      ) || [];
    if (whitespaceAwareMatches.length !== 1) {
      return {
        matched: false,
        reason: "ambiguous_search",
        matchCount: whitespaceAwareMatches.length
      };
    }
    const content = source.replace(whitespaceAwarePattern, () => replace);

    if (content === source) {
      return { matched: false, reason: "search_not_found" };
    }

    return { matched: true, content };
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
    return !!this.agent?._shouldTreatAsEditIntent?.(intent, message || "");
  }

  _hasExplicitCommandRequest(message) {
    return /\b(run|execute|exec|terminal|shell|command|cmd|powershell|bash|npm|npx|pnpm|yarn|node|python|pytest|jest|eslint|git|rg|ripgrep|grep|findstr|select-string|get-content|cat|ls|dir)\b/i.test(
      message || ""
    );
  }

  _isContextInspectionCommand(command) {
    const normalized = String(command || "").trim().toLowerCase();
    if (!normalized) return false;
    return /^(rg|grep|findstr|select-string|sls|get-content|gc|get-childitem|gci|get-item|gi|resolve-path|dir|ls|pwd|tree|type|cat|head|tail|find|which|where)\b/.test(
      normalized
    ) || /^(git\s+(status|diff|show|log|branch|rev-parse)\b)/.test(normalized) ||
      /^(npm(\.cmd)?\s+(list|ls|outdated|audit|explain|query|pkg|root|prefix|view)\b)/.test(normalized) ||
      /^(pnpm(\.cmd)?\s+(list|outdated|why)\b)/.test(normalized) ||
      /^(yarn(\.cmd)?\s+(list|why|info)\b)/.test(normalized);
  }

  _isVerificationCommand(command) {
    const normalized = String(command || "").trim().toLowerCase();
    if (!normalized) return false;
    return /^(npm(\.cmd)?\s+(test\b|run\s+(lint|typecheck|build|test|check|verify|validate)\b))/.test(
      normalized
    ) || /^(pnpm(\.cmd)?\s+(test\b|run\s+(lint|typecheck|build|test|check|verify|validate)\b))/.test(
      normalized
    ) || /^(yarn(\.cmd)?\s+(test\b|run\s+(lint|typecheck|build|test|check|verify|validate)\b))/.test(
      normalized
    ) || /^(node\s+--check\b|python3?\s+-m\s+(py_compile|flake8|pylint|pytest|unittest)\b|pytest\b|eslint\b|tsc\b|javac\b)/.test(
      normalized
    ) || /^(mvn\s+(clean|compile|test|package|verify)\b|gradle\s+(clean|build|test)\b|cargo\s+(build|test|check|run)\b|go\s+(build|test|run)\b|dotnet\s+(build|test|run)\b|arduino-cli\s+(compile|lib\s+list|lib\s+search|board\s+list)\b)/.test(
      normalized
    );
  }

  _shouldUseActiveFileOnlyEdit(trimmedText, intent, workspaceFolder) {
    if (this.chatMode !== "fast") return false;
    if (!workspaceFolder) return false;
    if (!this._isEditLikeIntent(intent, trimmedText)) return false;
    if (/\b(codebase|repo|repository|project|workspace|all files?|every file|entire|whole)\b/i.test(trimmedText || "")) {
      return false;
    }

    const activeEditor = this.lastActiveEditor || vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.document.uri.scheme !== "file") return false;

    const activePath = activeEditor.document.fileName || "";
    const relative = path.relative(workspaceFolder, activePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return false;

    return (
      /\b(current|open|active|this)\s+(file|tab|editor|sketch)?\b/i.test(trimmedText || "") ||
      /\b(this|it|here)\b/i.test(trimmedText || "") ||
      !/[/\\]|\.[a-z0-9]{1,5}\b/i.test(trimmedText || "")
    );
  }

  _shouldSuppressGeneratedCommand(
    isEditLikeIntent,
    hasExplicitCommandRequest,
    actions = [],
    command = ""
  ) {
    if (!isEditLikeIntent || hasExplicitCommandRequest) {
      return false;
    }

    const hasEditAction = Array.isArray(actions)
      ? actions.some(
          (action) => action && (action.type === "file" || action.type === "patch")
        )
      : false;

    if (!hasEditAction) {
      return false;
    }

    return !this._isContextInspectionCommand(command) &&
      !this._isVerificationCommand(command);
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
          this._postMessage({
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
      this._postMessage({
        type: "status",
        text: "Post-edit checks: no lint/typecheck/build/test scripts found."
      });
      return;
    }

    this._postMessage({
      type: "status",
      text: `Post-edit checks: ${commands.join(", ")}`
    });

    for (const command of commands) {
      const validation = this.agent.validateCommand(command);
      if (!validation.allowed) {
        this._postMessage({
          type: "status",
          text: `Skipped check (${command}): ${validation.reason}`
        });
        continue;
      }

      this._postMessage({
        type: "status",
        text: `Running verification: ${command}`
      });
      const result = await this.agent.executeCommand(command, workspaceFolder);
      if (result.success) {
        this._postMessage({
          type: "status",
          text: `✅ Verification passed: ${command}`
        });
      } else {
        this._postMessage({
          type: "status",
          text: `❌ Verification failed: ${command}\n${this._summarizeCommandOutput(result.error || result.output)}`
        });
        break;
      }
    }
  }

  async _fetchAndSendModels() {
    const config = this.agent.getConfig();
    const provider = config.provider;
    if (provider !== "ollama" && provider !== "nvidia") return;
    // Only needed for Ollama — other providers populate models client-side
    try {
      const models = await this.agent.getAvailableModelsForProvider(provider, {
        forceRefresh: provider === "nvidia"
      });
      if (models.length > 0) {
        this._postMessage({
          type: "setModelOptions",
          models,
          provider
        });
        this._postMessage({
          type: "status",
          text: `${provider === "nvidia" ? "NVIDIA" : "Ollama"} model discovery succeeded: found ${models.length} model(s).`
        });
        return;
      }
      this._postMessage({
        type: "status",
        text:
          provider === "nvidia"
            ? "NVIDIA model discovery failed. Showing fallback models."
            : "Ollama responded, but no local models were reported."
      });
    } catch (error) {
      this._postMessage({
        type: "status",
        text: `${provider === "nvidia" ? "NVIDIA" : "Ollama"} model discovery failed: ${error.message}`
      });
    }
    // Ollama unreachable or no models — show defaults
    this._postMessage({
      type: "setModelOptions",
      models:
        provider === "nvidia"
          ? MODELS_BY_PROVIDER.nvidia
          : ["qwen2.5-coder:1.5b", "codellama:latest", "llama3:latest"],
      provider
    });
  }

  _getDefaultModelForProvider(provider) {
    if (provider === "ollama") return "qwen2.5-coder:1.5b";
    const providerModels = MODELS_BY_PROVIDER[provider];
    return Array.isArray(providerModels) && providerModels.length > 0
      ? providerModels[0]
      : "qwen2.5-coder:1.5b";
  }

  _normalizeModelForProvider(provider, model) {
    if (provider === "nvidia") {
      return this.agent._sanitizeNvidiaModel(model);
    }

    const trimmedModel = typeof model === "string" ? model.trim() : "";
    const providerModels = MODELS_BY_PROVIDER[provider];

    if (!Array.isArray(providerModels) || providerModels.length === 0) {
      return trimmedModel || this._getDefaultModelForProvider(provider);
    }

    if (providerModels.includes(trimmedModel)) {
      return trimmedModel;
    }

    return providerModels[0];
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

  _resolvePreferredModelForProvider(provider) {
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const savedModel = this._getSavedProviderModel(provider);

    if (provider === "nvidia") {
      const configuredNvidiaModel = String(cfg.get("nvidiaModel", "") || "").trim();
      const configuredModel = String(cfg.get("model", "") || "").trim();
      return this.agent._sanitizeNvidiaModel(
        savedModel ||
          configuredNvidiaModel ||
          configuredModel ||
          this._getDefaultModelForProvider(provider)
      );
    }

    const configuredModel = String(cfg.get("model", "") || "").trim();
    return this._normalizeModelForProvider(
      provider,
      savedModel || configuredModel || this._getDefaultModelForProvider(provider)
    );
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

  _getAlternateConfigTarget(target) {
    if (!vscode.workspace.workspaceFolders?.length) {
      return null;
    }

    return target === vscode.ConfigurationTarget.Workspace
      ? vscode.ConfigurationTarget.Global
      : vscode.ConfigurationTarget.Workspace;
  }

  _getApiKeyConfigKey(provider) {
    switch (String(provider || "").toLowerCase()) {
      case "groq":        return "groqApiKey";
      case "openrouter":  return "openrouterApiKey";
      case "anthropic":   return "anthropicApiKey";
      case "nvidia":      return "nvidiaApiKey";
      default:            return null;
    }
  }

  async _persistApiKey(provider, apiKey) {
    const configKey = this._getApiKeyConfigKey(provider);
    if (!configKey) {
      console.warn(`[CodeJanitor] _persistApiKey: unknown provider "${provider}"`);
      return false;
    }
    try {
      await this._updateAiConfig(configKey, apiKey);
      // Verify the key was actually persisted
      const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
      const savedKey = cfg.get(configKey, "");
      const persisted = savedKey === apiKey;
      if (persisted) {
        this._storeApiSecretBestEffort(provider, apiKey);
      }
      return persisted;
    } catch (err) {
      console.error(`[CodeJanitor] _persistApiKey failed for ${provider}:`, err);
      return false;
    }
  }

  _storeApiSecretBestEffort(provider, apiKey) {
    if (!this.context?.secrets?.store) return;
    this.context.secrets
      .store(this._getApiSecretKey(provider), apiKey)
      .catch((err) => {
        console.warn(
          `[CodeJanitor] Secret storage failed for ${provider}; configuration value was still saved.`,
          err
        );
      });
  }

  async _restoreApiKeys() {
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    return {
      groq:        !!cfg.get("groqApiKey", ""),
      openrouter:  !!cfg.get("openrouterApiKey", ""),
      anthropic:   !!cfg.get("anthropicApiKey", ""),
      nvidia:      !!cfg.get("nvidiaApiKey", "")
    };
  }

  async _updateAiConfig(key, value) {
    try {
      const attemptUpdate = async (target) => {
        const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
        await cfg.update(key, value, target);
        await new Promise((resolve) => setTimeout(resolve, 200));

        const freshCfg = vscode.workspace.getConfiguration("codeJanitor.ai");
        const actualValue = freshCfg.get(key);
        const isSecret = /apiKey/i.test(key);
        const loggedValue = isSecret && value ? "[redacted]" : value;
        const loggedActualValue = isSecret && actualValue ? "[redacted]" : actualValue;

        console.log(
          `[CodeJanitor] Updated ${key} to ${loggedValue}, target=${target}, actual value: ${loggedActualValue}`
        );

        return { freshCfg, actualValue };
      };

      const preferredTarget = this._getConfigTargetForKey(key);
      let { freshCfg, actualValue } = await attemptUpdate(preferredTarget);

      if (actualValue !== value) {
        const alternateTarget = this._getAlternateConfigTarget(preferredTarget);
        if (alternateTarget !== null) {
          console.warn(
            `[CodeJanitor] Config update mismatch for ${key}. Retrying with target=${alternateTarget}.`
          );
          ({ freshCfg, actualValue } = await attemptUpdate(alternateTarget));
        }
      }

      if (actualValue !== value) {
        const isSecret = /apiKey/i.test(key);
        const loggedValue = isSecret && value ? "[redacted]" : value;
        const loggedActualValue = isSecret && actualValue ? "[redacted]" : actualValue;
        console.warn(`[CodeJanitor] Config update may not have persisted. Expected ${loggedValue}, got ${loggedActualValue}`);
      }

      return freshCfg;
    } catch (error) {
      console.error(`[CodeJanitor] Failed to update config ${key}:`, error);
      // Don't throw - return current config as fallback
      return vscode.workspace.getConfiguration("codeJanitor.ai");
    }
  }

  async _syncAiState(provider, model) {
    if (provider) {
      await this.context.globalState.update("codeJanitor.ai.provider", provider);
    }
    if (model) {
      await this.context.globalState.update("codeJanitor.ai.model", model);
      this._saveProviderModel(provider, model);
    }
  }

  async _buildAiDoctorReport() {
    const config = this.agent.getConfig();
    const keyPresence = await this._restoreApiKeys();
    const savedModels = {
      ollama: this._getSavedProviderModel("ollama"),
      groq: this._getSavedProviderModel("groq"),
      openrouter: this._getSavedProviderModel("openrouter"),
      anthropic: this._getSavedProviderModel("anthropic"),
      nvidia: this._getSavedProviderModel("nvidia")
    };

    let ollamaStatus = "not checked";
    if (config.provider === "ollama") {
      try {
        const res = await fetch(`${config.ollamaUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          const models = (data.models || []).map((m) => m.name).filter(Boolean);
          ollamaStatus = `reachable (${models.length} model(s))`;
        } else {
          ollamaStatus = `unreachable (HTTP ${res.status})`;
        }
      } catch (error) {
        ollamaStatus = `unreachable (${error.message})`;
      }
    }

    return [
      "AI Doctor Report",
      "",
      `Provider: ${config.provider}`,
      `Model: ${config.model}`,
      `Timeout: ${config.timeout}ms`,
      `Ollama URL: ${config.ollamaUrl}`,
      `Ollama status: ${ollamaStatus}`,
      "",
      `Saved provider state: ${this.context.globalState.get("codeJanitor.ai.provider", "(empty)") || "(empty)"}`,
      `Saved model state: ${this.context.globalState.get("codeJanitor.ai.model", "(empty)") || "(empty)"}`,
      "",
      `API keys present: groq=${keyPresence.groq}, openrouter=${keyPresence.openrouter}, anthropic=${keyPresence.anthropic}, nvidia=${keyPresence.nvidia}`,
      `Saved last models: ollama=${savedModels.ollama || "(empty)"}, groq=${savedModels.groq || "(empty)"}, openrouter=${savedModels.openrouter || "(empty)"}, anthropic=${savedModels.anthropic || "(empty)"}, nvidia=${savedModels.nvidia || "(empty)"}`
    ].join("\n");
  }

  async _resetAiRuntimeState() {
    const defaultProvider = "ollama";
    const defaultModel = "qwen2.5-coder:1.5b";

    await this._updateAiConfig("provider", defaultProvider);
    await this._updateAiConfig("model", defaultModel);
    await this._updateAiConfig("nvidiaModel", "meta/llama-3.1-8b-instruct");

    await this.context.globalState.update("codeJanitor.ai.provider", defaultProvider);
    await this.context.globalState.update("codeJanitor.ai.model", defaultModel);
    await this.context.globalState.update(this._getProviderModelStateKey("ollama"), defaultModel);
    await this.context.globalState.update(this._getProviderModelStateKey("groq"), undefined);
    await this.context.globalState.update(this._getProviderModelStateKey("openrouter"), undefined);
    await this.context.globalState.update(this._getProviderModelStateKey("anthropic"), undefined);
    await this.context.globalState.update(this._getProviderModelStateKey("nvidia"), undefined);

    this.agent.clearHistory();
    await this._fetchAndSendModels();

    return {
      provider: defaultProvider,
      model: defaultModel
    };
  }

  _setupMessageHandler() {
    this.panel.webview.onDidReceiveMessage(async (message) => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (message.type === "chat") {
        const trimmedText = (message.text || "").trim();
        const intent = this.agent._detectIntent(trimmedText);
        const isEditLikeIntent = this._isEditLikeIntent(intent, trimmedText);
        const activeFileOnlyEdit = this._shouldUseActiveFileOnlyEdit(
          trimmedText,
          intent,
          workspaceFolder
        );
        let hasExplicitCommandRequest = this._hasExplicitCommandRequest(trimmedText);
        const wantsActiveFileEdit = /\b(current|open|active)\s+(file|tab|editor)\b/i.test(trimmedText);
        const hasExplicitDestructiveWriteIntent =
          /\b(delete|remove|clear|empty|truncate|wipe|blank\s*out)\b/i.test(trimmedText);
        const writeOptions = {
          allowEmpty: hasExplicitDestructiveWriteIntent,
          allowDocTruncate: hasExplicitDestructiveWriteIntent
        };

        if (/^\/undo\b/i.test(trimmedText) || this._isUndoRequest(trimmedText)) {
          await this._undoEdit();
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/fast$/i.test(trimmedText)) {
          this.chatMode = "fast";
          this._postMessage({ type: "status", text: "Mode switched to Fast." });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/heavy$/i.test(trimmedText)) {
          this.chatMode = "heavy";
          this._postMessage({ type: "status", text: "Mode switched to Heavy." });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/deep$/i.test(trimmedText)) {
          this.chatMode = "deep";
          this._postMessage({ type: "status", text: "Mode switched to Deep." });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/think$/i.test(trimmedText)) {
          await this._setThinkingMode(!this.showThinking);
          const status = this.showThinking ? "enabled" : "disabled";
          this._postMessage({
            type: "status",
            text: `🤔 Thinking mode ${status}. The AI will ${this.showThinking ? 'show its reasoning process step-by-step' : 'respond normally without showing reasoning'}.`
          });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/scan$/i.test(trimmedText)) {
          this._postMessage({ type: "status", text: "Scanning workspace..." });
          this._postMessage({ type: "thinking" });
          const overview = await this.agent.getCodebaseOverview(workspaceFolder);
          this._postMessage({ type: "stream", text: overview });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/doctor$/i.test(trimmedText)) {
          this._postMessage({ type: "status", text: "Inspecting AI runtime state..." });
          this._postMessage({ type: "thinking" });
          const report = await this._buildAiDoctorReport();
          this._postMessage({ type: "stream", text: report });
          this._postMessage({ type: "done" });
          return;
        }
        if (/^\/resetai$/i.test(trimmedText)) {
          this._postMessage({ type: "status", text: "Resetting saved AI provider and model state..." });
          const reset = await this._resetAiRuntimeState();
          const keyPresence = await this._restoreApiKeys();
          this._postMessage({
            type: "status",
            text: `AI state reset to provider=${reset.provider}, model=${reset.model}`
          });
          this._postMessage({
            type: "providerSwitched",
            provider: reset.provider,
            model: reset.model,
            hasGroqKey: keyPresence.groq,
            hasOpenrouterKey: keyPresence.openrouter,
            hasAnthropicKey: keyPresence.anthropic,
            hasNvidiaKey: keyPresence.nvidia
          });
          this._postMessage({ type: "done" });
          return;
        }

        if (this._isLibraryAuditRequest(trimmedText)) {
          await this._runArduinoLibraryAudit(workspaceFolder);
          return;
        }

        const directStructuredResponse = this.agent._parseResponse(trimmedText);
        const hasDirectStructuredActions =
          Array.isArray(directStructuredResponse.actions) &&
          directStructuredResponse.actions.length > 0;
        if (
          hasDirectStructuredActions &&
          directStructuredResponse.actions.some((action) => action.type === "cmd")
        ) {
          hasExplicitCommandRequest = true;
        }

        let response = directStructuredResponse;
        let streamedText = "";
        if (hasDirectStructuredActions) {
          this._postMessage({
            type: "status",
            text: "Executing structured actions from chat input..."
          });
        } else {
          this.agent.setActiveEditor(this.lastActiveEditor || vscode.window.activeTextEditor);
          if (activeFileOnlyEdit) {
            this._postMessage({
              type: "status",
              text: "Fast editor mode: using active file context only."
            });
          }
          if (!activeFileOnlyEdit && workspaceFolder && (this.chatMode === "heavy" || this.chatMode === "deep" || intent === "scan")) {
            const forcePrep = intent === "scan";
            this._postMessage({ type: "status", text: "Studying workspace before responding..." });
            const prep = await this.agent.prepareWorkspaceContext(trimmedText, workspaceFolder, { force: forcePrep });
            this._postMessage({
              type: "status",
              text: prep.cacheHit
                ? `Reused cached workspace context: ${prep.indexedFiles} indexed file(s).`
                : `Studied workspace: indexed ${prep.indexedFiles} file(s).`
            });
            if (prep.activeFile) {
              this._postMessage({
                type: "status",
                text: `Active file in focus: ${prep.activeFile}`
              });
            }
            if (prep.relevantFiles.length > 0) {
              this._postMessage({
                type: "status",
                text: `Relevant files: ${prep.relevantFiles.slice(0, 5).join(", ")}${prep.relevantFiles.length > 5 ? ` +${prep.relevantFiles.length - 5} more` : ""}`
              });
            }
          }
          this._postMessage({ type: "thinking" });
          this.abortController = new AbortController();

          try {
            // Verify config before making request
            const currentConfig = this.agent.getConfig();
            console.log(`[CodeJanitor] Chat request - Provider: ${currentConfig.provider}, Model: ${currentConfig.model}`);
            console.log(`[CodeJanitor] API Keys present - Groq: ${!!currentConfig.groqApiKey}, OpenRouter: ${!!currentConfig.openrouterApiKey}, Anthropic: ${!!currentConfig.anthropicApiKey}, NVIDIA: ${!!currentConfig.nvidiaApiKey}`);
            
            // Check if provider needs API key and if it's present
            if (currentConfig.provider === "groq" && !currentConfig.groqApiKey) {
              throw new Error("Groq API key is missing. Please save your API key in the chat panel.");
            }
            if (currentConfig.provider === "openrouter" && !currentConfig.openrouterApiKey) {
              throw new Error("OpenRouter API key is missing. Please save your API key in the chat panel.");
            }
            if (currentConfig.provider === "anthropic" && !currentConfig.anthropicApiKey) {
              throw new Error("Anthropic API key is missing. Please save your API key in the chat panel.");
            }
            if (currentConfig.provider === "nvidia" && !currentConfig.nvidiaApiKey) {
              throw new Error("NVIDIA API key is missing. Please save your API key in the chat panel.");
            }
            
            response = await this.agent.chat(
              trimmedText,
              workspaceFolder,
              (chunk) => {
                streamedText += chunk || "";
                this._postMessage({ type: "stream", text: chunk });
              },
              this.abortController.signal,
              {
                mode: this.chatMode,
                activeFileOnly: activeFileOnlyEdit,
                images: Array.isArray(message.images) ? message.images : [],
                onStatus: (text) => { this._postMessage({ type: "status", text }); }
              }
            );
          } catch (err) {
            this._postMessage({ type: "error", text: `AI error: ${err.message}` });
            this._postMessage({ type: "done" });
            this._postSessionState();
            return;
          } finally {
            this.abortController = null;
          }
        }

        if (response.error) {
          this._postMessage({ type: "error", text: response.error });
          this._postMessage({ type: "done" });
          this._postSessionState();
          return;
        }

        const streamedTrimmed = (streamedText || "").trim();
        const responseTrimmed =
          typeof response.text === "string" ? response.text.trim() : "";

        if (response.manualFallback && responseTrimmed) {
          this._postMessage({
            type: "status",
            text: "Auto-apply could not be completed. Showing copy/paste fallback code."
          });
          if (responseTrimmed !== streamedTrimmed) {
            const prefix = streamedTrimmed ? "\n\nCopy/paste fallback:\n\n" : "";
            this._postMessage({
              type: "stream",
              text: `${prefix}${response.text}`
            });
          }
        } else if (!streamedTrimmed && responseTrimmed) {
          this._postMessage({ type: "stream", text: response.text });
        }

        this._postAssistantImages(response.images)
        this._postMessage({ type: "done" });
        this._postSessionState();

        if (response.warnings && response.warnings.length > 0) {
          for (const warning of response.warnings) {
            this._postMessage({ type: "status", text: warning });
          }
        }

        // Debug: show what was parsed
        if (response.actions && response.actions.length > 0) {
          const actionSummary = response.actions.map(a => {
            if (a.type === 'graphify') return 'graphify:open';
            return `${a.type}:${a.path || a.command || ''}`;
          }).join(", ");
          this._postMessage({ type: "status", text: `Parsed ${response.actions.length} action(s): ${actionSummary}` });
        }

        if (response.actions && response.actions.length > 0) {
          const hasFileAction = response.actions.some(
            (action) =>
              (action.type === "file" &&
              typeof action.content === "string" &&
              action.content.trim().length > 0) ||
              (action.type === "patch" &&
              typeof action.search === "string" &&
              typeof action.replace === "string")
          );
          if (isEditLikeIntent && !hasFileAction) {
            this._postMessage({
              type: "status",
              text: "Blocked execution: edit requests must include at least one PATCH or FILE action."
            });
            this._postMessage({
              type: "error",
              text: "No executable file edits were generated. Please retry with the target file path and expected change."
            });
            return;
          }

          if (!workspaceFolder) {
            this._postMessage({
              type: "status",
              text: "No workspace is open. Generated files will open as drafts and will not be auto-saved."
            });

            for (const action of response.actions) {
              const safety = this._validateArduinoSafetyAction(action);
              if (!safety.allowed) {
                this._postMessage({
                  type: "status",
                  text: `Arduino Safety Mode: ${safety.reason}`
                });
                continue;
              }

              if (action.type === "file") {
                const activeEditor = this.lastActiveEditor || vscode.window.activeTextEditor;
                const shouldApplyToOpenFile =
                  wantsActiveFileEdit &&
                  activeEditor &&
                  activeEditor.document.uri.scheme === "file";
                this._postMessage({
                  type: "status",
                  text: shouldApplyToOpenFile
                    ? `Editing open file: ${path.basename(activeEditor.document.fileName)}`
                    : `Opening draft: ${action.path}`
                });
                const result = shouldApplyToOpenFile
                  ? await this._applyToEditor(activeEditor, action.content)
                  : await this._openDraftFile(action.path, action.content);
                const undoId = result.success && shouldApplyToOpenFile
                  ? this._registerEditForUndo({
                      filePath: result.path || action.path,
                      before: result.previousContent,
                      after: result.newContent,
                      label: "edit"
                    })
                  : null;
                this._postMessage({
                  type: result.success ? "applied" : "error",
                  filePath: result.success ? result.path : undefined,
                  undoId,
                  text: result.success
                    ? shouldApplyToOpenFile
                      ? `\u2705 Updated open file ${result.relativePath || result.path}`
                      : `\u2705 Opened draft ${result.path}`
                    : result.error
                });
              } else if (action.type === "patch") {
                const activeEditor = this.lastActiveEditor || vscode.window.activeTextEditor;
                const activeFileName = activeEditor?.document?.fileName || "";
                const activeNormalized = activeFileName
                  .replace(/\\/g, "/")
                  .toLowerCase();
                const targetNormalized = String(action.path || "")
                  .replace(/\\/g, "/")
                  .toLowerCase();
                const targetBaseName = path.basename(targetNormalized);
                const canPatchOpenFile =
                  !!activeEditor &&
                  !!activeEditor.document &&
                  (wantsActiveFileEdit ||
                    !targetNormalized ||
                    activeNormalized === targetNormalized ||
                    activeNormalized.endsWith(`/${targetNormalized}`) ||
                    path.basename(activeNormalized) === targetBaseName);

                if (!canPatchOpenFile) {
                  this._postMessage({
                    type: "error",
                    text: `Cannot patch ${action.path}: open the target file or use a workspace so PATCH actions can be applied.`
                  });
                  continue;
                }

                const patchResult = this._buildPatchedContent(
                  activeEditor.document.getText(),
                  action.search,
                  action.replace
                );
                if (!patchResult.matched) {
                this._postMessage({
                  type: "error",
                  text:
                    patchResult.reason === "empty_search"
                      ? `Cannot patch ${action.path}: SEARCH block is empty.`
                      : patchResult.reason === "ambiguous_search"
                        ? `Cannot patch ${action.path}: SEARCH matched ${patchResult.matchCount || "multiple"} locations. Make the SEARCH block more specific so it matches exactly once.`
                      : `Cannot patch ${action.path}: SEARCH content not found in the open file.`
                });
                  continue;
                }

                this._postMessage({
                  type: "status",
                  text: `Applying patch to open file: ${path.basename(activeFileName || action.path)}`
                });
                const result = await this._applyToEditor(
                  activeEditor,
                  patchResult.content
                );
                const undoId = result.success
                  ? this._registerEditForUndo({
                      filePath: result.path || action.path,
                      before: result.previousContent,
                      after: result.newContent,
                      label: "patch"
                    })
                  : null;
                this._postMessage({
                  type: result.success ? "applied" : "error",
                  filePath: result.success ? result.path : undefined,
                  undoId,
                  text: result.success
                    ? `\u2705 Patched open file ${result.relativePath || result.path}`
                    : result.error
                });
              } else if (action.type === "mkdir") {
                this._postMessage({
                  type: "status",
                  text: `Skipped folder creation for ${action.path}. Save the draft files where you want them.`
                });
              } else if (action.type === "cmd") {
                if (isEditLikeIntent && !hasExplicitCommandRequest) {
                  this._postMessage({
                    type: "status",
                    text: `Suppressed command during edit request: ${action.command}`
                  });
                  continue;
                }
                this._postMessage({
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
              .filter((a) => (a.type === "file" || a.type === "patch") && a.path)
              .map((a) => a.path.replace(/\\/g, "/").toLowerCase())
          );
          
          console.log(`[FileActions] Processing ${response.actions.length} actions`);
          console.log(`[FileActions] Workspace: ${workspaceFolder}`);
          
          for (const action of response.actions) {
            const safety = this._validateArduinoSafetyAction(action);
            if (!safety.allowed) {
              this._postMessage({
                type: "status",
                text: `Arduino Safety Mode: ${safety.reason}`
              });
              continue;
            }

            if (action.type === "patch") {
              const fullPath = this._resolveActionFilePath(
                workspaceFolder,
                action.path
              );
              const relativePath = workspaceFolder
                ? path.relative(workspaceFolder, fullPath)
                : action.path;
              const isOutside = relativePath.startsWith("..") || path.isAbsolute(relativePath);

              if (isOutside) {
                outsideFiles.push({ action, path: fullPath });
              } else {
                insideActions.push({ action, result: null });
              }
            } else if (action.type === "file") {
              console.log(`[FileAction] FILE: ${action.path}, content length: ${action.content?.length || 0}`);
              const probe = await this.agent.applyChanges(
                action.path,
                action.content,
                false,
                writeOptions
              );
              console.log(`[FileAction] Result: success=${probe.success}, error=${probe.error}`);
              if (probe.error === "outside_workspace") {
                outsideFiles.push({ action, path: probe.path });
              } else {
                insideActions.push({ action, result: probe });
              }
            } else if (action.type === "mkdir") {
              const mkdirPath = (action.path || "").replace(/\\/g, "/").toLowerCase();
              const mkdirParent = path.dirname(mkdirPath);
              if (fileActionPaths.has(mkdirPath) || fileActionPaths.has(mkdirParent)) {
                this._postMessage({
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
              if (
                this._shouldSuppressGeneratedCommand(
                  isEditLikeIntent,
                  hasExplicitCommandRequest,
                  response.actions,
                  action.command
                )
              ) {
                this._postMessage({
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
            this._postMessage({ type: "confirmOutsideEdit", path: paths });
            allowOutside = await new Promise((resolve) => { this._confirmResolve = resolve; });
            if (allowOutside) this._outsideWorkspaceAllowed = true;
          }

          const planSummary = this._summarizePlannedActions(
            response.actions,
            insideActions,
            outsideFiles
          );
          if (planSummary) {
            this._postMessage({ type: "status", text: planSummary });
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
            if (action.type === "patch") {
              if (outside && !allowOutside) {
                this._postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
                continue;
              }

              this._postMessage({ type: "status", text: `Applying patch to: ${action.path}` });

              const fullPath = this._resolveActionFilePath(
                workspaceFolder,
                action.path
              );
              let currentContent = "";
              try {
                currentContent = await fs.promises.readFile(fullPath, "utf8");
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Cannot patch ${action.path}: file not found or unreadable`
                });
                continue;
              }

              const patchResult = this._buildPatchedContent(
                currentContent,
                action.search,
                action.replace
              );
              if (!patchResult.matched) {
                const lines = currentContent.split('\n');
                const preview = lines.slice(0, 10).join('\n');
                const searchPreview = (action.search || "").substring(0, 200);
                console.log(`[PATCH] Failed to match in ${action.path}`);
                console.log(`[PATCH] Search pattern: ${searchPreview}`);
                console.log(`[PATCH] File preview: ${preview}`);
                this._postMessage({
                  type: "error",
                  text:
                    patchResult.reason === "empty_search"
                      ? `Cannot patch ${action.path}: SEARCH block is empty.`
                      : patchResult.reason === "ambiguous_search"
                        ? `Cannot patch ${action.path}: SEARCH matched ${patchResult.matchCount || "multiple"} locations. Make the SEARCH block more specific so it matches exactly once.`
                      : `Cannot patch ${action.path}: SEARCH content not found.\n\nExpected to find:\n${searchPreview}\n\nFile preview (first 10 lines):\n${preview}\n\nThe file may have changed or the search pattern is incorrect.`
                });
                continue;
              }

              const result = await this.agent.applyChanges(
                action.path,
                patchResult.content,
                outside,
                writeOptions
              );

              const patchUndoId = result.success
                ? this._registerEditForUndo({
                    filePath: result.path || action.path,
                    before: result.previousContent,
                    after: result.newContent,
                    label: "patch"
                  })
                : null;

              this._postMessage({
                type: result.success ? "applied" : "error",
                filePath: result.success ? result.path : undefined,
                undoId: patchUndoId,
                text: result.success
                  ? `\u2705 Patched ${result.relativePath || action.path}\n${result.changeSummary || ""}`
                  : result.error
              });
              if (result.success && !outside) {
                changedFiles.push(result.relativePath || action.path);
                await this._revealWorkspaceFile(result.path);
              }
              if (result.success && result.syntaxCheckCmd) {
                const checkResult = await this.agent.executeCommand(result.syntaxCheckCmd, workspaceFolder);
                const ok = checkResult.success && !(checkResult.output || "").trim();
                this._postMessage({
                  type: "status",
                  text: ok
                    ? `\u2705 No syntax errors in ${result.relativePath}`
                    : `\u274c Syntax issues in ${result.relativePath}:\n${checkResult.error || checkResult.output || ""}`
                });
              }
            } else if (action.type === "file") {
              if (outside && !allowOutside) {
                this._postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
                continue;
              }
              console.log(`[FileAction] Applying FILE: ${action.path}, outside=${outside}`);
              let result = outside
                ? await this.agent.applyChanges(
                    action.path,
                    action.content,
                    true,
                    writeOptions
                  )
                : preResult;
              console.log(`[FileAction] Applied: success=${result.success}, path=${result.path}`);

              if (
                !result.success &&
                isEditLikeIntent &&
                this._isReadmePath(action.path) &&
                this._isDocTruncateGuardError(result.error)
              ) {
                this._postMessage({
                  type: "status",
                  text: "README guard blocked truncation. Retrying with strict full-file README rewrite..."
                });
                result = await this._retryReadmeRewrite(
                  trimmedText,
                  workspaceFolder,
                  writeOptions
                );
                if (!result.success) {
                  this._postMessage({
                    type: "error",
                    text: `README retry failed: ${result.error}`
                  });
                  stopFurtherActions = true;
                } else {
                  this._postMessage({
                    type: "status",
                    text: "README retry succeeded with a full-file rewrite."
                  });
                }
              }

              if (stopFurtherActions) {
                break;
              }
              const operation = result.created ? "Adding file" : "Editing file";
              this._postMessage({ type: "status", text: `${operation}: ${action.path}` });
              // Newly-created files cannot be undone via stack (no prior state);
              // the user can delete the file manually if needed.
              const fileUndoId = result.success && !result.created
                ? this._registerEditForUndo({
                    filePath: result.path || action.path,
                    before: result.previousContent,
                    after: result.newContent,
                    label: "edit"
                  })
                : null;
              this._postMessage({
                type: result.success ? "applied" : "error",
                filePath: result.success ? result.path : undefined,
                undoId: fileUndoId,
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
                this._postMessage({
                  type: "status",
                  text: ok
                    ? `\u2705 No syntax errors in ${result.relativePath}`
                    : `\u274c Syntax issues in ${result.relativePath}:\n${checkResult.error || checkResult.output || ""}`
                });
              }
            } else if (action.type === "mkdir") {
              if (outside && !allowOutside) {
                this._postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
                continue;
              }
              const result = outside
                ? await this.agent.createFolder(action.path, true)
                : preResult;
              this._postMessage({
                type: result.success ? "applied" : "error",
                text: result.success ? `\u2705 Created folder ${result.path || action.path}` : result.error
              });
            } else if (action.type === "graphify") {
              this._postMessage({ type: "status", text: "Opening Graphify visualization..." });
              try {
                await vscode.commands.executeCommand("codeJanitorArduino.openGraphify");
                this._postMessage({
                  type: "applied",
                  text: "\u2705 Graphify panel opened. You can now visualize the codebase structure."
                });
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to open Graphify: ${err.message}`
                });
              }
            } else if (action.type === "cmd") {
              if (isEditLikeIntent && !hasExplicitCommandRequest) {
                this._postMessage({
                  type: "status",
                  text: `Suppressed command during edit request: ${action.command}`
                });
                continue;
              }
              const validation = this.agent.validateCommand(action.command);
              if (!validation.allowed) {
                this._postMessage({ type: "status", text: `Blocked: ${validation.reason}` });
                continue;
              }
              this._postMessage({ type: "confirm", command: action.command });
              const allowed = await new Promise((resolve) => { this._confirmResolve = resolve; });
              if (!allowed) {
                this._postMessage({ type: "status", text: `Denied: ${action.command}` });
                continue;
              }
              this._postMessage({ type: "status", text: `Running: ${action.command}` });
              const result = await this.agent.executeCommand(action.command, workspaceFolder);
              const resultText = result.success
                ? (result.output || "Done.")
                : `${result.error}${result.output ? `\n${result.output}` : ""}`;
              const suffix = result.outputTruncated
                ? "\n[Command output was truncated for safety.]"
                : "";
              this._postMessage({
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

      } else if (message.type === "confirmResponse") {
        if (this._confirmResolve) {
          this._confirmResolve(message.allowed);
          this._confirmResolve = null;
        }
      } else if (message.type === "stop") {
        if (this.abortController) {
          this.abortController.abort();
          this.abortController = null;
          this._postMessage({ type: "done" });
        }
      } else if (message.type === "undoEdit") {
        await this._undoEdit(message.id);
      } else if (message.type === "apply") {
        const result = await this.agent.applyChanges(message.filePath, message.content);
        this._postMessage({
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
        this._postMessage({ type: "cleared" });
        this._postSessionState();
      } else if (message.type === "openFile") {
        await this._revealWorkspaceFile(message.path);
      } else if (message.type === "scanOverview") {
        this._postMessage({ type: "status", text: "Scanning workspace..." });
        this._postMessage({ type: "thinking" });
        const overview = await this.agent.getCodebaseOverview(workspaceFolder);
        this._postMessage({ type: "stream", text: overview });
        this._postMessage({ type: "done" });
      } else if (message.type === "syntaxScan") {
        // Triggered by action chip — run directly without model
        const projectRoot = this._resolveArduinoProjectRoot(workspaceFolder);
        const files = message.activeOnly
          ? (this.lastActiveEditor && projectRoot
              ? [
                  path
                    .relative(projectRoot, this.lastActiveEditor.document.fileName)
                    .replace(/\\/g, "/")
                ]
              : [])
          : null;
        await this._runSyntaxScan(workspaceFolder, files);
      } else if (message.type === "fixCompile") {
        const projectRoot = this._resolveArduinoProjectRoot(workspaceFolder);
        const files = message.activeOnly
          ? (this.lastActiveEditor && projectRoot
              ? [
                  path
                    .relative(projectRoot, this.lastActiveEditor.document.fileName)
                    .replace(/\\/g, "/")
                ]
              : [])
          : null;
        await this._runFixCompileErrors(workspaceFolder, files);
      } else if (message.type === "libraryAudit") {
        await this._runArduinoLibraryAudit(workspaceFolder);
      } else if (message.type === "espDoctor") {
        await this._runEspBoardDoctor(workspaceFolder);
      } else if (message.type === "refreshProviderModels" || message.type === "ready") {
        // Webview signals it's fully loaded or user switched to Ollama — send current state
        if (message.type === "ready") {
          const restoredKeys = await this._restoreApiKeys();
          const savedConfig = this.agent.getConfig();
          const normalizedModel = this._resolvePreferredModelForProvider(savedConfig.provider);
          if (normalizedModel !== savedConfig.model) {
            await this._updateAiConfig("model", normalizedModel);
            if (savedConfig.provider === "nvidia") {
              await this._updateAiConfig("nvidiaModel", normalizedModel);
            }
            await this._syncAiState(savedConfig.provider, normalizedModel);
          }
          const hasGroqKey = restoredKeys.groq;
          const hasOpenrouterKey = restoredKeys.openrouter;
          const hasAnthropicKey = restoredKeys.anthropic;
          const hasNvidiaKey = restoredKeys.nvidia;
          const hasKey = (savedConfig.provider === "groq" && hasGroqKey) ||
                         (savedConfig.provider === "openrouter" && hasOpenrouterKey) ||
                         (savedConfig.provider === "anthropic" && hasAnthropicKey) ||
                         (savedConfig.provider === "nvidia" && hasNvidiaKey);
          const models =
            hasKey && savedConfig.provider !== "ollama"
              ? (MODELS_BY_PROVIDER[savedConfig.provider] || null)
              : null;
          this._postMessage({
            type: "setCurrentProvider",
            provider: savedConfig.provider,
            model: normalizedModel,
            hasGroqKey,
            hasOpenrouterKey,
            hasAnthropicKey,
            hasNvidiaKey,
            models
          });
          this._postMessage({
            type: "thinkingState",
            enabled: this.showThinking
          });
          this._postSessionState();
        }
        this._fetchAndSendModels();
      } else if (message.type === "toggleThinking") {
        await this._setThinkingMode(!this.showThinking);
        this._postMessage({
          type: "status",
          text: `Thinking mode ${this.showThinking ? "enabled" : "disabled"}.`
        });
        this._postMessage({ type: "done" });
      } else if (message.type === "createSession") {
        this.agent.createSession();
        this._outsideWorkspaceAllowed = false;
        this._postSessionState();
      } else if (message.type === "switchSession") {
        this.agent.switchSession(message.sessionId);
        this._outsideWorkspaceAllowed = false;
        this._postSessionState();
      } else if (message.type === "deleteSession") {
        this.agent.deleteSession(message.sessionId);
        this._outsideWorkspaceAllowed = false;
        this._postSessionState();
      } else if (message.type === "mode") {
        this.chatMode =
          message.value === "deep"
            ? "deep"
            : message.value === "heavy"
              ? "heavy"
              : "fast";
      } else if (message.type === "setModel") {
        this._modelSelectionVersion += 1;
        const cfg = await this._updateAiConfig("model", message.model);
        const provider = message.provider || cfg.get("provider", "ollama");
        const resolvedModel = this._normalizeModelForProvider(provider, message.model);
        if (resolvedModel !== message.model) {
          await this._updateAiConfig("model", resolvedModel);
        }
        if (provider === "nvidia") {
          await this._updateAiConfig("nvidiaModel", resolvedModel);
        }
        await this._syncAiState(provider, resolvedModel);
        console.log(`[CodeJanitor] Model switched to: ${resolvedModel} for provider: ${provider}`);
      } else if (message.type === "setProvider") {
        try {
          const switchVersion = ++this._providerSwitchVersion;
          const modelSelectionVersion = this._modelSelectionVersion;
          console.log(`[CodeJanitor] Switching provider to: ${message.provider}`);

          // Save API key FIRST if provided (before updating provider)
          if (message.apiKey) {
            console.log(`[CodeJanitor] Saving API key for ${message.provider}`);
            const apiKeySaved = await this._persistApiKey(message.provider, message.apiKey);
            
            // Verify the key was saved
            const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
            const configKey = this._getApiKeyConfigKey(message.provider);
            const savedKey = cfg.get(configKey, "");
            console.log(`[CodeJanitor] API key verification - saved: ${!!savedKey}`);
            
            if (!apiKeySaved || !savedKey) {
              console.error(`[CodeJanitor] API key failed to persist for ${message.provider}`);
              this._postMessage({
                type: "error",
                text: `Failed to save API key for ${message.provider}. Please try again.`
              });
              return;
            }

            this._postMessage({
              type: "apiKeySaved",
              provider: message.provider
            });
          }

          await this._updateAiConfig("provider", message.provider);
          
          // Wait for persistence and verify
          await new Promise(r => setTimeout(r, 500));
          
          // Verify provider was actually set
          const verifyConfig = vscode.workspace.getConfiguration("codeJanitor.ai");
          const actualProvider = verifyConfig.get("provider", "");
          console.log(`[CodeJanitor] Provider verification - expected: ${message.provider}, actual: ${actualProvider}`);
          
          if (actualProvider !== message.provider) {
            console.error(`[CodeJanitor] Provider failed to persist`);
            this._postMessage({
              type: "error",
              text: `Failed to switch to ${message.provider}. Current provider: ${actualProvider}`
            });
            return;
          }

          if (switchVersion !== this._providerSwitchVersion) {
            return;
          }

          const selectedDuringSwitch = this._modelSelectionVersion !== modelSelectionVersion;
          const latestCfg = vscode.workspace.getConfiguration("codeJanitor.ai");
          const currentConfiguredModel = this._normalizeModelForProvider(
            message.provider,
            message.provider === "nvidia"
              ? String(
                  latestCfg.get("nvidiaModel", "") ||
                    latestCfg.get("model", "") ||
                    ""
                ).trim()
              : String(latestCfg.get("model", "") || "").trim()
          );
          const preferredModel = this._resolvePreferredModelForProvider(message.provider);
          const nextModel = this._normalizeModelForProvider(
            message.provider,
            selectedDuringSwitch && currentConfiguredModel
              ? currentConfiguredModel
              : preferredModel
          );

          console.log(
            `[CodeJanitor] Setting model to: ${nextModel}${selectedDuringSwitch ? " (preserving latest user selection)" : ""}`
          );

          await this._updateAiConfig("model", nextModel);
          if (message.provider === "nvidia") {
            await this._updateAiConfig("nvidiaModel", nextModel);
          }
          await this._syncAiState(message.provider, nextModel);
          
          const effectiveConfig = this.agent.getConfig();
          console.log(
            `[CodeJanitor] Effective config - Provider: ${effectiveConfig.provider}, Model: ${effectiveConfig.model}`
          );
          
          // Send updated state to UI
          const restoredKeys = await this._restoreApiKeys();
          this._postMessage({
            type: "providerSwitched",
            provider: effectiveConfig.provider,
            model: effectiveConfig.model,
            hasGroqKey: restoredKeys.groq,
            hasOpenrouterKey: restoredKeys.openrouter,
            hasAnthropicKey: restoredKeys.anthropic,
            hasNvidiaKey: restoredKeys.nvidia
          });
          
          // Fetch models for providers that support runtime discovery.
          if (
            effectiveConfig.provider === "ollama" ||
            effectiveConfig.provider === "nvidia"
          ) {
            await this._fetchAndSendModels();
          }
        } catch (error) {
          console.error(`[CodeJanitor] Error switching provider:`, error);
          this._postMessage({
            type: "error",
            text: `Failed to switch provider: ${error.message}`
          });
        }
      } else if (message.type === "openGit") {
        vscode.commands.executeCommand("codeJanitorArduino.openSourceControl");
      } else if (message.type === "generateCircuit") {
        await this._generateCircuitDiagram(workspaceFolder);
      } else if (message.type === "webSearch") {
        try {
          const query = (message.query || "").trim();
          if (!query) {
            this._postMessage({ type: "searchError", error: "Search query is empty" });
            return;
          }

          this._postMessage({ type: "status", text: `Searching for: ${query}` });
          this._postMessage({ type: "thinking" });

          const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
          
          const response = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Code-Janitor-Arduino/1.0' },
            signal: AbortSignal.timeout(15000)
          });

          if (!response.ok) {
            throw new Error(`Search API returned status ${response.status}`);
          }

          const data = await response.json();
          
          let resultText = `🔍 Search results for "${query}":\n\n`;
          
          if (data.AbstractText) {
            resultText += `📝 Summary:\n${data.AbstractText}\n\n`;
          }
          
          if (data.AbstractURL) {
            resultText += `🔗 Source: ${data.AbstractURL}\n\n`;
          }

          if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            resultText += `📚 Related Topics:\n`;
            const topics = data.RelatedTopics.slice(0, 5);
            for (const topic of topics) {
              if (topic.Text && topic.FirstURL) {
                resultText += `• ${topic.Text}\n  ${topic.FirstURL}\n\n`;
              }
            }
          }

          if (!data.AbstractText && (!data.RelatedTopics || data.RelatedTopics.length === 0)) {
            resultText += `No detailed results found. Try a more specific query or visit:\nhttps://duckduckgo.com/?q=${encodeURIComponent(query)}`;
          }

          this._postMessage({ type: "stream", text: resultText });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "searchComplete" });

        } catch (error) {
          console.error("[ChatPanel] Web search error:", error);
          this._postMessage({ 
            type: "error", 
            text: `Search failed: ${error.message}. Check your internet connection.` 
          });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "searchError", error: error.message });
        }
      } else if (message.type === "youtubeSearch") {
        try {
          const query = (message.query || "").trim();
          if (!query) {
            this._postMessage({ type: "youtubeError", error: "Search query is empty" });
            return;
          }

          this._postMessage({ type: "status", text: `▶️ Searching YouTube for: ${query}` });
          this._postMessage({ type: "thinking" });

          const results = await this._searchYouTube(query);
          
          if (results.error) {
            throw new Error(results.error);
          }

          // Format results with clickable links
          let resultText = `▶️ YouTube results for "${query}":\n\n`;
          
          if (results.fallback) {
            resultText += `ℹ️ ${results.message}\n\n`;
          }
          
          if (results.videos && results.videos.length > 0) {
            for (const video of results.videos) {
              // For search links, format on a single line so frontend regex can detect it
              if (video.isSearchLink) {
                resultText += `📺 ${video.title}\n\n${video.url}\n\n`;
              } else {
                resultText += `📺 ${video.title}\n\n${video.url}\n\n`;
              }
            }
          } else {
            resultText += `No videos found. Try a different search term.`;
          }
          
          console.log('[YouTube Backend] Sending result text:', resultText);

          this._postMessage({ type: "stream", text: resultText });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "youtubeSearchComplete" });

        } catch (error) {
          console.error("[ChatPanel] YouTube search error:", error);
          this._postMessage({ 
            type: "error", 
            text: `YouTube search failed: ${error.message}` 
          });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "youtubeSearchError", error: error.message });
        }
      }
    });
  }

  async _generateCircuitDiagram(workspaceFolder) {
    const activeEditor = this.lastActiveEditor || vscode.window.activeTextEditor;
    if (
      !activeEditor ||
      activeEditor.document.uri.scheme !== "file" ||
      !/\.ino$/i.test(activeEditor.document.fileName || "")
    ) {
      this._postMessage({
        type: "error",
        text: "Please open an Arduino (.ino) file to generate circuit instructions."
      });
      return;
    }

    this._postMessage({ type: "thinking" });
    this._postMessage({ type: "status", text: "Analyzing Arduino sketch for TinkerCAD steps..." });

    const code = activeEditor.document.getText();
    const fileName = path.basename(activeEditor.document.fileName);
    const sketchFolder = path.basename(path.dirname(activeEditor.document.fileName));

    const prompt = `Analyze this Arduino sketch and generate a TinkerCAD Circuits build guide.

File: ${fileName}
Sketch folder: ${sketchFolder}
\`\`\`cpp
${code}
\`\`\`

Provide step-by-step TinkerCAD instructions:
1. **Components Needed**: List all components with exact names as they appear in TinkerCAD (e.g., "Arduino Uno R3", "Red LED", "220Ω Resistor", "Pushbutton")
2. **Step-by-Step Wiring**: Numbered steps for connecting each component in TinkerCAD
   - Example: "1. Drag Arduino Uno R3 to workspace"
   - Example: "2. Place Red LED on breadboard at E5-E6"
   - Example: "3. Connect LED anode (E5) to Arduino pin 13 with wire"
3. **Power Connections**: All GND and 5V/3.3V connections
4. **Testing Instructions**: How to run the simulation in TinkerCAD
5. **Expected Behavior**: What should happen when code runs

Rules:
- Do not output FILE:, MKDIR:, or CMD: actions.
- Do not ask follow-up questions.
- If a pin or component is uncertain, say "Verify this pin in the sketch".
- Keep the answer practical and beginner-friendly.

Format as a clear tutorial that students can follow step-by-step in TinkerCAD Circuits.`;

    try {
      let streamedText = "";
      const response = await this.agent.chat(
        prompt,
        workspaceFolder,
        (chunk) => {
          streamedText += chunk;
          this._postMessage({ type: "stream", text: chunk });
        },
        null,
        {
          mode: "fast",
          intentOverride: "general",
          onStatus: (text) => { this._postMessage({ type: "status", text }); }
        }
      );

      if (response.error) {
        this._postMessage({ type: "error", text: response.error });
      } else {
        const fallbackText =
          typeof response.text === "string" ? response.text.trim() : "";
        if (!streamedText.trim() && fallbackText) {
          this._postMessage({ type: "stream", text: fallbackText });
        }
        this._postMessage({ type: "status", text: "✅ TinkerCAD tutorial generated! Follow the steps above to build your circuit." });

        this._postMessage({
          type: "status",
          text: "TinkerCAD tutorial generated. Follow the steps above to build your circuit."
        });

        const circuitEntries = this._inferCircuitFromSketch(code);
        
        // Generate enhanced Mermaid block diagram with actual component names
        const mermaidCode = this._buildCircuitMermaid(fileName, circuitEntries);
        this._showCircuitMermaidPreview(fileName, mermaidCode);
        this._postMessage({
          type: "status",
          text: "Opened enhanced circuit diagram beside the chat."
        });

        const openTinkercad = await vscode.window.showInformationMessage(
          "Open TinkerCAD Circuits to start building?",
          "Open TinkerCAD",
          "Cancel"
        );

        if (openTinkercad === "Open TinkerCAD") {
          vscode.env.openExternal(vscode.Uri.parse("https://www.tinkercad.com/dashboard"));
        }
      }
    } catch (err) {
      this._postMessage({ type: "error", text: `Circuit generation failed: ${err.message}` });
    } finally {
      this._postMessage({ type: "done" });
    }
  }

  async _searchYouTube(query) {
    try {
      console.log(`[YouTube] Searching for: ${query}`);
      
      // Scrape YouTube search results page
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      
      try {
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          const html = await response.text();
          
          // Extract video IDs from YouTube's initial data
          const videoIds = [];
          const videoTitles = [];
          
          // Method 1: Extract from ytInitialData JSON
          const ytDataMatch = html.match(/var ytInitialData = (\{.+?\});/);
          if (ytDataMatch) {
            try {
              const ytData = JSON.parse(ytDataMatch[1]);
              const contents = ytData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
              
              if (contents) {
                for (const section of contents) {
                  const items = section?.itemSectionRenderer?.contents || [];
                  for (const item of items) {
                    const videoRenderer = item?.videoRenderer;
                    if (videoRenderer?.videoId) {
                      videoIds.push(videoRenderer.videoId);
                      videoTitles.push(videoRenderer.title?.runs?.[0]?.text || 'YouTube Video');
                      if (videoIds.length >= 5) break;
                    }
                  }
                  if (videoIds.length >= 5) break;
                }
              }
            } catch (parseError) {
              console.log('[YouTube] Failed to parse ytInitialData:', parseError.message);
            }
          }
          
          // Method 2: Regex fallback - extract from watch URLs
          if (videoIds.length === 0) {
            const watchMatches = html.matchAll(/\/watch\?v=([a-zA-Z0-9_-]{11})/g);
            const seenIds = new Set();
            for (const match of watchMatches) {
              if (!seenIds.has(match[1])) {
                videoIds.push(match[1]);
                videoTitles.push('YouTube Video');
                seenIds.add(match[1]);
                if (videoIds.length >= 5) break;
              }
            }
          }
          
          if (videoIds.length > 0) {
            console.log(`[YouTube] Scraped ${videoIds.length} videos from search page`);
            const videos = videoIds.map((id, index) => ({
              videoId: id,
              title: videoTitles[index] || 'YouTube Video',
              url: `https://www.youtube.com/watch?v=${id}`
            }));
            return { videos };
          }
        }
      } catch (scrapeError) {
        console.log('[YouTube] Scraping failed:', scrapeError.message);
      }
      
      // Fallback: Try Invidious API
      const instances = ['https://invidious.io.lol', 'https://inv.tux.pizza'];
      
      for (const instance of instances) {
        try {
          const apiUrl = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort=relevance`;
          const apiResponse = await fetch(apiUrl, {
            headers: { 'User-Agent': 'Code-Janitor-Arduino/1.0' },
            signal: AbortSignal.timeout(2000)
          });

          if (apiResponse.ok) {
            const data = await apiResponse.json();
            if (Array.isArray(data) && data.length > 0) {
              const videos = data.slice(0, 5).map(video => ({
                videoId: video.videoId,
                title: video.title,
                url: `https://www.youtube.com/watch?v=${video.videoId}`
              }));
              return { videos };
            }
          }
        } catch (instanceError) {
          continue;
        }
      }
      
      // Final fallback: Return YouTube search link
      console.log('[YouTube] All methods failed, using search link');
      const videos = [{
        title: `Search "${query}" on YouTube`,
        url: searchUrl,
        isSearchLink: true
      }];
      
      return { videos };
    } catch (error) {
      console.error('[YouTube] Search error:', error);
      return { 
        error: 'YouTube search failed',
        videos: []
      };
    }
  }

  _getFallbackYouTubeVideos(query) {
    // Always return a YouTube search link for ANY query
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    return [{
      title: `Search "${query}" on YouTube`,
      url: searchUrl,
      isSearchLink: true
    }];
  }
}

module.exports = ChatPanel;
