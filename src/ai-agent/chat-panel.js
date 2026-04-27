const vscode = require("vscode");
const fs = require("fs").promises;
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const AIAgent = require("./agent");
const PerformanceMonitor = require("../self-healing/performance-monitor");

const MODELS_BY_PROVIDER = {
  groq: ["llama-3.1-8b-instant","llama-3.1-70b-versatile","llama3-8b-8192","llama3-70b-8192","mixtral-8x7b-32768","gemma2-9b-it"],
  openrouter: ["qwen/qwen-2.5-coder-32b-instruct","qwen/qwen3-coder:free","qwen/qwen3-coder","qwen/qwen3-32b","qwen/qwen3-14b","qwen/qwen3-8b","qwen/qwq-32b","qwen/qwen2.5-coder-7b-instruct","qwen/qwen-2.5-72b-instruct","deepseek/deepseek-r1-distill-qwen-32b","meta-llama/llama-3.3-70b-instruct","meta-llama/llama-3.1-8b-instruct:free","google/gemini-2.0-flash-exp:free","mistralai/mistral-7b-instruct:free"],
  anthropic: ["claude-opus-4-5","claude-sonnet-4-5","claude-3-5-sonnet-20241022","claude-3-5-haiku-20241022","claude-3-opus-20240229"],
  nvidia: ["meta/llama-3.1-8b-instruct","nvidia/nvidia-nemotron-nano-9b-v2","minimaxai/minimax-m2.7","mistralai/mistral-nemotron","meta/llama-3.1-70b-instruct","nvidia/llama-3.3-nemotron-super-49b-v1.5"]
};
const BUILT_IN_PROVIDERS = new Set(["ollama", "groq", "openrouter", "anthropic", "nvidia"]);

class ChatPanel {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.sidebarView = null;
    this.agent = new AIAgent();
    this.performanceMonitor = new PerformanceMonitor(context);
    this.abortController = null;
    this.lastActiveEditor = vscode.window.activeTextEditor || null;
    this.chatMode = "fast";
    this.showThinking = !!this.context.globalState.get(
      "codeJanitor.ai.showThinking",
      false
    );
    this._confirmResolve = null;
    this._boundWebviews = new WeakSet();

    this.agent.setActiveEditor(this.lastActiveEditor);
    this.agent.showThinking = this.showThinking;
    this.performanceMonitor.loadMetrics();
    
    // Expose performance monitor globally for agent to log issues
    global.performanceMonitor = this.performanceMonitor;

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === "file") this.lastActiveEditor = editor;
    }, null, context.subscriptions);
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

  async show() {
    try {
      console.log("[ChatPanel] show() called");
      this.lastActiveEditor = vscode.window.activeTextEditor || this.lastActiveEditor;
      this.agent.setActiveEditor(this.lastActiveEditor);

      if (this.panel) {
        console.log("[ChatPanel] Panel already exists, revealing");
        this.panel.reveal();
        return;
      }

      console.log("[ChatPanel] Creating new panel");
      // CRITICAL FIX: Force provider to ollama if no API keys are configured
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const currentProvider = this._getSelectedProviderId() || cfg.get("provider", "ollama");
    const groqKey = cfg.get("groqApiKey", "");
    const openrouterKey = cfg.get("openrouterApiKey", "");
    const anthropicKey = cfg.get("anthropicApiKey", "");
    const nvidiaKey = cfg.get("nvidiaApiKey", "");

    // If using a cloud provider but no API key is set, force to ollama
    if (currentProvider === "groq" && !groqKey) {
      console.log("[ChatPanel] No Groq API key found, forcing provider to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
    } else if (currentProvider === "openrouter" && !openrouterKey) {
      console.log("[ChatPanel] No OpenRouter API key found, forcing provider to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
    } else if (currentProvider === "anthropic" && !anthropicKey) {
      console.log("[ChatPanel] No Anthropic API key found, forcing provider to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
    } else if (currentProvider === "nvidia" && !nvidiaKey) {
      console.log("[ChatPanel] No NVIDIA API key found, forcing provider to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
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

    console.log("[ChatPanel] Creating webview panel");
    this.panel = vscode.window.createWebviewPanel(
      "codeJanitorChat",
      "Code Janitor AI",
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this._attachWebviewHost(this.panel, { kind: "panel" });
    
    console.log("[ChatPanel] Setting up dispose handler");
    this.panel.onDidDispose(() => { 
      console.log("[ChatPanel] Panel disposed");
      this.panel = null; 
    });
    
    console.log("[ChatPanel] Panel created successfully");
    } catch (error) {
      console.error("[ChatPanel] CRITICAL ERROR in show():", error);
      console.error("[ChatPanel] Error stack:", error.stack);
      vscode.window.showErrorMessage(`Failed to open AI Chat: ${error.message}`);
      throw error;
    }
  }

  async _runSyntaxScan(workspaceFolder, specificFiles) {
    if (!workspaceFolder) {
      this._postMessage({ type: "status", text: "No workspace open." });
      return;
    }
    this._postMessage({ type: "thinking" });
    await this.agent.ensureCodebaseScanned(workspaceFolder);
    const files = specificFiles || Array.from(this.agent.codebaseContext.keys()).filter(f =>
      /\.(js|jsx|ts|tsx|py|java)$/i.test(f)
    );
    let reply = `Scanning ${files.length} file(s) for syntax errors...\n`;
    this._postMessage({ type: "stream", text: reply });
    let errorCount = 0;
    const dirtyOpen = new Map();
    for (const editor of vscode.window.visibleTextEditors || []) {
      const doc = editor.document;
      if (!doc || doc.uri.scheme !== "file" || !doc.isDirty) continue;
      const rel = path.relative(workspaceFolder, doc.fileName).replace(/\\/g, "/");
      if (rel) dirtyOpen.set(rel, doc);
    }
    for (const f of files) {
      const normalized = f.replace(/\\/g, "/");
      let result = null;
      let tempPath = "";
      const dirtyDoc = dirtyOpen.get(normalized);
      const shouldUseTemp = !!dirtyDoc;

      if (shouldUseTemp) {
        const ext = path.extname(dirtyDoc.fileName);
        const tmpName = `code-janitor-scan-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
        tempPath = path.join(os.tmpdir(), tmpName);
        try {
          fsSync.writeFileSync(tempPath, dirtyDoc.getText(), "utf8");
          const cmd = this.agent._getSyntaxCheckCommand(tempPath.replace(/\\/g, "/"));
          result = cmd ? await this.agent.executeCommand(cmd, workspaceFolder) : null;
          if (result && result.success) {
            result = { success: true };
          } else if (result) {
            result = {
              success: false,
              error: result.error || result.output || "Syntax check failed",
              output: result.output || result.error || ""
            };
          }
        } finally {
          if (tempPath) {
            try { fsSync.unlinkSync(tempPath); } catch (_) {}
          }
        }
      } else {
        result = await this.agent._runSyntaxCheck(normalized, workspaceFolder, null);
      }

      if (!result) {
        // File type not supported for syntax checking
        continue;
      }
      if (result.skipped) {
        // C/C++ files that need manual checking
        const msg = `\n\u26a0\ufe0f ${normalized}: ${result.output}`;
        this._postMessage({ type: "stream", text: msg });
        reply += msg;
        continue;
      }
      if (!result.success) {
        // Syntax error found
        const errorMsg = result.error || result.output || "Unknown syntax error";
        const msg = `\n\u274c ${normalized}:\n${errorMsg}`;
        this._postMessage({ type: "stream", text: msg });
        reply += msg;
        errorCount++;
      }
    }
    const summary = errorCount > 0 
      ? `\n\n\u274c Found ${errorCount} file(s) with syntax errors.` 
      : "\n\n\u2705 No syntax errors found.";
    this._postMessage({ type: "stream", text: summary });
    this._postMessage({ type: "done" });
  }

  async _runLibraryAudit(workspaceFolder) {
    if (!workspaceFolder) {
      this._postMessage({
        type: "error",
        text: "Open a workspace first so imports and installed libraries can be audited."
      });
      this._postMessage({ type: "done" });
      return;
    }

    this._postMessage({ type: "thinking" });
    this._postMessage({
      type: "status",
      text: "Auditing libraries across all supported languages..."
    });

    const importMap = await this._collectLibraryImports(workspaceFolder);
    const importsByLanguage = new Map();
    
    for (const [filePath, imports] of importMap.entries()) {
      const ext = path.extname(filePath).toLowerCase();
      let lang = "unknown";
      if ([".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".ino", ".pde"].includes(ext)) lang = "C/C++";
      else if (ext === ".py") lang = "Python";
      else if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) lang = "JavaScript/TypeScript";
      else if (ext === ".java") lang = "Java";
      else if (ext === ".go") lang = "Go";
      else if (ext === ".rs") lang = "Rust";
      else if (ext === ".rb") lang = "Ruby";
      else if (ext === ".php") lang = "PHP";
      
      if (!importsByLanguage.has(lang)) importsByLanguage.set(lang, new Set());
      imports.forEach(imp => importsByLanguage.get(lang).add(imp));
    }

    if (importsByLanguage.size === 0) {
      this._postMessage({
        type: "stream",
        text: "No library imports found in supported languages."
      });
      this._postMessage({ type: "done" });
      return;
    }

    let report = "Library Audit Report\n\n";
    report += `Languages detected: ${Array.from(importsByLanguage.keys()).join(", ")}\n\n`;

    // Check C/C++ libraries with arduino-cli
    if (importsByLanguage.has("C/C++")) {
      const importedHeaders = importsByLanguage.get("C/C++");
      report += "=== C/C++/Arduino Libraries ===\n";
      report += `Imported headers: ${importedHeaders.size}\n\n`;

      const installedResult = await this.agent.executeCommand("arduino-cli lib list --format json", workspaceFolder);
      if (!installedResult.success) {
        report += "⚠️ Could not check installed Arduino libraries. Install arduino-cli to enable this check.\n\n";
      } else {

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

        report += `Installed libraries: ${installedLibraries.length}\n`;
        report += `Matched imports: ${matched.length}\n`;
        report += `Missing imports: ${missing.length}\n`;

        if (matched.length > 0) {
          report += "\nMatched imports:\n";
          for (const header of matched.slice(0, 10)) report += `- ${header}\n`;
        }

        if (ignoredCore.length > 0) {
          report += "\nIgnored core/system headers:\n";
          for (const header of ignoredCore.slice(0, 10)) report += `- ${header}\n`;
        }

        if (missing.length === 0) {
          report += "\n✅ All C/C++ libraries are installed.\n\n";
        } else {

          report += "\nMissing C/C++ library candidates:\n";
          for (const header of missing.slice(0, 5)) {
            const baseName = path.basename(header).replace(/\.(h|hpp)$/i, "");
            report += `\n- ${header}\n`;
            report += `  Install: arduino-cli lib install "${baseName}"\n`;
            report += `  Search: arduino-cli lib search "${baseName}"\n`;
          }
          if (missing.length > 5) report += `\n... and ${missing.length - 5} more\n`;
          report += "\nArduino docs: https://support.arduino.cc/hc/en-us/articles/5145457742236\n\n";
        }
      }
    }

    // Check Python packages
    if (importsByLanguage.has("Python")) {
      const imports = importsByLanguage.get("Python");
      report += "=== Python Packages ===\n";
      report += `Imported modules: ${imports.size}\n`;
      const pipResult = await this.agent.executeCommand("pip list --format=json", workspaceFolder);
      if (pipResult.success) {
        try {
          const installed = JSON.parse(pipResult.output).map(p => p.name.toLowerCase());
          const missing = Array.from(imports).filter(m => !installed.includes(m.toLowerCase()));
          report += `Installed packages: ${installed.length}\n`;
          report += `Missing packages: ${missing.length}\n`;
          if (missing.length > 0) {
            report += "\nInstall missing packages:\n";
            for (const pkg of missing.slice(0, 10)) report += `  pip install ${pkg}\n`;
          } else {
            report += "✅ All Python packages are installed.\n";
          }
        } catch (_) {
          report += "⚠️ Could not parse pip output.\n";
        }
      } else {
        report += "⚠️ Could not check installed packages. Run 'pip list' manually.\n";
      }
      report += "\n";
    }

    // Check Node.js packages
    if (importsByLanguage.has("JavaScript/TypeScript")) {
      const imports = importsByLanguage.get("JavaScript/TypeScript");
      report += "=== Node.js Packages ===\n";
      report += `Imported modules: ${imports.size}\n`;
      const pkgJsonPath = path.join(workspaceFolder, "package.json");
      if (fsSync.existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(fsSync.readFileSync(pkgJsonPath, "utf8"));
          const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
          const missing = Array.from(imports).filter(m => !deps[m]);
          report += `Declared in package.json: ${Object.keys(deps).length}\n`;
          report += `Missing from package.json: ${missing.length}\n`;
          if (missing.length > 0) {
            report += "\nAdd missing packages:\n";
            for (const pkg of missing.slice(0, 10)) report += `  npm install ${pkg}\n`;
          } else {
            report += "✅ All imports are in package.json.\n";
          }
        } catch (_) {
          report += "⚠️ Could not parse package.json.\n";
        }
      } else {
        report += "⚠️ No package.json found.\n";
      }
      report += "\n";
    }

    // Check Java packages
    if (importsByLanguage.has("Java")) {
      const imports = importsByLanguage.get("Java");
      report += "=== Java Packages ===\n";
      report += `Imported packages: ${imports.size}\n`;
      report += `Top imports: ${Array.from(imports).slice(0, 10).join(", ")}\n`;
      report += "\nCheck Maven/Gradle dependencies manually.\n\n";
    }

    // Check Go modules
    if (importsByLanguage.has("Go")) {
      const imports = importsByLanguage.get("Go");
      report += "=== Go Modules ===\n";
      report += `Imported packages: ${imports.size}\n`;
      const goModPath = path.join(workspaceFolder, "go.mod");
      if (fsSync.existsSync(goModPath)) {
        report += "✅ go.mod found. Run 'go mod tidy' to sync dependencies.\n";
      } else {
        report += "⚠️ No go.mod found. Run 'go mod init' to create one.\n";
      }
      report += "\n";
    }

    // Check Rust crates
    if (importsByLanguage.has("Rust")) {
      const imports = importsByLanguage.get("Rust");
      report += "=== Rust Crates ===\n";
      report += `Imported crates: ${imports.size}\n`;
      const cargoPath = path.join(workspaceFolder, "Cargo.toml");
      if (fsSync.existsSync(cargoPath)) {
        report += "✅ Cargo.toml found. Run 'cargo build' to fetch dependencies.\n";
      } else {
        report += "⚠️ No Cargo.toml found.\n";
      }
      report += "\n";
    }

    // Check Ruby gems
    if (importsByLanguage.has("Ruby")) {
      const imports = importsByLanguage.get("Ruby");
      report += "=== Ruby Gems ===\n";
      report += `Required gems: ${imports.size}\n`;
      const gemfilePath = path.join(workspaceFolder, "Gemfile");
      if (fsSync.existsSync(gemfilePath)) {
        report += "✅ Gemfile found. Run 'bundle install' to install gems.\n";
      } else {
        report += "⚠️ No Gemfile found.\n";
      }
      report += "\n";
    }

    // Check PHP packages
    if (importsByLanguage.has("PHP")) {
      const imports = importsByLanguage.get("PHP");
      report += "=== PHP Packages ===\n";
      report += `Imported namespaces: ${imports.size}\n`;
      const composerPath = path.join(workspaceFolder, "composer.json");
      if (fsSync.existsSync(composerPath)) {
        report += "✅ composer.json found. Run 'composer install' to install packages.\n";
      } else {
        report += "⚠️ No composer.json found.\n";
      }
      report += "\n";
    }

    this._postMessage({ type: "stream", text: report });
    this._postMessage({ type: "done" });
  }

  async _collectLibraryImports(workspaceFolder) {
    const files = await vscode.workspace.findFiles(
      "**/*.{ino,pde,h,hpp,c,cpp,cc,cxx,py,js,jsx,ts,tsx,java,go,rs,rb,php}",
      "**/{.git,node_modules,build,dist,out,.arduinoIDE,.pio,__pycache__,target,vendor}/**"
    );
    const imports = new Map();
    for (const uri of files) {
      if (uri.scheme !== "file") continue;
      const relativePath = path.relative(workspaceFolder, uri.fsPath).replace(/\\/g, "/");
      try {
        const content = await fs.readFile(uri.fsPath, "utf8");
        const ext = path.extname(uri.fsPath).toLowerCase();
        imports.set(relativePath, this._extractImports(content, ext));
      } catch (_) {
        // Ignore unreadable files so the audit can continue.
      }
    }
    return imports;
  }

  _extractImports(content, ext) {
    const imports = new Set();
    const text = content || "";
    
    if ([".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".ino", ".pde"].includes(ext)) {
      // C/C++/Arduino: #include <Library.h> or #include "Library.h"
      const includeRegex = /^\s*#include\s*[<"]([^">]+)[">]/gm;
      let match;
      while ((match = includeRegex.exec(text)) !== null) {
        const header = (match[1] || "").trim();
        if (header) imports.add(header);
      }
    } else if (ext === ".py") {
      // Python: import module, from module import x, import module as alias
      const importRegex = /^\s*(?:from\s+([\w.]+)\s+)?import\s+([\w.,\s*]+)/gm;
      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const fromModule = (match[1] || "").trim();
        const importedItems = (match[2] || "").trim();
        if (fromModule) imports.add(fromModule.split(".")[0]);
        if (importedItems && !fromModule) {
          importedItems.split(",").forEach(item => {
            const module = item.trim().split(/\s+as\s+/)[0].trim();
            if (module && module !== "*") imports.add(module);
          });
        }
      }
    } else if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
      // JavaScript/TypeScript: import x from 'module', require('module')
      const importRegex = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(['"]([^'"]+)['"]\))/g;
      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const module = (match[1] || match[2] || "").trim();
        if (module && !module.startsWith(".") && !module.startsWith("/")) {
          imports.add(module.split("/")[0]);
        }
      }
    } else if (ext === ".java") {
      // Java: import package.Class;
      const importRegex = /^\s*import\s+([\w.]+);/gm;
      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const pkg = (match[1] || "").trim();
        if (pkg && !pkg.startsWith("java.")) {
          imports.add(pkg.split(".")[0]);
        }
      }
    } else if (ext === ".go") {
      // Go: import "package" or import ("package1" "package2")
      const importRegex = /import\s+(?:\(([^)]+)\)|"([^"]+)")/g;
      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const block = match[1];
        const single = match[2];
        if (block) {
          block.split("\n").forEach(line => {
            const pkgMatch = line.match(/"([^"]+)"/);
            if (pkgMatch) imports.add(pkgMatch[1].split("/").pop());
          });
        } else if (single) {
          imports.add(single.split("/").pop());
        }
      }
    } else if (ext === ".rs") {
      // Rust: use crate::module or extern crate name
      const useRegex = /(?:use\s+([\w:]+)|extern\s+crate\s+(\w+))/g;
      let match;
      while ((match = useRegex.exec(text)) !== null) {
        const module = (match[1] || match[2] || "").trim();
        if (module) imports.add(module.split("::")[0]);
      }
    } else if (ext === ".rb") {
      // Ruby: require 'gem' or gem 'name'
      const requireRegex = /(?:require|gem)\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = requireRegex.exec(text)) !== null) {
        const gem = (match[1] || "").trim();
        if (gem) imports.add(gem.split("/")[0]);
      }
    } else if (ext === ".php") {
      // PHP: use Namespace\Class or require/include
      const useRegex = /(?:use\s+([\w\\]+)|(?:require|include)(?:_once)?\s*\(?['"]([^'"]+)['"])/g;
      let match;
      while ((match = useRegex.exec(text)) !== null) {
        const ns = (match[1] || match[2] || "").trim();
        if (ns) imports.add(ns.split("\\")[0].split("/")[0]);
      }
    }
    
    return Array.from(imports);
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
        if (candidate && !/^library$/i.test(candidate)) names.add(candidate);
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
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

  async _searchArduinoLibraryCandidates(workspaceFolder, term) {
    const safeTerm = String(term || "").replace(/"/g, "").trim();
    if (!safeTerm) return [];
    const searchCommand = `arduino-cli lib search "${safeTerm}" --format json`;
    const result = await this.agent.executeCommand(searchCommand, workspaceFolder);
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
    return candidateToken.includes(headerToken) || headerToken.includes(candidateToken);
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
        headers: { "User-Agent": "Code-Janitor/1.0" },
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
      if (!summary && !sourceUrl && related.length === 0) return null;
      return { summary, sourceUrl, related };
    } catch (_) {
      return null;
    }
  }

  _getCurrentFileEditor() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.scheme === "file") {
      this.lastActiveEditor = activeEditor;
      return activeEditor;
    }
    if (this.lastActiveEditor && this.lastActiveEditor.document.uri.scheme === "file") {
      return this.lastActiveEditor;
    }
    return null;
  }

  _validateGeneratedFileContent(originalContent, nextContent, language, relativePath) {
    const candidate = typeof nextContent === "string" ? nextContent.trim() : "";
    const original = typeof originalContent === "string" ? originalContent : "";

    if (!candidate) {
      return { ok: false, reason: "AI returned an empty file." };
    }

    const placeholderPatterns = [
      /\.\.\.\s*\(unchanged/i,
      /unchanged\s+(html|css|javascript|js|content|code)/i,
      /placeholder/i,
      /your code here/i,
      /existing (html|css|javascript|js|code)/i
    ];

    if (placeholderPatterns.some((pattern) => pattern.test(candidate))) {
      return {
        ok: false,
        reason: `AI returned placeholder content for ${relativePath || "the file"} instead of a full file.`
      };
    }

    if (original.trim() && candidate === original.trim()) {
      return { ok: false, reason: "AI did not produce any file changes." };
    }

    if (language === "html") {
      const hasHtmlShell =
        /<!doctype html>/i.test(candidate) &&
        /<html[\s>]/i.test(candidate) &&
        /<body[\s>]/i.test(candidate);

      if (!hasHtmlShell) {
        return {
          ok: false,
          reason: "AI response does not look like a complete HTML document."
        };
      }
    }

    return { ok: true };
  }

  async _runActiveSyntaxFix(workspaceFolder) {
    const activeEditor = this._getCurrentFileEditor();
    if (!activeEditor || activeEditor.document.uri.scheme !== "file") {
      this._postMessage({
        type: "error",
        text: "Open the file you want to repair, then ask me to fix its syntax errors."
      });
      this._postMessage({ type: "done" });
      return;
    }

    const fileName = activeEditor.document.fileName;
    const fileContent = activeEditor.document.getText();
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder, fileName).replace(/\\/g, "/")
      : path.basename(fileName);

    this._postMessage({
      type: "status",
      text: `Analyzing ${relativePath} for syntax errors...`
    });
    this._postMessage({ type: "thinking" });

    // Run syntax check first
    const syntaxCheck = await this.agent._runSyntaxCheck(
      fileName.replace(/\\/g, "/"),
      workspaceFolder,
      fileContent
    );

    if (!syntaxCheck) {
      this._postMessage({
        type: "error",
        text: "Syntax checking is not supported for this file type."
      });
      this._postMessage({ type: "done" });
      return;
    }

    if (syntaxCheck.skipped) {
      this._postMessage({
        type: "status",
        text: syntaxCheck.output
      });
      this._postMessage({ type: "done" });
      return;
    }

    if (syntaxCheck.success) {
      this._postMessage({
        type: "stream",
        text: `✅ No syntax errors found in ${relativePath}.`
      });
      this._postMessage({ type: "done" });
      return;
    }

    // Syntax errors found - use AI to fix
    let errorOutput = syntaxCheck.error || syntaxCheck.output || "Unknown syntax error";
    
    // Clean up error output: remove timestamps and date/time patterns
    errorOutput = errorOutput
      .replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g, "") // YYYY-MM-DD HH:MM:SS
      .replace(/\d{2}:\d{2}:\d{2}/g, "") // HH:MM:SS
      .replace(/\d{2}\/\d{2}\/\d{4}/g, "") // MM/DD/YYYY
      .replace(/\[\d{4}-\d{2}-\d{2}.*?\]/g, "") // [YYYY-MM-DD ...]
      .replace(/\s{2,}/g, " ") // collapse multiple spaces
      .trim();
    
    this._postMessage({
      type: "stream",
      text: `❌ Syntax errors detected:\n${errorOutput}\n\nGenerating fix...`
    });

    const ext = path.extname(fileName).toLowerCase();
    const langMap = {
      ".js": "javascript",
      ".jsx": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".py": "python",
      ".java": "java",
      ".c": "c",
      ".cpp": "cpp",
      ".h": "c",
      ".hpp": "cpp"
    };
    const language = langMap[ext] || "code";

    const fixPrompt = `Fix the syntax errors in this ${language} file. Return exactly one FILE action with the complete corrected file.\n\nFile: ${relativePath}\n\nSyntax errors:\n${errorOutput}\n\nCurrent file content:\n\`\`\`${language}\n${fileContent}\n\`\`\``;

    const runtimeConfig = await this._getEffectiveAiConfig();
    const response = await this.agent.chat(
      fixPrompt,
      workspaceFolder,
      (chunk) => { this._postMessage({ type: "stream", text: chunk }); },
      null,
      { mode: "heavy", runtimeConfig }
    );

    if (response.error) {
      this._postMessage({ type: "error", text: response.error });
      this._postMessage({ type: "done" });
      return;
    }

    const fileAction = (response.actions || []).find(a => a.type === "file" && a.content);
    if (!fileAction) {
      this._postMessage({
        type: "error",
        text: "AI did not generate a file fix. Try rephrasing your request or use a different AI model."
      });
      this._postMessage({ type: "done" });
      return;
    }

    const generatedContentCheck = this._validateGeneratedFileContent(
      fileContent,
      fileAction.content,
      language,
      relativePath
    );
    if (!generatedContentCheck.ok) {
      this._postMessage({
        type: "error",
        text: generatedContentCheck.reason
      });
      this._postMessage({ type: "done" });
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
      this._postMessage({
        type: "error",
        text: "Failed to apply the fix to the editor."
      });
      this._postMessage({ type: "done" });
      return;
    }

    await activeEditor.document.save();

    // Verify the fix
    const verifyCheck = await this.agent._runSyntaxCheck(
      fileName.replace(/\\/g, "/"),
      workspaceFolder,
      activeEditor.document.getText()
    );
    if (verifyCheck && verifyCheck.success) {
      this._postMessage({
        type: "stream",
        text: "\n\n✅ Syntax errors fixed successfully!"
      });
    } else {
      this._postMessage({
        type: "stream",
        text: "\n\n⚠️ Fix applied, but some syntax issues may remain. Please review the changes."
      });
    }

    this._postMessage({ type: "done" });
  }

  _getHtmlContent(webview) {
    try {
      const htmlPath = this._getChatPanelHtmlPath();
      console.log("[ChatPanel] Loading HTML from:", htmlPath);
      const html = fsSync.readFileSync(htmlPath, "utf8");
      const logoPath = this._getLogoAssetPath();
      const logoUri = logoPath && webview
        ? webview.asWebviewUri(vscode.Uri.file(logoPath)).toString()
        : "";
      const hydratedHtml = html
        .replace(/__CSP_SOURCE__/g, webview?.cspSource || "")
        .replace(/__LOGO_URI__/g, logoUri);
      console.log("[ChatPanel] HTML loaded, length:", html.length);
      return hydratedHtml;
    } catch (error) {
      console.error("[ChatPanel] Failed to load HTML:", error);
      const attemptedPaths = this._getChatPanelHtmlCandidates().join(" | ");
      return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { 
      background: #1e1e1e; 
      color: #fff; 
      font-family: sans-serif; 
      padding: 20px; 
    }
  </style>
</head>
<body>
  <h1>Error Loading Chat Panel</h1>
  <p>Failed to load chat-panel.html: ${error.message}</p>
  <p>Attempted paths: ${attemptedPaths}</p>
</body>
</html>`;
    }
  }

  resolveWebviewView(webviewView) {
    console.log("[ChatPanel] Resolving sidebar chat view");
    this.sidebarView = webviewView;
    this.lastActiveEditor = vscode.window.activeTextEditor || this.lastActiveEditor;
    this.agent.setActiveEditor(this.lastActiveEditor);
    this._attachWebviewHost(webviewView, { kind: "sidebar" });
    webviewView.onDidDispose(() => {
      if (this.sidebarView === webviewView) {
        console.log("[ChatPanel] Sidebar view disposed");
        this.sidebarView = null;
      }
    });
  }

  _attachWebviewHost(host, { kind }) {
    if (!host || !host.webview) return;
    console.log(`[ChatPanel] Attaching ${kind} webview host`);
    host.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, "src", "ai-agent")),
        vscode.Uri.file(__dirname)
      ]
    };
    this._setupMessageHandler(host.webview);
    host.webview.html = this._getHtmlContent(host.webview);
  }

  _postMessage(message) {
    const targets = [this.panel?.webview, this.sidebarView?.webview].filter(Boolean);
    const seen = new Set();
    for (const webview of targets) {
      if (seen.has(webview)) continue;
      seen.add(webview);
      webview.postMessage(message);
    }
  }

  _getChatPanelHtmlPath() {
    const candidates = this._getChatPanelHtmlCandidates();
    const existingPath = candidates.find(candidate => fsSync.existsSync(candidate));
    if (existingPath) return existingPath;

    throw new Error(`chat-panel.html not found. Attempted paths: ${candidates.join(", ")}`);
  }

  _getChatPanelHtmlCandidates() {
    return [
      path.join(this.context.extensionPath, "src", "ai-agent", "chat-panel.html"),
      path.join(__dirname, "chat-panel.html")
    ];
  }

  _getLogoAssetPath() {
    const candidates = [
      path.join(this.context.extensionPath, "src", "ai-agent", "logo.png"),
      path.join(__dirname, "logo.png")
    ];
    return candidates.find((candidate) => fsSync.existsSync(candidate)) || null;
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

  _getCustomProvidersStateKey() {
    return "codeJanitor.ai.customProviders";
  }

  _getSelectedProviderStateKey() {
    return "codeJanitor.ai.selectedProvider";
  }

  _isBuiltInProvider(provider) {
    return BUILT_IN_PROVIDERS.has(provider);
  }

  _slugifyProviderName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  _normalizeCustomProvider(input) {
    const name = String(input?.name || "").trim();
    const baseUrl = String(input?.baseUrl || "").trim().replace(/\/+$/, "");
    const defaultModel = String(input?.defaultModel || input?.model || "").trim();
    const apiKeyLink = String(input?.apiKeyLink || "").trim();
    const extraModels = Array.isArray(input?.models)
      ? input.models
      : String(input?.models || "")
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean);
    const models = Array.from(new Set([defaultModel, ...extraModels].filter(Boolean)));
    const slugBase = this._slugifyProviderName(name);

    if (!name || !baseUrl || !defaultModel || !slugBase) {
      return null;
    }

    return {
      id: input?.id || `custom:${slugBase}`,
      name,
      baseUrl,
      defaultModel,
      models,
      apiKeyLink,
      protocol: "openai"
    };
  }

  _getCustomProviders() {
    const providers = this.context.globalState.get(this._getCustomProvidersStateKey(), []);
    return Array.isArray(providers) ? providers.filter(Boolean) : [];
  }

  async _saveCustomProviders(providers) {
    await this.context.globalState.update(this._getCustomProvidersStateKey(), providers);
  }

  _getCustomProviderById(providerId) {
    return this._getCustomProviders().find((provider) => provider.id === providerId) || null;
  }

  _getSelectedProviderId() {
    return this.context.globalState.get(this._getSelectedProviderStateKey(), "");
  }

  async _setSelectedProviderId(provider) {
    await this.context.globalState.update(this._getSelectedProviderStateKey(), provider || "");
  }

  _resolveCustomProviderChatUrl(baseUrl) {
    const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!normalized) return "";
    if (/\/chat\/completions$/i.test(normalized)) return normalized;
    if (/\/v1$/i.test(normalized)) return `${normalized}/chat/completions`;
    return `${normalized}/v1/chat/completions`;
  }

  async _getProviderPresence() {
    const builtInPresence = await this._restoreApiKeys();
    const customPresence = {};
    for (const provider of this._getCustomProviders()) {
      const key = this._sanitizeApiKey(
        await this.context.secrets.get(this._getApiSecretKey(provider.id))
      );
      customPresence[provider.id] = !!key;
    }
    return { ...builtInPresence, ...customPresence };
  }

  _buildProviderCatalog() {
    return [
      { id: "ollama", name: "Ollama", builtin: true, requiresKey: false, models: [] },
      { id: "groq", name: "Groq", builtin: true, requiresKey: true, models: MODELS_BY_PROVIDER.groq || [] },
      { id: "openrouter", name: "OpenRouter", builtin: true, requiresKey: true, models: MODELS_BY_PROVIDER.openrouter || [] },
      { id: "anthropic", name: "Anthropic", builtin: true, requiresKey: true, models: MODELS_BY_PROVIDER.anthropic || [] },
      { id: "nvidia", name: "NVIDIA NIM", builtin: true, requiresKey: true, models: MODELS_BY_PROVIDER.nvidia || [] },
      ...this._getCustomProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        builtin: false,
        requiresKey: true,
        apiKeyLink: provider.apiKeyLink || "",
        models: provider.models || [],
        defaultModel: provider.defaultModel,
        protocol: provider.protocol || "openai"
      }))
    ];
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
    if (!configKey) {
      return this._sanitizeApiKey(
        await this.context.secrets.get(this._getApiSecretKey(provider))
      );
    }

    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    const configValue = this._sanitizeApiKey(cfg.get(configKey, ""));
    const secretValue = this._sanitizeApiKey(
      await this.context.secrets.get(this._getApiSecretKey(provider))
    );

    if (secretValue) return secretValue;
    return configValue;
  }

  async _getEffectiveAiConfig() {
    const config = this.agent.getConfig();
    const selectedProvider = this._getSelectedProviderId() || config.provider;
    const customProvider = this._isBuiltInProvider(selectedProvider)
      ? null
      : this._getCustomProviderById(selectedProvider);
    console.log("[ChatPanel] Base config from agent:", {
      provider: selectedProvider,
      model: config.model,
      hasGroqKey: !!config.groqApiKey,
      hasOpenrouterKey: !!config.openrouterApiKey,
      hasAnthropicKey: !!config.anthropicApiKey,
      hasNvidiaKey: !!config.nvidiaApiKey
    });

    const [groqApiKey, openrouterApiKey, anthropicApiKey, nvidiaApiKey] = await Promise.all([
      this._getStoredApiKey("groq"),
      this._getStoredApiKey("openrouter"),
      this._getStoredApiKey("anthropic"),
      this._getStoredApiKey("nvidia")
    ]);

    console.log("[ChatPanel] Retrieved API keys:", {
      groq: groqApiKey ? `${groqApiKey.substring(0, 10)}...` : "(empty)",
      openrouter: openrouterApiKey ? `${openrouterApiKey.substring(0, 10)}...` : "(empty)",
      anthropic: anthropicApiKey ? `${anthropicApiKey.substring(0, 10)}...` : "(empty)",
      nvidia: nvidiaApiKey ? `${nvidiaApiKey.substring(0, 10)}...` : "(empty)"
    });

    // CRITICAL FIX: If using cloud provider without API key, force to ollama
    const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
    if (selectedProvider === "groq" && !groqApiKey) {
      console.log("[ChatPanel] CRITICAL: Groq selected but no API key! Forcing to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
      await this._setSelectedProviderId("ollama");
      config.provider = "ollama";
      config.model = "qwen2.5-coder:1.5b";
    } else if (selectedProvider === "openrouter" && !openrouterApiKey) {
      console.log("[ChatPanel] CRITICAL: OpenRouter selected but no API key! Forcing to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
      await this._setSelectedProviderId("ollama");
      config.provider = "ollama";
      config.model = "qwen2.5-coder:1.5b";
    } else if (selectedProvider === "anthropic" && !anthropicApiKey) {
      console.log("[ChatPanel] CRITICAL: Anthropic selected but no API key! Forcing to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
      await this._setSelectedProviderId("ollama");
      config.provider = "ollama";
      config.model = "qwen2.5-coder:1.5b";
    } else if (selectedProvider === "nvidia" && !nvidiaApiKey) {
      console.log("[ChatPanel] CRITICAL: NVIDIA selected but no API key! Forcing to ollama");
      await cfg.update("provider", "ollama", vscode.ConfigurationTarget.Global);
      await this._setSelectedProviderId("ollama");
      config.provider = "ollama";
      config.model = "qwen2.5-coder:1.5b";
    }

    // Ensure config reflects stored secrets to avoid empty key overwrites
    if (groqApiKey && config.groqApiKey !== groqApiKey) {
      const target = this._getConfigTargetForKey("groqApiKey");
      await cfg.update("groqApiKey", groqApiKey, target);
    }
    if (openrouterApiKey && config.openrouterApiKey !== openrouterApiKey) {
      const target = this._getConfigTargetForKey("openrouterApiKey");
      await cfg.update("openrouterApiKey", openrouterApiKey, target);
    }
    if (anthropicApiKey && config.anthropicApiKey !== anthropicApiKey) {
      const target = this._getConfigTargetForKey("anthropicApiKey");
      await cfg.update("anthropicApiKey", anthropicApiKey, target);
    }
    if (nvidiaApiKey && config.nvidiaApiKey !== nvidiaApiKey) {
      const target = this._getConfigTargetForKey("nvidiaApiKey");
      await cfg.update("nvidiaApiKey", nvidiaApiKey, target);
    }

    if (customProvider) {
      const customApiKey = await this._getStoredApiKey(customProvider.id);
      const savedModel = this._getSavedProviderModel(customProvider.id);
      return {
        ...config,
        provider: customProvider.id,
        model: savedModel || customProvider.defaultModel,
        customProvider: {
          ...customProvider,
          apiKey: customApiKey,
          chatCompletionsUrl: this._resolveCustomProviderChatUrl(customProvider.baseUrl)
        }
      };
    }

    const effectiveConfig = {
      ...config,
      provider: selectedProvider,
      groqApiKey,
      openrouterApiKey,
      anthropicApiKey,
      nvidiaApiKey
    };

    console.log("[ChatPanel] Effective config for provider", config.provider, ":", {
      hasKey: config.provider === "groq" ? !!groqApiKey :
              config.provider === "openrouter" ? !!openrouterApiKey :
              config.provider === "anthropic" ? !!anthropicApiKey :
              config.provider === "nvidia" ? !!nvidiaApiKey : false
    });

    return effectiveConfig;
  }

  async _persistApiKey(provider, apiKey) {
    try {
      const configKey = this._getApiKeyConfigKey(provider);
      const sanitized = this._sanitizeApiKey(apiKey);
      if (!sanitized) {
        console.log(`[ChatPanel] Skipping persist for ${provider}: configKey=${configKey}, sanitized=${!!sanitized}`);
        return;
      }
      
      console.log(`[ChatPanel] Persisting API key for ${provider}, length: ${sanitized.length}, preview: ${sanitized.substring(0, 10)}...`);
      
      // Store in secrets first (this is safe and won't corrupt settings.json)
      await this.context.secrets.store(this._getApiSecretKey(provider), sanitized);
      console.log(`[ChatPanel] Stored in secrets: ${this._getApiSecretKey(provider)}`);
      
      if (!configKey) {
        return;
      }

      // CRITICAL: Validate settings.json before writing to it
      const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
      
      // Read current settings to ensure they're valid
      try {
        const currentValue = cfg.get(configKey, "");
        console.log(`[ChatPanel] Current ${configKey} value exists:`, !!currentValue);
      } catch (readError) {
        console.error("[ChatPanel] Settings file is corrupted, skipping config update:", readError);
        // Don't try to write to corrupted settings - just use secrets
        return;
      }
      
      // Try to update config (but don't fail if settings.json is corrupted)
      try {
        await cfg.update(configKey, sanitized, vscode.ConfigurationTarget.Global);
        
        // Verify it was saved
        const verify = cfg.get(configKey, "");
        console.log(`[ChatPanel] Verified ${provider} key saved in config:`, !!verify, `length: ${verify ? verify.length : 0}`);
      } catch (writeError) {
        console.error("[ChatPanel] Failed to write to settings.json (file may be corrupted):", writeError);
        console.log("[ChatPanel] API key is still stored in secrets and will work");
        // Don't throw - the key is in secrets which is enough
      }
    } catch (error) {
      console.error(`[ChatPanel] Error persisting API key for ${provider}:`, error);
      throw error; // Re-throw so caller knows it failed
    }
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

  async _addCustomProvider(definition, apiKey) {
    const normalized = this._normalizeCustomProvider(definition);
    const sanitizedKey = this._sanitizeApiKey(apiKey);
    if (!normalized) {
      throw new Error("Provider name, base URL, and default model are required.");
    }
    if (!sanitizedKey) {
      throw new Error("An API key is required for a custom provider.");
    }

    const providers = this._getCustomProviders().filter((provider) => provider.id !== normalized.id);
    providers.push(normalized);
    await this._saveCustomProviders(providers);
    await this._persistApiKey(normalized.id, sanitizedKey);
    await this._setSelectedProviderId(normalized.id);
    this._saveProviderModel(normalized.id, normalized.defaultModel);
    return normalized;
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

  _shouldInspectPreviewRequest(message) {
    const text = String(message || "");
    return /\b(preview|render|runtime|page|ui)\b/i.test(text) &&
      /\b(inspect|study|analy[sz]e|check|debug|fix|issue|problem|error|broken)\b/i.test(text);
  }

  _previewDiagnosticsHasIssues(diagnostics) {
    if (!diagnostics) return false;
    return (
      (diagnostics.errors?.length || 0) > 0 ||
      (diagnostics.warnings?.length || 0) > 0 ||
      (diagnostics.resourceFailures?.length || 0) > 0
    );
  }

  _summarizePreviewDiagnostics(diagnostics) {
    if (!diagnostics) {
      return "Preview inspection finished, but no diagnostics were returned.";
    }

    const parts = [];
    if (diagnostics.ready) {
      parts.push("preview loaded");
    } else {
      parts.push("preview did not confirm readiness");
    }

    if (diagnostics.title) {
      parts.push(`title: ${diagnostics.title}`);
    }

    if (diagnostics.bodyTextExcerpt) {
      parts.push(`content sample: ${diagnostics.bodyTextExcerpt}`);
    }

    const errorCount = diagnostics.errors?.length || 0;
    const warningCount = diagnostics.warnings?.length || 0;
    const resourceCount = diagnostics.resourceFailures?.length || 0;
    parts.push(
      `issues: ${errorCount} error(s), ${warningCount} warning(s), ${resourceCount} resource failure(s)`
    );

    const samples = [
      ...(diagnostics.errors || []).slice(0, 2).map((entry) => entry.message || entry.stack || "Unknown error"),
      ...(diagnostics.resourceFailures || []).slice(0, 2).map((entry) => entry.url ? `${entry.message}: ${entry.url}` : entry.message)
    ].filter(Boolean);

    if (samples.length > 0) {
      parts.push(`sample: ${samples.join(" | ")}`);
    }

    return `Preview inspection summary: ${parts.join(". ")}.`;
  }

  async _fixActiveFileFromPreviewDiagnostics(userRequest, workspaceFolder, diagnostics, runtimeConfig) {
    const activeEditor = this.lastActiveEditor || vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.document.uri.scheme !== "file") {
      return { success: false, error: "Open the file you want me to repair before preview inspection." };
    }

    const document = activeEditor.document;
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder, document.fileName).replace(/\\/g, "/")
      : path.basename(document.fileName);
    const language = this._getLanguageIdForPath(document.fileName);
    const diagnosticsJson = JSON.stringify(diagnostics, null, 2).slice(0, 8000);

    const fixPrompt = `The user asked: "${userRequest}".

You inspected the live preview for "${relativePath}" and collected runtime/render diagnostics. Fix the active file so the preview loads cleanly and preserves the user's intent. Return exactly one FILE action for "${relativePath}" with the complete updated file. Do not output explanations.

Preview diagnostics:
\`\`\`json
${diagnosticsJson}
\`\`\`

Current file content:
\`\`\`${language}
${document.getText()}
\`\`\``;

    const response = await this.agent.chat(
      fixPrompt,
      workspaceFolder,
      null,
      null,
      { mode: "heavy", runtimeConfig }
    );

    if (response.error) {
      return { success: false, error: response.error };
    }

    const fileAction = (response.actions || []).find((action) =>
      action.type === "file" &&
      typeof action.content === "string" &&
      action.content.trim().length > 0
    );

    if (!fileAction) {
      return {
        success: false,
        error: "AI did not return a file update after preview inspection."
      };
    }

    const result = await this._applyToEditor(activeEditor, fileAction.content);
    if (!result.success) {
      return result;
    }

    await document.save();

    let verification = null;
    try {
      verification = await vscode.commands.executeCommand("codeJanitor.inspectLivePreview");
    } catch (error) {
      verification = { success: false, error: error.message };
    }

    return {
      success: true,
      path: relativePath,
      verification
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
    if (!fsSync.existsSync(packageJsonPath)) return {};
    try {
      const raw = fsSync.readFileSync(packageJsonPath, "utf8");
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
      { script: "lint", command: "npm run lint", priority: 1 },
      { script: "typecheck", command: "npm run typecheck", priority: 1 },
      { script: "build", command: "npm run build", priority: 2 },
      { script: "test", command: "npm test", priority: 3 }
    ];

    // Return all available checks, prioritized
    return ordered
      .filter((item) => !!scripts[item.script])
      .sort((a, b) => a.priority - b.priority)
      .map((item) => item.command);
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

  _isLibraryAuditRequest(message) {
    const text = message || "";
    return (
      /\b(check|scan|find|compare|audit|verify)\b.*\b(librar(?:y|ies)|#include|import(?:ed|s)?)\b/i.test(text) &&
      /\b(installed|missing|not installed|install|imported|included)\b/i.test(text)
    ) || /\bwhich libraries are installed\b/i.test(text);
  }

  _isSyntaxFixRequest(message) {
    const text = message || "";
    return (
      /\b(fix|repair|resolve|correct|patch)\b/i.test(text) &&
      /\b(syntax error|syntax errors|syntax issue|syntax issues|parse error|compile error|compile errors)\b/i.test(text)
    ) || /\bfix\b.*\b(current|active|open|this)\s+(file|tab|editor)\b/i.test(text);
  }

  _shouldPrepareWorkspaceContext(intent, message) {
    if (this.chatMode === "heavy" || this.chatMode === "deep") return true;

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
      return { success: true, checks: [] };
    }

    const results = { success: true, checks: [], errors: [] };

    // Categorize changed files by type
    const fileTypes = {
      js: changedFiles.filter(file => /\.(js|jsx|ts|tsx)$/i.test(file)),
      py: changedFiles.filter(file => /\.py$/i.test(file)),
      java: changedFiles.filter(file => /\.java$/i.test(file)),
      c: changedFiles.filter(file => /\.(c|cpp|h|hpp)$/i.test(file))
    };

    // Run syntax checks for each file type
    if (fileTypes.py.length > 0) {
      this._postMessage({
        type: "status",
        text: `🔍 Verifying Python syntax (${fileTypes.py.length} file(s))...`
      });
      for (const file of fileTypes.py) {
        const fullPath = path.join(workspaceFolder, file);
        const result = await this.agent._runSyntaxCheck(fullPath, workspaceFolder, null);
        if (result && !result.success && !result.skipped) {
          results.success = false;
          results.errors.push({ file, error: result.error || result.output, type: "syntax" });
          this._postMessage({
            type: "status",
            text: `❌ Python syntax error in ${file}:\n${result.error || result.output}`
          });
        } else if (result && result.success) {
          results.checks.push({ file, check: "python-syntax", passed: true });
          this._postMessage({
            type: "status",
            text: `✅ Python syntax OK: ${file}`
          });
        }
      }
    }

    if (fileTypes.java.length > 0) {
      this._postMessage({
        type: "status",
        text: `🔍 Verifying Java syntax (${fileTypes.java.length} file(s))...`
      });
      for (const file of fileTypes.java) {
        const fullPath = path.join(workspaceFolder, file);
        const result = await this.agent._runSyntaxCheck(fullPath, workspaceFolder, null);
        if (result && !result.success && !result.skipped) {
          results.success = false;
          results.errors.push({ file, error: result.error || result.output, type: "syntax" });
          this._postMessage({
            type: "status",
            text: `❌ Java syntax error in ${file}:\n${result.error || result.output}`
          });
        } else if (result && result.success) {
          results.checks.push({ file, check: "java-syntax", passed: true });
          this._postMessage({
            type: "status",
            text: `✅ Java syntax OK: ${file}`
          });
        }
      }
    }

    if (fileTypes.c.length > 0) {
      this._postMessage({
        type: "status",
        text: `⚠️ C/C++ files changed: ${fileTypes.c.join(", ")}. Run compiler manually to verify syntax.`
      });
    }

    // Run npm scripts only for JS/TS files
    if (fileTypes.js.length === 0) {
      this._postMessage({
        type: "status",
        text: "✅ Verification complete (no JS/TS files changed)"
      });
      return results;
    }

    const commands = this._getPostEditVerificationCommands(workspaceFolder);
    if (commands.length === 0) {
      this._postMessage({
        type: "status",
        text: "✅ Verification complete (no npm scripts configured)"
      });
      return results;
    }

    this._postMessage({
      type: "status",
      text: `🔍 Running ${commands.length} verification check(s): ${commands.join(", ")}`
    });

    // Run all checks, don't stop on first failure
    for (const command of commands) {
      const validation = this.agent.validateCommand(command);
      if (!validation.allowed) {
        this._postMessage({
          type: "status",
          text: `⚠️ Skipped check (${command}): ${validation.reason}`
        });
        continue;
      }

      this._postMessage({
        type: "status",
        text: `Running: ${command}...`
      });
      const result = await this.agent.executeCommand(command, workspaceFolder);
      if (result.success) {
        results.checks.push({ command, passed: true });
        this._postMessage({
          type: "status",
          text: `✅ ${command} passed`
        });
      } else {
        results.success = false;
        results.errors.push({ command, error: result.error || result.output, type: "npm" });
        this._postMessage({
          type: "status",
          text: `❌ ${command} failed:\n${this._summarizeCommandOutput(result.error || result.output)}`
        });
        // Continue to next check instead of breaking
      }
    }

    // Summary
    if (results.success) {
      this._postMessage({
        type: "status",
        text: `✅ All verification checks passed (${results.checks.length} checks)`
      });
    } else {
      this._postMessage({
        type: "status",
        text: `⚠️ Verification completed with ${results.errors.length} error(s). Review changes before committing.`
      });
    }

    return results;
  }

  async _fetchAndSendModels(forceProvider = null) {
    let provider = forceProvider || "ollama";
    // Only needed for Ollama — other providers populate models client-side
    try {
      const config = await this._getEffectiveAiConfig();
      provider = forceProvider || config.provider;
      if (provider !== "ollama" && provider !== "nvidia") return;
      const models = await this.agent.getAvailableModelsForProvider(provider, {
        ollamaUrl: config.ollamaUrl,
        nvidiaApiKey: config.nvidiaApiKey,
        timeoutMs: 15_000,
        forceRefresh: provider === "nvidia"
      });
      if (models.length > 0 && this.panel) {
        this._postMessage({ type: "setModelOptions", models, provider });
        return;
      }
      if (this.panel) {
        this._postMessage({
          type: "status",
          text:
            provider === "nvidia"
              ? "NVIDIA model discovery failed. Showing fallback models."
              : "Ollama responded, but no models were returned. Showing defaults."
        });
      }
    } catch (err) {
      if (this.panel) {
        this._postMessage({
          type: "status",
          text: `${provider === "nvidia" ? "NVIDIA" : "Ollama"} model list failed: ${err.message || err}. Showing defaults.`
        });
      }
    }
    // Ollama unreachable or no models — show defaults
    if (this.panel) {
      this._postMessage({
        type: "setModelOptions",
        models:
          provider === "nvidia"
            ? MODELS_BY_PROVIDER.nvidia
            : ["qwen2.5-coder:1.5b", "codellama:latest", "llama3:latest"],
        provider: provider === "nvidia" ? "nvidia" : "ollama"
      });
    }
  }

  _getDefaultModelForProvider(provider) {
    if (provider === "ollama") return "qwen2.5-coder:1.5b";
    if (provider === "nvidia") return "meta/llama-3.1-8b-instruct";
    const customProvider = this._getCustomProviderById(provider);
    if (customProvider?.defaultModel) return customProvider.defaultModel;
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

  _getModelConfigKey(provider) {
    return provider === "nvidia" ? "nvidiaModel" : "model";
  }

  _normalizeModelForProvider(provider, model) {
    const raw = typeof model === "string" ? model.trim() : "";
    const defaultModel = this._getDefaultModelForProvider(provider);
    if (!raw) return defaultModel;

    if (provider === "nvidia") {
      return this.agent._sanitizeNvidiaModel(raw);
    }

    const customProvider = this._getCustomProviderById(provider);
    const allowedModels = customProvider?.models?.length
      ? customProvider.models
      : MODELS_BY_PROVIDER[provider];
    if (Array.isArray(allowedModels) && allowedModels.length > 0) {
      return allowedModels.includes(raw) ? raw : defaultModel;
    }

    return raw;
  }

  async _setProviderModel(provider, model) {
    const nextModel = this._normalizeModelForProvider(provider, model);
    if (this._isBuiltInProvider(provider)) {
      await this._updateAiConfig(this._getModelConfigKey(provider), nextModel);

      // Keep the generic model in sync so status UI and older code paths stay aligned.
      await this._updateAiConfig("model", nextModel);
    }

    this._saveProviderModel(provider, nextModel);
    return nextModel;
  }

  async _searchYouTube(query) {
    try {
      console.log(`[YouTube] Searching for: ${query}`);
      
      // Scrape YouTube search results page
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      
      try {
        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
                      videoTitles.push(videoRenderer.title?.runs?.[0]?.text || "YouTube Video");
                      if (videoIds.length >= 5) break;
                    }
                  }
                  if (videoIds.length >= 5) break;
                }
              }
            } catch (parseError) {
              console.log("[YouTube] Failed to parse ytInitialData:", parseError.message);
            }
          }
          
          // Method 2: Regex fallback - extract from watch URLs
          if (videoIds.length === 0) {
            const watchMatches = html.matchAll(/\/watch\?v=([a-zA-Z0-9_-]{11})/g);
            const seenIds = new Set();
            for (const match of watchMatches) {
              if (!seenIds.has(match[1])) {
                videoIds.push(match[1]);
                videoTitles.push("YouTube Video");
                seenIds.add(match[1]);
                if (videoIds.length >= 5) break;
              }
            }
          }
          
          if (videoIds.length > 0) {
            console.log(`[YouTube] Scraped ${videoIds.length} videos from search page`);
            const videos = videoIds.map((id, index) => ({
              videoId: id,
              title: videoTitles[index] || "YouTube Video",
              url: `https://www.youtube.com/watch?v=${id}`
            }));
            return { videos };
          }
        }
      } catch (scrapeError) {
        console.log("[YouTube] Scraping failed:", scrapeError.message);
      }
      
      // Fallback: Try Invidious API
      const instances = ["https://invidious.io.lol", "https://inv.tux.pizza"];
      
      for (const instance of instances) {
        try {
          const apiUrl = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort=relevance`;
          const apiResponse = await fetch(apiUrl, {
            headers: { "User-Agent": "Code-Janitor/1.0" },
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
      console.log("[YouTube] All methods failed, using search link");
      const videos = [{
        title: `Search "${query}" on YouTube`,
        url: searchUrl,
        isSearchLink: true
      }];
      
      return { videos };
    } catch (error) {
      console.error("[YouTube] Search error:", error);
      const fallbackVideos = this._getFallbackYouTubeVideos(query);
      if (fallbackVideos.length > 0) {
        return { 
          videos: fallbackVideos,
          fallback: true,
          message: "Showing popular videos (search API unavailable)"
        };
      }
      return { error: `Failed to search YouTube: ${error.message}` };
    }
  }

  _getFallbackYouTubeVideos(query) {
    const keywords = query.toLowerCase();
    const fallbackMap = {
      "vscode": [
        { videoId: "B-s71n0dHUk", title: "VS Code Tutorial for Beginners", url: "https://www.youtube.com/watch?v=B-s71n0dHUk" },
        { videoId: "WPqXP_kLzpo", title: "VS Code Crash Course", url: "https://www.youtube.com/watch?v=WPqXP_kLzpo" }
      ],
      "arduino": [
        { videoId: "nL34zDTPkcs", title: "Arduino Tutorial for Beginners", url: "https://www.youtube.com/watch?v=nL34zDTPkcs" },
        { videoId: "fJWR7dBuc18", title: "Arduino Programming Tutorial", url: "https://www.youtube.com/watch?v=fJWR7dBuc18" }
      ],
      "thunder": [
        { videoId: "fKopy74weus", title: "Imagine Dragons - Thunder (Official Music Video)", url: "https://www.youtube.com/watch?v=fKopy74weus" },
        { videoId: "W0DM5lcj6mw", title: "Imagine Dragons - Thunder (Lyrics)", url: "https://www.youtube.com/watch?v=W0DM5lcj6mw" }
      ],
      "imagine dragons": [
        { videoId: "fKopy74weus", title: "Imagine Dragons - Thunder", url: "https://www.youtube.com/watch?v=fKopy74weus" },
        { videoId: "ktvTqknDobU", title: "Imagine Dragons - Radioactive", url: "https://www.youtube.com/watch?v=ktvTqknDobU" },
        { videoId: "7wtfhZwyrcc", title: "Imagine Dragons - Believer", url: "https://www.youtube.com/watch?v=7wtfhZwyrcc" }
      ],
      "javascript": [
        { videoId: "PkZNo7MFNFg", title: "JavaScript Tutorial for Beginners", url: "https://www.youtube.com/watch?v=PkZNo7MFNFg" },
        { videoId: "W6NZfCO5SIk", title: "JavaScript Programming - Full Course", url: "https://www.youtube.com/watch?v=W6NZfCO5SIk" }
      ],
      "python": [
        { videoId: "_uQrJ0TkZlc", title: "Python Tutorial - Full Course", url: "https://www.youtube.com/watch?v=_uQrJ0TkZlc" },
        { videoId: "rfscVS0vtbw", title: "Learn Python - Full Course", url: "https://www.youtube.com/watch?v=rfscVS0vtbw" }
      ],
      "react": [
        { videoId: "Ke90Tje7VS0", title: "React Course - Beginner Tutorial", url: "https://www.youtube.com/watch?v=Ke90Tje7VS0" },
        { videoId: "bMknfKXIFA8", title: "React Tutorial for Beginners", url: "https://www.youtube.com/watch?v=bMknfKXIFA8" }
      ],
      "music": [
        { videoId: "fKopy74weus", title: "Imagine Dragons - Thunder", url: "https://www.youtube.com/watch?v=fKopy74weus" },
        { videoId: "ktvTqknDobU", title: "Imagine Dragons - Radioactive", url: "https://www.youtube.com/watch?v=ktvTqknDobU" }
      ]
    };
    
    // Try exact match first
    for (const [key, videos] of Object.entries(fallbackMap)) {
      if (keywords.includes(key)) {
        return videos;
      }
    }
    
    // Try partial match for programming topics
    if (keywords.includes("tutorial") || keywords.includes("learn") || keywords.includes("course")) {
      if (keywords.includes("js") || keywords.includes("javascript")) {
        return fallbackMap["javascript"];
      }
      if (keywords.includes("py") || keywords.includes("python")) {
        return fallbackMap["python"];
      }
      if (keywords.includes("code") || keywords.includes("vscode") || keywords.includes("vs code")) {
        return fallbackMap["vscode"];
      }
    }
    
    return [];
  }



  _setupMessageHandler(webview) {
    if (!webview || this._boundWebviews.has(webview)) return;
    this._boundWebviews.add(webview);
    webview.onDidReceiveMessage(async (message) => {
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

        if (/^\/ollama$/i.test(trimmedText)) {
          await this._updateAiConfig("provider", "ollama");
          await this._updateAiConfig("model", "qwen2.5-coder:1.5b");
          this._postMessage({ type: "status", text: "Provider forced to Ollama. Reloading..." });
          await this._fetchAndSendModels("ollama");
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
          this._postMessage({
            type: "status",
            text: `Thinking mode ${this.showThinking ? "enabled" : "disabled"}.`
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
        if (/^\/ping$/i.test(trimmedText)) {
          this._postMessage({ type: "status", text: "Testing AI connection..." });
          this._postMessage({ type: "thinking" });
          const config = await this._getEffectiveAiConfig();
          try {
            if (config.provider === "ollama") {
              const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
              if (res.ok) {
                const data = await res.json();
                const models = (data.models || []).map(m => m.name);
                this._postMessage({ 
                  type: "stream", 
                  text: `✅ Ollama is running at ${config.ollamaUrl}\n\nAvailable models: ${models.join(", ") || "none"}\n\nCurrent model: ${config.model}` 
                });
              } else {
                this._postMessage({ type: "error", text: `❌ Ollama returned status ${res.status}` });
              }
            } else {
              this._postMessage({ type: "stream", text: `✅ Provider: ${config.provider}\nModel: ${config.model}\nTimeout: ${config.timeout}ms` });
            }
          } catch (err) {
            this._postMessage({ type: "error", text: `❌ Connection failed: ${err.message}\n\nMake sure Ollama is running: ollama serve` });
          }
          this._postMessage({ type: "done" });
          return;
        }

        if (this._isSyntaxFixRequest(trimmedText)) {
          await this._runActiveSyntaxFix(workspaceFolder);
          return;
        }

        if (this._isSyntaxQuestion(trimmedText)) {
          const activeOnly = /\b(active|current|open|this)\s+(file|tab|editor)\b/i.test(trimmedText) ||
            !/\b(workspace|repo|repository|project|codebase|all files|entire project)\b/i.test(trimmedText);
          const activeEditor = this._getCurrentFileEditor();
          const activeFiles =
            activeOnly && workspaceFolder && activeEditor
              ? [path.relative(workspaceFolder, activeEditor.document.fileName).replace(/\\/g, "/")]
              : null;
          await this._runSyntaxScan(
            workspaceFolder,
            activeFiles
          );
          return;
        }

        if (this._isLibraryAuditRequest(trimmedText)) {
          await this._runLibraryAudit(workspaceFolder);
          return;
        }

        this.agent.setActiveEditor(this.lastActiveEditor || vscode.window.activeTextEditor);
        if (workspaceFolder && this._shouldPrepareWorkspaceContext(intent, trimmedText)) {
          const forcePrep =
            this.chatMode === "heavy" ||
            this.chatMode === "deep" ||
            intent === "scan";
          this._postMessage({ type: "status", text: "Studying workspace before responding..." });
          const prep = await this.agent.prepareWorkspaceContext(trimmedText, workspaceFolder, { force: forcePrep });
          this._postMessage({
            type: "status",
            text: `Studied workspace: indexed ${prep.indexedFiles} file(s).`
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
          if (["edit", "debug", "refactor"].includes(intent)) {
            const gitStatus = await this.agent.executeCommand("git status --short", workspaceFolder);
            if (gitStatus.success) {
              this._postMessage({
                type: "status",
                text: this._summarizeGitStatus(gitStatus.output)
              });
            }
          }
        }
        this._postMessage({ type: "thinking" });
        this.abortController = new AbortController();

        // Add timeout warning for slow models
        const config = await this._getEffectiveAiConfig();
        const timeoutMs = config.timeout || 300000;
        
        // Warn immediately for known slow models
        if (config.model === "minimaxai/minimax-m2.7") {
          this._postMessage({ 
            type: "status", 
            text: "⚠️ MiniMax M2.7 can be slow. Consider switching to meta/llama-3.1-8b-instruct for faster responses." 
          });
        }
        
        const warningTimer = setTimeout(() => {
          if (this.abortController && !this.abortController.signal.aborted) {
            this._postMessage({ 
              type: "status", 
              text: `⏳ Model is taking longer than expected. This may be normal for ${config.model}. You can stop generation anytime.` 
            });
          }
        }, 30000); // Warn after 30 seconds

        let response;
        const startTime = Date.now();
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
            (chunk) => { this._postMessage({ type: "stream", text: chunk }); },
            this.abortController.signal,
            {
              mode: this.chatMode,
              runtimeConfig: config,
              onStatus: (text) => { this._postMessage({ type: "status", text }); }
            }
          );
          
          // Record performance
          const duration = Date.now() - startTime;
          this.performanceMonitor.recordResponse(
            config.provider,
            config.model,
            duration,
            !response.error
          );
        } catch (chatError) {
          console.error("[ChatPanel] Error in agent.chat:", chatError);
          const errorMsg = chatError.name === "AbortError" 
            ? "Generation stopped or timed out. Try a faster model or increase timeout in settings."
            : `AI error: ${chatError.message}`;
          this._postMessage({ type: "error", text: errorMsg });
          this._postMessage({ type: "done" });
          return;
        } finally {
          clearTimeout(warningTimer);
          this.abortController = null;
        }

        if (response.error) {
          this._postMessage({ type: "error", text: response.error });
          this._postMessage({ type: "done" });
          return;
        }

        this._postMessage({ type: "done" });

        if (response.warnings && response.warnings.length > 0) {
          for (const warning of response.warnings) {
            this._postMessage({ type: "status", text: warning });
          }
        }

        const debugConfig = vscode.workspace.getConfiguration("codeJanitor.ai");
        const showParsedActionsDebug = debugConfig.get("showParsedActionsDebug", false);

        if (showParsedActionsDebug && response.actions && response.actions.length > 0) {
          const actionSummary = response.actions.map(a => {
            if (a.type === "graphify") return "graphify:open";
            if (a.type === "preview_inspect") return "preview:inspect";
            return `${a.type}:${a.path || a.command || ""}`;
          }).join(", ");
          this._postMessage({ type: "status", text: `Parsed ${response.actions.length} action(s): ${actionSummary}` });
        }

        if (response.actions && response.actions.length > 0) {
          const hasFileAction = response.actions.some(
            (action) =>
              action.type === "file" &&
              typeof action.content === "string" &&
              action.content.trim().length > 0
          );
          const hasPreviewInspectionAction = response.actions.some(
            (action) => action.type === "preview_inspect"
          ) || (
            response.actions.some((action) => action.type === "preview") &&
            this._shouldInspectPreviewRequest(trimmedText)
          );
          if (isEditLikeIntent && !hasFileAction && !hasPreviewInspectionAction) {
            this._postMessage({
              type: "status",
              text: "Blocked execution: edit requests must include at least one FILE action."
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
                this._postMessage({
                  type: result.success ? "applied" : "error",
                  filePath: result.success ? result.path : undefined,
                  text: result.success
                    ? shouldApplyToOpenFile
                      ? `\u2705 Updated open file ${result.relativePath || result.path}`
                      : `\u2705 Opened draft ${result.path}`
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
              if (isEditLikeIntent && !hasExplicitCommandRequest) {
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
            if (action.type === "file") {
              if (outside && !allowOutside) {
                this._postMessage({ type: "status", text: `\u274c Denied: ${action.path}` });
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
              this._postMessage({
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
              } else if (!result.success) {
                // Log file operation error to performance monitor
                if (global.performanceMonitor) {
                  global.performanceMonitor.recordIssue("file_error", {
                    file: action.path,
                    operation: result.created ? "create" : "update",
                    error: result.error
                  });
                }
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
              console.log("[ChatPanel] Executing graphify action");
              
              // Check if workspace is open
              if (!workspaceFolder) {
                this._postMessage({
                  type: "error",
                  text: "Cannot open Graphify: No workspace folder is open. Please open a folder or workspace first."
                });
                continue;
              }
              
              this._postMessage({ type: "status", text: "Opening Graphify visualization..." });
              try {
                console.log("[ChatPanel] Calling vscode.commands.executeCommand('codeJanitor.openGraphify')");
                await vscode.commands.executeCommand("codeJanitor.openGraphify");
                console.log("[ChatPanel] Graphify command executed successfully");
                this._postMessage({
                  type: "applied",
                  text: "\u2705 Graphify panel opened. You can now visualize the codebase structure."
                });
              } catch (err) {
                console.error("[ChatPanel] Graphify command failed:", err);
                this._postMessage({
                  type: "error",
                  text: `Failed to open Graphify: ${err.message}\n\nStack: ${err.stack}`
                });
              }
            } else if (action.type === "lint") {
              this._postMessage({ type: "status", text: "Running Code Janitor lint on the active file..." });
              try {
                await vscode.commands.executeCommand("codeJanitor.lintCode");
                this._postMessage({
                  type: "applied",
                  text: "✅ Lint command executed. Check the Problems panel and notifications for results."
                });
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to run lint: ${err.message}`
                });
              }
            } else if (action.type === "validate_frontend") {
              this._postMessage({ type: "status", text: "Running frontend dependency validation..." });
              try {
                await vscode.commands.executeCommand("codeJanitor.validateFrontend");
                this._postMessage({
                  type: "applied",
                  text: "✅ Frontend validation command executed."
                });
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to validate frontend dependencies: ${err.message}`
                });
              }
} else if (action.type === "preview") {
              const shouldInspectPreview = this._shouldInspectPreviewRequest(trimmedText);
              if (shouldInspectPreview) {
                this._postMessage({ type: "status", text: "Opening live preview and inspecting it for issues..." });
                try {
                  const inspection = await vscode.commands.executeCommand("codeJanitor.inspectLivePreview");
                  const diagnostics = inspection?.diagnostics || null;
                  this._postMessage({
                    type: "applied",
                    text: this._summarizePreviewDiagnostics(diagnostics)
                  });

                  if (isEditLikeIntent && this._previewDiagnosticsHasIssues(diagnostics)) {
                    this._postMessage({
                      type: "status",
                      text: "Preview issues found. Generating a fix for the active file..."
                    });
                    const runtimeConfig = await this._getEffectiveAiConfig();
                    const fixResult = await this._fixActiveFileFromPreviewDiagnostics(
                      trimmedText,
                      workspaceFolder,
                      diagnostics,
                      runtimeConfig
                    );

                    if (!fixResult.success) {
                      this._postMessage({
                        type: "error",
                        text: fixResult.error
                      });
                    } else {
                      this._postMessage({
                        type: "applied",
                        text: `✅ Updated ${fixResult.path} using preview diagnostics.`
                      });

                      const verificationDiagnostics = fixResult.verification?.diagnostics || null;
                      if (verificationDiagnostics) {
                        const cleanPreview = !this._previewDiagnosticsHasIssues(verificationDiagnostics);
                        this._postMessage({
                          type: cleanPreview ? "applied" : "status",
                          text: cleanPreview
                            ? `✅ Post-fix preview check passed. ${this._summarizePreviewDiagnostics(verificationDiagnostics)}`
                            : `Post-fix preview check: ${this._summarizePreviewDiagnostics(verificationDiagnostics)}`
                        });
                      }
                    }
                  }
                } catch (err) {
                  this._postMessage({
                    type: "error",
                    text: `Failed to inspect live preview: ${err.message}`
                  });
                }
              } else {
                this._postMessage({ type: "status", text: "Opening live preview..." });
                try {
                  await vscode.commands.executeCommand("codeJanitor.livePreview");
                  this._postMessage({
                    type: "applied",
                    text: "✅ Live preview command executed."
                  });
                } catch (err) {
                  this._postMessage({
                    type: "error",
                    text: `Failed to open live preview: ${err.message}`
                  });
                }
              }
            } else if (action.type === "preview_inspect") {
              this._postMessage({ type: "status", text: "Opening live preview and inspecting it for issues..." });
              try {
                const inspection = await vscode.commands.executeCommand("codeJanitor.inspectLivePreview");
                const diagnostics = inspection?.diagnostics || null;
                this._postMessage({
                  type: "applied",
                  text: this._summarizePreviewDiagnostics(diagnostics)
                });

                if (isEditLikeIntent && this._previewDiagnosticsHasIssues(diagnostics)) {
                  this._postMessage({
                    type: "status",
                    text: "Preview issues found. Generating a fix for the active file..."
                  });
                  const runtimeConfig = await this._getEffectiveAiConfig();
                  const fixResult = await this._fixActiveFileFromPreviewDiagnostics(
                    trimmedText,
                    workspaceFolder,
                    diagnostics,
                    runtimeConfig
                  );

                  if (!fixResult.success) {
                    this._postMessage({
                      type: "error",
                      text: fixResult.error
                    });
                  } else {
                    this._postMessage({
                      type: "applied",
                      text: `✅ Updated ${fixResult.path} using preview diagnostics.`
                    });

                    const verificationDiagnostics = fixResult.verification?.diagnostics || null;
                    if (verificationDiagnostics) {
                      const cleanPreview = !this._previewDiagnosticsHasIssues(verificationDiagnostics);
                      this._postMessage({
                        type: cleanPreview ? "applied" : "status",
                        text: cleanPreview
                          ? `✅ Post-fix preview check passed. ${this._summarizePreviewDiagnostics(verificationDiagnostics)}`
                          : `Post-fix preview check: ${this._summarizePreviewDiagnostics(verificationDiagnostics)}`
                      });
                    }
                  }
                }
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to inspect live preview: ${err.message}`
                });
              }
            } else if (action.type === "performance") {
              this._postMessage({ type: "status", text: "Opening AI performance report..." });
              try {
                await vscode.commands.executeCommand("codeJanitor.showPerformance");
                this._postMessage({
                  type: "applied",
                  text: "✅ AI performance report command executed."
                });
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to open AI performance report: ${err.message}`
                });
              }
            } else if (action.type === "fetch") {
              this._postMessage({ type: "status", text: `Fetching from web: ${action.url}` });
              try {
                const fetchResult = await this.agent.fetchFromWeb(action.url);
                if (fetchResult.success) {
                  const preview = fetchResult.data.slice(0, 2000);
                  const truncated = fetchResult.data.length > 2000 ? ` (truncated from ${fetchResult.size} bytes)` : "";
                  this._postMessage({
                    type: "applied",
                    text: `\u2705 Fetched ${action.url}${truncated}:\n\n${preview}`
                  });
                } else {
                  this._postMessage({
                    type: "error",
                    text: `Failed to fetch ${action.url}: ${fetchResult.error}`
                  });
                }
              } catch (err) {
                this._postMessage({
                  type: "error",
                  text: `Failed to fetch ${action.url}: ${err.message}`
                });
              }
            } else if (action.type === "youtube") {
              // YouTube actions are now handled only via the YouTube button
              // Skip processing YouTube actions from AI responses to improve performance
              this._postMessage({
                type: "status",
                text: "💡 Use the YouTube search button in the chat to search for videos"
              });
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
        } catch (error) {
          console.error("[ChatPanel] Error in chat handler:", error);
          this._postMessage({ type: "error", text: `Chat error: ${error.message}` });
          this._postMessage({ type: "done" });
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
      } else if (message.type === "openChatCommand") {
        await vscode.commands.executeCommand("codeJanitor.openChat");
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
        const activeEditor = this._getCurrentFileEditor();
        const files = message.activeOnly
          ? (activeEditor ? [path.relative(workspaceFolder, activeEditor.document.fileName).replace(/\\/g, "/")] : [])
          : null;
        await this._runSyntaxScan(workspaceFolder, files);
      } else if (message.type === "libraryAudit") {
        await this._runLibraryAudit(workspaceFolder);
      } else if (message.type === "fixActive") {
        await this._runActiveSyntaxFix(workspaceFolder);
      } else if (message.type === "quickFixActive") {
        // Quick Fix from chat panel - lint and fix with AI
        await this._runActiveSyntaxFix(workspaceFolder);
      } else if (message.type === "refreshProviderModels" || message.type === "ready") {
        let selectedProvider = this._getSelectedProviderId() || this.agent.getConfig().provider;
        // Webview signals it's fully loaded or user switched to Ollama — send current state
        if (message.type === "ready") {
          const keyPresence = await this._getProviderPresence();
          const savedConfig = this.agent.getConfig();
          selectedProvider = this._getSelectedProviderId() || savedConfig.provider;
          const customProvider = this._getCustomProviderById(selectedProvider);
          const hasKey = selectedProvider === "ollama" || !!keyPresence[selectedProvider];
          const models = selectedProvider === "ollama" || selectedProvider === "nvidia"
            ? null
            : customProvider?.models?.length
              ? customProvider.models
              : hasKey
                ? (MODELS_BY_PROVIDER[selectedProvider] || null)
                : null;
          this._postMessage({
            type: "setCurrentProvider",
            provider: selectedProvider,
            model: this._getSavedProviderModel(selectedProvider) || customProvider?.defaultModel || savedConfig.model,
            providers: this._buildProviderCatalog(),
            keyPresence,
            models
          });
          this._postMessage({
            type: "thinkingState",
            enabled: this.showThinking
          });
        }
        this._fetchAndSendModels(selectedProvider === "nvidia" ? "nvidia" : "ollama");
      } else if (message.type === "mode") {
        this.chatMode =
          message.value === "deep"
            ? "deep"
            : message.value === "heavy"
              ? "heavy"
              : "fast";
      } else if (message.type === "toggleThinking") {
        await this._setThinkingMode(!this.showThinking);
        this._postMessage({
          type: "status",
          text: `Thinking mode ${this.showThinking ? "enabled" : "disabled"}.`
        });
      } else if (message.type === "setModel") {
        const provider = this._getSelectedProviderId() || vscode.workspace.getConfiguration("codeJanitor.ai").get("provider", "ollama");
        const nextModel = await this._setProviderModel(provider, message.model);
        if (this.panel) {
          this._postMessage({
            type: "status",
            text: `Model switched to ${nextModel}.`
          });
        }
      } else if (message.type === "setProvider") {
        try {
          console.log("[ChatPanel] setProvider message received:", message.provider);
          if (this._isBuiltInProvider(message.provider)) {
            await this._updateAiConfig("provider", message.provider);
          }
          await this._setSelectedProviderId(message.provider);
          const defaultModel = this._getDefaultModelForProvider(message.provider);
          const savedModel = this._getSavedProviderModel(message.provider);
          const nextModel = await this._setProviderModel(
            message.provider,
            savedModel || defaultModel
          );
          
          // Persist API key if provided
          if (message.apiKey) {
            await this._persistApiKey(message.provider, message.apiKey);
          }
          
          // Wait for config to persist before fetching models
          await new Promise(r => setTimeout(r, 300));
          const keyPresence = await this._getProviderPresence();
          const customProvider = this._getCustomProviderById(message.provider);
          if (this.panel) {
            const hasKey = message.provider === "ollama" || !!keyPresence[message.provider];
            this._postMessage({
              type: "setCurrentProvider",
              provider: message.provider,
              model: nextModel,
              providers: this._buildProviderCatalog(),
              keyPresence,
              models: message.provider === "ollama" || message.provider === "nvidia"
                ? null
                : customProvider?.models?.length
                  ? customProvider.models
                  : hasKey
                    ? (MODELS_BY_PROVIDER[message.provider] || null)
                    : null
            });
          }
          if (this.panel) {
            this._postMessage({
              type: "status",
              text: `Provider switched to ${message.provider}. Model set to ${nextModel}.`
            });
          }
          await this._fetchAndSendModels(message.provider === "nvidia" ? "nvidia" : "ollama");
        } catch (error) {
          console.error("[ChatPanel] Error in setProvider:", error);
          if (this.panel) {
            this._postMessage({
              type: "error",
              text: `Failed to switch provider: ${error.message}`
            });
          }
        }
      } else if (message.type === "addCustomProvider") {
        try {
          const provider = await this._addCustomProvider(message.provider || {}, message.apiKey || "");
          const keyPresence = await this._getProviderPresence();
          if (this.panel) {
            this._postMessage({
              type: "setCurrentProvider",
              provider: provider.id,
              model: provider.defaultModel,
              providers: this._buildProviderCatalog(),
              keyPresence,
              models: provider.models
            });
            this._postMessage({
              type: "status",
              text: `Custom provider ${provider.name} added and selected.`
            });
          }
        } catch (error) {
          if (this.panel) {
            this._postMessage({
              type: "error",
              text: `Failed to add custom provider: ${error.message}`
            });
          }
        }
      } else if (message.type === "showPerformanceReport") {
        const analysis = this.performanceMonitor.analyzePerformance();
        this.performanceMonitor._showPerformanceReport(analysis);
      } else if (message.type === "getAutoHealHistory") {
        const history = await this.performanceMonitor.getAutoHealHistory();
        this._postMessage({ type: "autoHealHistory", history });
      } else if (message.type === "tutorialCompleted") {
        // Mark tutorial as completed in global state
        await this.context.globalState.update("codeJanitor.tutorialCompleted", true);
        console.log("[ChatPanel] Tutorial marked as completed");
      } else if (message.type === "prefillMessage") {
        // Quick Fix with AI: pre-fill message and auto-send
        if (this.panel) {
          this._postMessage({ 
            type: "prefillAndSend", 
            message: message.message 
          });
        }
      } else if (message.type === "webSearch") {
        try {
          const query = (message.query || "").trim();
          if (!query) {
            this._postMessage({ type: "searchError", error: "Search query is empty" });
            return;
          }

          this._postMessage({ type: "status", text: `Searching for: ${query}` });
          this._postMessage({ type: "thinking" });

          // Use DuckDuckGo Instant Answer API (free, no API key required)
          const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
          
          const response = await fetch(searchUrl, {
            headers: { "User-Agent": "Code-Janitor/1.0" },
            signal: AbortSignal.timeout(15000)
          });

          if (!response.ok) {
            throw new Error(`Search API returned status ${response.status}`);
          }

          const data = await response.json();
          
          // Format search results
          let resultText = `🔍 Search results for "${query}":\n\n`;
          
          if (data.AbstractText) {
            resultText += `📝 Summary:\n${data.AbstractText}\n\n`;
          }
          
          if (data.AbstractURL) {
            resultText += `🔗 Source: ${data.AbstractURL}\n\n`;
          }

          if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            resultText += "📚 Related Topics:\n";
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
      } else if (message.type === "openExternal") {
        const targetUrl = String(message.url || "").trim();
        if (!targetUrl) {
          return;
        }

        try {
          await vscode.env.openExternal(vscode.Uri.parse(targetUrl));
        } catch (error) {
          console.error("[ChatPanel] Failed to open external URL:", error);
          this._postMessage({
            type: "error",
            text: `Could not open link: ${error.message}`
          });
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

          // Format results with embeds
          let resultText = `▶️ YouTube results for "${query}":\n\n`;
          
          if (results.fallback) {
            resultText += `ℹ️ ${results.message}\n\n`;
          }
          
          if (results.videos && results.videos.length > 0) {
            for (const video of results.videos) {
              resultText += `📺 ${video.title}\n\n${video.url}\n\n`;
            }
          } else {
            resultText += "No videos found. Try a different search term.";
          }
          
          console.log("[YouTube Backend] Sending result text:", resultText);

          this._postMessage({ type: "stream", text: resultText });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "youtubeComplete" });

        } catch (error) {
          console.error("[ChatPanel] YouTube search error:", error);
          this._postMessage({ 
            type: "error", 
            text: `YouTube search failed: ${error.message}` 
          });
          this._postMessage({ type: "done" });
          this._postMessage({ type: "youtubeError", error: error.message });
        }
      }
    });
  }
}

module.exports = ChatPanel;
