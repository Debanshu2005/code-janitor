const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const AIAgent = require("./agent");

const MODELS_BY_PROVIDER = {
  groq: ["llama-3.1-8b-instant"],
  openrouter: [
    "mistralai/mistral-7b-instruct:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemini-2.0-flash-exp:free"
  ],
  anthropic: ["claude-opus-4-5","claude-sonnet-4-5","claude-3-5-sonnet-20241022","claude-3-5-haiku-20241022","claude-3-opus-20240229"]
};

class ChatPanel {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.welcomePanel = null;
    this.circuitPreviewPanel = null;
    this.agent = new AIAgent(context); // Pass context to agent
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
      /\.(js|jsx|ts|tsx|py|java|c|cpp|h|ino)$/i.test(f)
    );
    let reply = `Compiling ${files.length} file(s) for errors...\n`;
    this.panel.webview.postMessage({ type: "stream", text: reply });
    
    const errorsFound = [];
    for (const f of files) {
      const fullPath = require("path").join(workspaceFolder, f);
      const result = await this.agent.executeCommand(
        this.agent._getSyntaxCheckCommand(f.replace(/\\/g, "/")),
        workspaceFolder
      );
      
      if (result && !result.success) {
        const errorText = result.error || result.output || "Unknown error";
        const isLibraryError = /library|import|include|module|package|cannot find|no such file/i.test(errorText);
        
        errorsFound.push({
          file: f,
          error: errorText,
          isLibraryError
        });
        
        const msg = `\n❌ ${f}:\n${errorText}`;
        this.panel.webview.postMessage({ type: "stream", text: msg });
        reply += msg;
      }
    }
    
    if (errorsFound.length === 0) {
      const summary = "\n\n✅ No syntax errors found.";
      this.panel.webview.postMessage({ type: "stream", text: summary });
      this.panel.webview.postMessage({ type: "done" });
      return;
    }
    
    // AI will fix non-library errors
    const summary = `\n\nFound ${errorsFound.length} error(s). AI will now fix them...`;
    this.panel.webview.postMessage({ type: "stream", text: summary });
    
    for (const { file, error, isLibraryError } of errorsFound) {
      if (isLibraryError) {
        const libraryMsg = `\n\n📚 ${file}: Missing library detected. Please install the required library manually.`;
        this.panel.webview.postMessage({ type: "stream", text: libraryMsg });
        continue;
      }
      
      // AI fixes the error
      this.panel.webview.postMessage({ type: "stream", text: `\n\n🔧 Fixing ${file}...` });
      
      const fixPrompt = `Fix the syntax error in ${file}:\n\nError:\n${error}\n\nReturn the complete corrected file using FILE: ${file} format.`;
      
      try {
        const fixResponse = await this.agent.chat(
          fixPrompt,
          workspaceFolder,
          null,
          null,
          { mode: "fast", onStatus: (text) => {
            this.panel.webview.postMessage({ type: "status", text });
          }}
        );
        
        if (fixResponse.error) {
          this.panel.webview.postMessage({ type: "stream", text: `\n❌ Failed to fix: ${fixResponse.error}` });
          continue;
        }
        
        if (fixResponse.actions && fixResponse.actions.length > 0) {
          const fileAction = fixResponse.actions.find(a => a.type === "file" && a.path === file);
          if (fileAction) {
            const applyResult = await this.agent.applyChanges(file, fileAction.content, false, {});
            if (applyResult.success) {
              this.panel.webview.postMessage({ type: "stream", text: `\n✅ Fixed ${file}` });
            } else {
              this.panel.webview.postMessage({ type: "stream", text: `\n❌ Failed to apply fix: ${applyResult.error}` });
            }
          }
        }
      } catch (err) {
        this.panel.webview.postMessage({ type: "stream", text: `\n❌ Error fixing ${file}: ${err.message}` });
      }
    }
    
    this.panel.webview.postMessage({ type: "stream", text: "\n\n✅ Syntax check and fix complete." });
    this.panel.webview.postMessage({ type: "done" });
  }

  _getHtmlContent() {
    return fs.readFileSync(path.join(__dirname, "chat-panel.html"), "utf8");
  }

  _getWelcomeHtmlContent() {
    const logoPath = vscode.Uri.file(path.join(__dirname, "logo.png"));
    const logoUri = this.welcomePanel
      ? this.welcomePanel.webview.asWebviewUri(logoPath).toString()
      : "";
    let html = fs.readFileSync(path.join(__dirname, "welcome.html"), "utf8");
    html = html.replace(
      "</head>",
      `<script>window.LOGO_URI = ${JSON.stringify(logoUri)};</script>\n  </head>`
    );
    return html;
  }

  async showWelcome() {
    if (this.welcomePanel) {
      this.welcomePanel.reveal();
      return;
    }

    this.welcomePanel = vscode.window.createWebviewPanel(
      "codeJanitorArduinoWelcome",
      "Welcome to Code Janitor Arduino",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(__dirname))
        ]
      }
    );

    this.welcomePanel.webview.html = this._getWelcomeHtmlContent();

    this.welcomePanel.webview.onDidReceiveMessage((message) => {
      if (message.type === "welcomeDismiss") {
        this.welcomePanel.dispose();
      } else if (message.type === "welcomeOpenChat") {
        this.welcomePanel.dispose();
        this.show();
      }
    });

    this.welcomePanel.onDidDispose(() => { this.welcomePanel = null; });
  }

  _getApiKeyConfigKey(provider) {
    if (provider === "groq") return "groqApiKey";
    if (provider === "openrouter") return "openrouterApiKey";
    if (provider === "anthropic") return "anthropicApiKey";
    return null;
  }

  _getApiSecretKey(provider) {
    return `codeJanitor.ai.${provider}.apiKey`;
  }

  async _persistApiKey(provider, apiKey) {
    const configKey = this._getApiKeyConfigKey(provider);
    if (!configKey || !apiKey) return;
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    await this.context.secrets.store(this._getApiSecretKey(provider), apiKey);
    await cfg.update(configKey, apiKey, vscode.ConfigurationTarget.Global);
  }

  async _restoreApiKeys() {
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const providers = ["groq", "openrouter", "anthropic"];
    const presence = {
      groq: false,
      openrouter: false,
      anthropic: false
    };

    for (const provider of providers) {
      const configKey = this._getApiKeyConfigKey(provider);
      const configValue = cfg.get(configKey, "");
      const secretValue = await this.context.secrets.get(this._getApiSecretKey(provider));
      const effectiveValue = configValue || secretValue || "";

      if (!configValue && secretValue) {
        await cfg.update(configKey, secretValue, vscode.ConfigurationTarget.Global);
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
    try {
      // Arduino IDE uses Theia/Eclipse framework, not pure VS Code
      // We need to update config and ensure it persists
      const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
      
      // Try Global target first (works in both VS Code and Arduino IDE)
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
      
      // Also try updating in the configuration object directly as fallback
      // This ensures Arduino IDE's Theia framework picks it up
      await new Promise(r => setTimeout(r, 200));
      
      // Verify the update worked
      const freshCfg = vscode.workspace.getConfiguration("codeJanitor.ai");
      const actualValue = freshCfg.get(key);
      
      console.log(`[CodeJanitor] Updated ${key} to ${value}, actual value: ${actualValue}`);
      
      if (actualValue !== value) {
        console.warn(`[CodeJanitor] Config update may not have persisted. Expected ${value}, got ${actualValue}`);
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

  _setupMessageHandler() {
    this.panel.webview.onDidReceiveMessage(async (message) => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (message.type === "chat") {
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

        this.agent.setActiveEditor(this.lastActiveEditor || vscode.window.activeTextEditor);
        if (workspaceFolder && (this.chatMode === "heavy" || ["edit", "debug", "refactor", "scan"].includes(intent))) {
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
        } catch (err) {
          this.panel.webview.postMessage({ type: "error", text: `AI error: ${err.message}` });
          this.panel.webview.postMessage({ type: "done" });
          return;
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
                await vscode.commands.executeCommand("codeJanitorArduino.openGraphify");
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
          const hasKey = (savedConfig.provider === "groq" && hasGroqKey) ||
                         (savedConfig.provider === "openrouter" && hasOpenrouterKey) ||
                         (savedConfig.provider === "anthropic" && hasAnthropicKey);
          const models = hasKey ? (MODELS_BY_PROVIDER[savedConfig.provider] || null) : null;
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
        const cfg = await this._updateAiConfig("model", message.model);
        const provider = cfg.get("provider", "ollama");
        await this._syncAiState(provider, message.model);
        console.log(`[CodeJanitor] Model switched to: ${message.model} for provider: ${provider}`);
      } else if (message.type === "setProvider") {
        try {
          console.log(`[CodeJanitor] Switching provider to: ${message.provider}`);

          await this._updateAiConfig("provider", message.provider);
          // Get the appropriate model for this provider
          const defaultModel = this._getDefaultModelForProvider(message.provider);
          const savedModel = this._getSavedProviderModel(message.provider);
          const nextModel = savedModel || defaultModel;

          console.log(`[CodeJanitor] Setting model to: ${nextModel}`);

          await this._updateAiConfig("model", nextModel);
          await this._syncAiState(message.provider, nextModel);

          // Save API key if provided
          if (message.apiKey) {
            if (message.provider === "groq") {
              await this._persistApiKey("groq", message.apiKey);
            }
            if (message.provider === "openrouter") {
              await this._persistApiKey("openrouter", message.apiKey);
            }
            if (message.provider === "anthropic") {
              await this._persistApiKey("anthropic", message.apiKey);
            }
            console.log(`[CodeJanitor] API key saved for ${message.provider}`);
          }
          
          // Wait for persistence
          await new Promise(r => setTimeout(r, 300));
          
          const effectiveConfig = this.agent.getConfig();
          console.log(
            `[CodeJanitor] Effective config - Provider: ${effectiveConfig.provider}, Model: ${effectiveConfig.model}`
          );
          
          // Send updated state to UI
          const restoredKeys = await this._restoreApiKeys();
          if (this.panel) {
            this.panel.webview.postMessage({
              type: "providerSwitched",
              provider: effectiveConfig.provider,
              model: effectiveConfig.model,
              hasGroqKey: restoredKeys.groq,
              hasOpenrouterKey: restoredKeys.openrouter,
              hasAnthropicKey: restoredKeys.anthropic
            });
          }
          
          // Fetch models for the new provider if needed
          if (effectiveConfig.provider === "ollama") {
            await this._fetchAndSendModels();
          }
        } catch (error) {
          console.error(`[CodeJanitor] Error switching provider:`, error);
          if (this.panel) {
            this.panel.webview.postMessage({
              type: "error",
              text: `Failed to switch provider: ${error.message}`
            });
          }
        }
      } else if (message.type === "openGit") {
        vscode.commands.executeCommand("codeJanitorArduino.openSourceControl");
      } else if (message.type === "generateCircuit") {
        await this._generateCircuitDiagram(workspaceFolder);
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
      this.panel.webview.postMessage({
        type: "error",
        text: "Please open an Arduino (.ino) file to generate circuit instructions."
      });
      return;
    }

    this.panel.webview.postMessage({ type: "thinking" });
    this.panel.webview.postMessage({ type: "status", text: "Analyzing Arduino sketch for TinkerCAD steps..." });

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
          this.panel.webview.postMessage({ type: "stream", text: chunk });
        },
        null,
        {
          mode: "fast",
          intentOverride: "general",
          onStatus: (text) => { this.panel.webview.postMessage({ type: "status", text }); }
        }
      );

      if (response.error) {
        this.panel.webview.postMessage({ type: "error", text: response.error });
      } else {
        const fallbackText =
          typeof response.text === "string" ? response.text.trim() : "";
        if (!streamedText.trim() && fallbackText) {
          this.panel.webview.postMessage({ type: "stream", text: fallbackText });
        }
        this.panel.webview.postMessage({ type: "status", text: "✅ TinkerCAD tutorial generated! Follow the steps above to build your circuit." });

        this.panel.webview.postMessage({
          type: "status",
          text: "TinkerCAD tutorial generated. Follow the steps above to build your circuit."
        });

        const circuitEntries = this._inferCircuitFromSketch(code);
        
        // Generate enhanced Mermaid block diagram with actual component names
        const mermaidCode = this._buildCircuitMermaid(fileName, circuitEntries);
        this._showCircuitMermaidPreview(fileName, mermaidCode);
        this.panel.webview.postMessage({
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
      this.panel.webview.postMessage({ type: "error", text: `Circuit generation failed: ${err.message}` });
    } finally {
      this.panel.webview.postMessage({ type: "done" });
    }
  }
}

module.exports = ChatPanel;
