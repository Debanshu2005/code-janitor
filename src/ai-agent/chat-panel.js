const vscode = require("vscode");
const AIAgent = require("./agent");

class ChatPanel {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.agent = new AIAgent();
    this.abortController = null;
    this.lastActiveEditor = vscode.window.activeTextEditor || null;
    this.chatMode = "fast";

    this.agent.setActiveEditor(this.lastActiveEditor);

    // Track last active editor before focus moves to chat panel
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
    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    this.panel.webview.postMessage({
      type: "status",
      text: "Ready. Fast mode avoids codebase scanning unless needed."
    });
  }

  _setupMessageHandler() {
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "chat") {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
          this.panel.webview.postMessage({ type: "status", text: "Workspace overview ready." });
          this.panel.webview.postMessage({ type: "done" });
          return;
        }

        const fastLocalResponse = this.agent._getFastLocalResponse(trimmedText);

        if (fastLocalResponse) {
          this.panel.webview.postMessage({ type: "status", text: "Answering locally." });
          this.panel.webview.postMessage({ type: "thinking" });
          this.panel.webview.postMessage({ type: "stream", text: fastLocalResponse });
          this.panel.webview.postMessage({ type: "done" });
          return;
        }

        // Pass last known active editor to agent
        this.agent.setActiveEditor(this.lastActiveEditor || vscode.window.activeTextEditor);
        const deterministicResponse =
          this.agent.getDeterministicEditorStateResponse(
            trimmedText,
            workspaceFolder
          );

        if (deterministicResponse) {
          this.panel.webview.postMessage({ type: "status", text: "Using editor state." });
          this.panel.webview.postMessage({ type: "thinking" });
          this.panel.webview.postMessage({ type: "stream", text: deterministicResponse });
          this.panel.webview.postMessage({ type: "done" });
          return;
        }

        const deterministicScanResponse =
          this.agent.getDeterministicActiveFileScanResponse(
            trimmedText,
            workspaceFolder
          );

        if (deterministicScanResponse) {
          this.panel.webview.postMessage({
            type: "status",
            text: "Scanning active files from editor state."
          });
          this.panel.webview.postMessage({ type: "thinking" });
          this.panel.webview.postMessage({
            type: "stream",
            text: deterministicScanResponse
          });
          this.panel.webview.postMessage({ type: "done" });
          return;
        }

        this.panel.webview.postMessage({ type: "thinking" });
        this.abortController = new AbortController();

        const response = await this.agent.chat(
          trimmedText,
          workspaceFolder,
          (chunk) => {
            this.panel.webview.postMessage({ type: "stream", text: chunk });
          },
          this.abortController.signal,
          {
            mode: this.chatMode,
            onStatus: (text) => {
              this.panel.webview.postMessage({ type: "status", text });
            }
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
              const result = await this.agent.applyChanges(
                action.path,
                action.content
              );
              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                text: result.success
                  ? `Updated ${result.relativePath || action.path}\n${result.changeSummary || ""}`
                  : result.error
              });
            } else if (action.type === "mkdir") {
              const result = await this.agent.createFolder(action.path);
              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                text: result.success
                  ? `Created folder ${action.path}`
                  : result.error
              });
            } else if (action.type === "cmd") {
              const validation = this.agent.validateCommand(action.command);
              if (!validation.allowed) {
                this.panel.webview.postMessage({
                  type: "status",
                  text: `Blocked command: ${validation.reason}`
                });
                continue;
              }

              const confirmed = await vscode.window.showWarningMessage(
                `AI wants to run this project command: ${action.command}`,
                "Allow",
                "Deny"
              );

              if (confirmed !== "Allow") {
                this.panel.webview.postMessage({
                  type: "status",
                  text: "Command denied by user."
                });
                continue;
              }

              this.panel.webview.postMessage({
                type: "status",
                text: `Running: ${action.command}`
              });

              const result = await this.agent.executeCommand(
                action.command,
                workspaceFolder
              );

              this.panel.webview.postMessage({
                type: result.success ? "applied" : "error",
                text: result.success ? result.output : result.error
              });
            }
          }
        }
      } else if (message.type === "stop") {
        if (this.abortController) {
          this.abortController.abort();
          this.panel.webview.postMessage({ type: "done" });
        }
      } else if (message.type === "apply") {
        const result = await this.agent.applyChanges(
          message.filePath,
          message.content
        );
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
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        this.panel.webview.postMessage({ type: "status", text: "Scanning workspace..." });
        this.panel.webview.postMessage({ type: "thinking" });
        const overview = await this.agent.getCodebaseOverview(workspaceFolder);
        this.panel.webview.postMessage({ type: "stream", text: overview });
        this.panel.webview.postMessage({ type: "status", text: "Workspace overview ready." });
        this.panel.webview.postMessage({ type: "done" });
      } else if (message.type === "mode") {
        this.chatMode = message.value === "heavy" ? "heavy" : "fast";
        this.panel.webview.postMessage({
          type: "status",
          text:
            this.chatMode === "heavy"
              ? "Mode switched to Heavy."
              : "Mode switched to Fast."
        });
      }
    });
  }

  _getHtmlContent() {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e4e4e7;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #header {
      padding: 20px;
      background: rgba(0, 0, 0, 0.3);
      border-bottom: 2px solid #0ea5e9;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    #header h2 { font-size: 20px; font-weight: 600; color: #0ea5e9; }
    #header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #mode-switch {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #cbd5e1;
    }
    #mode {
      padding: 8px 10px;
      background: rgba(15, 23, 42, 0.9);
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 8px;
      font-size: 12px;
    }
    #chat { flex: 1; overflow-y: auto; padding: 20px; }
    .message {
      margin-bottom: 20px;
      padding: 15px 20px;
      border-radius: 12px;
      animation: fadeIn 0.3s;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      white-space: pre-wrap;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .user {
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      margin-left: 15%;
      border-bottom-right-radius: 4px;
    }
    .ai {
      background: rgba(30, 41, 59, 0.8);
      margin-right: 15%;
      border: 1px solid #334155;
      border-bottom-left-radius: 4px;
    }
    .typing-indicator {
      display: flex;
      gap: 5px;
      align-items: center;
      padding: 4px 0;
    }
    .typing-indicator span {
      width: 8px; height: 8px;
      background: #0ea5e9;
      border-radius: 50%;
      animation: bounce 1.2s infinite;
    }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }
    .status {
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      display: inline-block;
      margin: 0 auto 16px;
    }
    pre {
      background: #0f172a;
      padding: 15px;
      border-radius: 8px;
      overflow-x: auto;
      border-left: 3px solid #0ea5e9;
      margin: 10px 0;
    }
    code { font-family: "Fira Code", "Courier New", monospace; font-size: 13px; color: #e2e8f0; }
    #input-area {
      display: flex;
      padding: 20px;
      background: rgba(0, 0, 0, 0.3);
      border-top: 2px solid #334155;
      gap: 10px;
    }
    #input {
      flex: 1;
      padding: 14px 18px;
      background: rgba(30, 41, 59, 0.6);
      border: 2px solid #334155;
      color: #e4e4e7;
      border-radius: 10px;
      font-size: 14px;
    }
    #input:focus { outline: none; border-color: #0ea5e9; }
    button {
      padding: 12px 24px;
      color: white;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    }
    #send { background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); }
    #scan { background: linear-gradient(135deg, #22c55e 0%, #15803d 100%); }
    #stop { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); display: none; }
    #clear { background: linear-gradient(135deg, #64748b 0%, #475569 100%); }
  </style>
</head>
<body>
  <div id="header">
    <div id="header-left">
      <h2>Code Janitor AI</h2>
      <span style="font-size: 12px; color: #64748b;">Powered by Ollama</span>
    </div>
    <div id="mode-switch">
      <label for="mode">Mode</label>
      <select id="mode">
        <option value="fast" selected>Fast</option>
        <option value="heavy">Heavy</option>
      </select>
    </div>
  </div>
  <div id="chat"></div>
  <div id="input-area">
    <input id="input" type="text" placeholder="Ask anything. Use /scan, /fast, /heavy" />
    <button id="send">Send</button>
    <button id="scan">Scan</button>
    <button id="stop">Stop</button>
    <button id="clear">Clear</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById("chat");
    const input = document.getElementById("input");
    const send = document.getElementById("send");
    const scan = document.getElementById("scan");
    const stop = document.getElementById("stop");
    const clear = document.getElementById("clear");
    const mode = document.getElementById("mode");
    let currentMessage = null;

    function escapeHtml(text) {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function renderContent(text) {
      const escaped = escapeHtml(text);
      const fence = "\\x60\\x60\\x60";
      return escaped.replace(new RegExp(fence + "(\\\\w+)?\\\\n([\\\\s\\\\S]*?)" + fence, "g"), "<pre><code>$2</code></pre>");
    }

    function addMessage(text, type) {
      const msg = document.createElement("div");
      msg.className = "message " + type;
      msg.innerHTML = renderContent(text);
      chat.appendChild(msg);
      chat.scrollTop = chat.scrollHeight;
      return msg;
    }

    send.onclick = () => {
      const text = input.value.trim();
      if (!text) return;
      addMessage(text, "user");
      vscode.postMessage({ type: "chat", text });
      input.value = "";
      send.style.display = "none";
      scan.style.display = "none";
      stop.style.display = "inline-block";
    };

    scan.onclick = () => {
      addMessage("/scan", "user");
      vscode.postMessage({ type: "scanOverview" });
      send.style.display = "none";
      scan.style.display = "none";
      stop.style.display = "inline-block";
    };

    stop.onclick = () => {
      vscode.postMessage({ type: "stop" });
      send.style.display = "inline-block";
      scan.style.display = "inline-block";
      stop.style.display = "none";
      if (currentMessage) {
        currentMessage.innerHTML += "<br><em style='color:#94a3b8;'>(stopped)</em>";
      }
    };

    clear.onclick = () => {
      chat.innerHTML = "";
      vscode.postMessage({ type: "clear" });
      addMessage("Conversation cleared.", "status");
    };

    mode.onchange = () => {
      vscode.postMessage({ type: "mode", value: mode.value });
    };

    input.onkeypress = (event) => {
      if (event.key === "Enter") {
        send.click();
      }
    };

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "status") {
        addMessage(msg.text, "status");
      } else if (msg.type === "thinking") {
        currentMessage = document.createElement("div");
        currentMessage.className = "message ai";
        currentMessage.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        chat.appendChild(currentMessage);
        chat.scrollTop = chat.scrollHeight;
      } else if (msg.type === "stream" && currentMessage) {
        const indicator = currentMessage.querySelector(".typing-indicator");
        if (indicator) {
          indicator.remove();
          currentMessage._textNode = document.createTextNode("");
          currentMessage.appendChild(currentMessage._textNode);
        }
        if (currentMessage._textNode) {
          currentMessage._textNode.textContent += msg.text;
        } else {
          currentMessage.textContent += msg.text;
        }
        chat.scrollTop = chat.scrollHeight;
      } else if (msg.type === "done") {
        currentMessage = null;
        send.style.display = "inline-block";
        scan.style.display = "inline-block";
        stop.style.display = "none";
      } else if (msg.type === "error") {
        send.style.display = "inline-block";
        scan.style.display = "inline-block";
        stop.style.display = "none";
        addMessage("Error: " + msg.text, "status");
      } else if (msg.type === "applied") {
        addMessage(msg.text, "status");
      }
    });
  </script>
</body>
</html>`;
  }
}

module.exports = ChatPanel;

