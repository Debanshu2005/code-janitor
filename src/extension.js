const vscode = require("vscode");
const Linter = require("./core/linter");
const FrontendValidator = require("./core/frontend-validator");
const {
  getAddPackagesCommand,
  inferPackageManager
} = require("./core/frontend-package-manager");
const livePreviewer = require("./live-preview");
const OllamaClient = require("./core/ai/ollama-client");
const ChatPanel = require("./ai-agent/chat-panel");
const AIAgent = require("./ai-agent/agent");
const {
  WorkspaceMemoryService
} = require("./ai-agent/workspace-memory");
const GraphifyPanel = require("./graphify/graphify-panel");
const { loadGraphContextForFile } = require("./graphify/graph-loader");
const { computeMinimalReplacement } = require("./utils/minimal-diff");

const FRONTEND_DIAGNOSTIC_SOURCE = "Code Janitor Frontend";
const FRONTEND_VALIDATION_EXTENSIONS = [
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx"
];

// Map file extensions / languageIds to fixers
function getFixerForDocument(document, code, fileName) {
  console.log(`Debug - Language ID: ${document.languageId}, File: ${fileName}`);

  const fixerMap = {
    c: () => new (require("./core/fixers/EmbeddedCFixer"))(code, fileName),
    cpp: () => new (require("./core/fixers/EmbeddedCFixer"))(code, fileName),
    cppm: () => new (require("./core/fixers/EmbeddedCFixer"))(code, fileName),
    java: () => new (require("./core/fixers/JavaFixer"))(code, fileName),
    javascript: () =>
      new (require("./core/fixers/javascript-fixer"))(code, fileName),
    javascriptreact: () =>
      new (require("./core/fixers/javascript-fixer"))(code, fileName),
    python: () =>
      new (require("./core/fixers/python-fixer"))(code, fileName, {
        verbose: true
      }),
    html: () => new (require("./core/fixers/html-fixer"))(code, fileName)
  };

  // Check by language ID first
  if (fixerMap[document.languageId]) {
    console.log(`Found fixer by language ID: ${document.languageId}`);
    return fixerMap[document.languageId]();
  }

  // Check by file extension
  if (/\.(c|h|cpp|ino)$/i.test(fileName)) return fixerMap.c();
  if (/\.(js|jsx)$/i.test(fileName)) {
    console.log("Found JS file by extension");
    return fixerMap.javascript();
  }
  if (fileName.endsWith(".java")) return fixerMap.java();
  if (fileName.endsWith(".py")) return fixerMap.python();
  if (fileName.endsWith(".html")) return fixerMap.html();

  console.log(
    `No fixer found for languageId: ${document.languageId}, fileName: ${fileName}`
  );
  return null;
}

function getNormalizedLanguageId(document) {
  return document.languageId === "javascriptreact"
    ? "javascript"
    : document.languageId === "cppm"
      ? "cpp"
      : document.languageId;
}

function getFullDocumentRange(document) {
  return new vscode.Range(
    document.positionAt(0),
    document.lineAt(document.lineCount - 1).range.end
  );
}

async function replaceDocumentText(document, nextCode, save = false) {
  const currentCode = document.getText();
  if (currentCode === nextCode) {
    if (save) await document.save();
    return;
  }

  const diff = computeMinimalReplacement(currentCode, nextCode);
  const edit = new vscode.WorkspaceEdit();
  if (diff) {
    const range = new vscode.Range(
      document.positionAt(diff.startOffset),
      document.positionAt(diff.endOffset)
    );
    edit.replace(document.uri, range, diff.replacement);
  } else {
    edit.replace(document.uri, getFullDocumentRange(document), nextCode);
  }
  await vscode.workspace.applyEdit(edit);

  if (save) {
    await document.save();
  }
}

function supportsFrontendValidation(document) {
  const fileName = document.fileName.toLowerCase();
  return FRONTEND_VALIDATION_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

function getMissingFrontendPackages(issues) {
  return [...new Set(
    (issues || [])
      .filter((issue) => issue.type === "missing-package" && issue.packageName)
      .map((issue) => issue.packageName)
  )].sort();
}

function installFrontendPackages(issues) {
  const workspaceRoot = issues.find((issue) => issue.workspaceRoot)?.workspaceRoot;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage(
      "Could not determine the project root for dependency installation."
    );
    return;
  }

  const packages = getMissingFrontendPackages(issues);
  if (packages.length === 0) {
    vscode.window.showInformationMessage(
      "No missing frontend packages were detected for installation."
    );
    return;
  }

  const packageManager = inferPackageManager(workspaceRoot);
  const command = getAddPackagesCommand(packageManager, packages);
  if (!command) {
    vscode.window.showWarningMessage(
      "Could not build an install command for the detected frontend packages."
    );
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: "Code Janitor Frontend Install",
    cwd: workspaceRoot
  });
  terminal.show(true);
  terminal.sendText(command, true);

  vscode.window.showInformationMessage(
    `Started ${packageManager} install for ${packages.length} package(s): ${packages.join(", ")}`
  );
}

function buildFrontendValidationSummaryMessage(
  issueCount,
  creatableCount,
  missingPackageCount
) {
  const parts = [];
  if (creatableCount > 0) {
    parts.push(
      `${creatableCount} missing file reference(s) can be created automatically`
    );
  }
  if (missingPackageCount > 0) {
    parts.push(
      `${missingPackageCount} package import(s) can be installed automatically`
    );
  }

  if (parts.length === 0) {
    return `Found ${issueCount} frontend issue(s). Check the Problems panel for details.`;
  }

  return `Found ${issueCount} frontend issue(s). ${parts.join(". ")}.`;
}

function createFrontendValidator(document, options = {}) {
  const graphContext = options.useGraphContext
    ? loadGraphContextForFile(document.fileName)
    : null;
  const validator = new FrontendValidator(
    document.fileName,
    document.getText(),
    graphContext
      ? {
          graphData: graphContext.data,
          graphRoot: graphContext.graphRoot
        }
      : {}
  );

  return { validator, graphContext };
}

function getIdentifierSet(code) {
  return new Set((code.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).slice(0, 500));
}

function assessReplacementSafety(originalCode, candidateCode) {
  const original = originalCode || "";
  const candidate = candidateCode || "";

  if (typeof candidateCode !== "string") {
    return { safe: false, reason: "Replacement is not a string" };
  }

  if (candidate === original) {
    return { safe: true, reason: "No content change" };
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return { safe: false, reason: "Replacement is empty" };
  }

  const originalTrimmed = original.trim();
  if (
    originalTrimmed.length > 80 &&
    trimmed.length < Math.max(40, Math.floor(originalTrimmed.length * 0.5))
  ) {
    return {
      safe: false,
      reason: "Replacement is much shorter than the original"
    };
  }

  const originalNonEmptyLines = original
    .split(/\r?\n/)
    .filter((line) => line.trim()).length;
  const candidateNonEmptyLines = candidate
    .split(/\r?\n/)
    .filter((line) => line.trim()).length;
  if (
    originalNonEmptyLines >= 8 &&
    candidateNonEmptyLines < Math.max(3, Math.floor(originalNonEmptyLines * 0.5))
  ) {
    return {
      safe: false,
      reason: "Replacement removes too much non-empty content"
    };
  }

  const originalIdentifiers = getIdentifierSet(original);
  if (originalIdentifiers.size >= 4) {
    const candidateIdentifiers = getIdentifierSet(candidate);
    let sharedIdentifiers = 0;

    for (const token of originalIdentifiers) {
      if (candidateIdentifiers.has(token)) {
        sharedIdentifiers += 1;
      }
    }

    if (sharedIdentifiers / originalIdentifiers.size < 0.35) {
      return {
        safe: false,
        reason: "Replacement does not preserve enough original identifiers"
      };
    }
  }

  return { safe: true, reason: "Replacement passed safety checks" };
}

function isCandidateValidForLanguage(candidateCode, language, ollamaClient) {
  if (!candidateCode || !language || !ollamaClient) {
    return true;
  }

  return ollamaClient._passesLanguageValidation(candidateCode, language);
}

async function runFixerAndApply(document, editor = null) {
  const code = document.getText();
  const fileName = document.fileName;
  const language = getNormalizedLanguageId(document);

  console.log(`[OK] Processing file: ${fileName}`);
  console.log(`[OK] File languageId: ${document.languageId}`);

  const fixer = getFixerForDocument(document, code, fileName);
  if (!fixer) {
    vscode.window.showInformationMessage("Unsupported file type!");
    return false;
  }

  try {
    console.log("[OK] Fixer loaded successfully, analyzing code...");
    let result = null;

    if (fixer.analyze) {
      result = await fixer.analyze();
    }

    let fixedCode = code;
    if (result && typeof result.fixedCode === "string") {
      fixedCode = result.fixedCode;
    } else if (result && result.formatted) {
      fixedCode = result.formatted;
    } else if (fixer.applyFixes) {
      fixedCode = fixer.applyFixes();
    } else if (fixer.getFixedCode) {
      fixedCode = fixer.getFixedCode();
    }

    // AI validation and enhancement (skip for fixer files)
    const isFixerFile =
      fileName.includes("\\fixers\\") || fileName.includes("/fixers/");
    const ollamaClient = new OllamaClient();
    const shouldSkipAI = result && result.skipAI === true;
    const shouldTryAI = !shouldSkipAI || (result && result.shouldTryAI === true);

    if (!isFixerFile && shouldTryAI && (await ollamaClient.isAvailable())) {
      const supportedLanguages = [
        "python",
        "javascript",
        "java",
        "c",
        "cpp",
        "html"
      ];
      if (supportedLanguages.includes(language)) {
        console.log(`[AI] Using AI-only fixing for ${language}...`);
        const aiResult = await ollamaClient.validateAndFix(
          code,
          fixedCode,
          language
        );
        if (aiResult && aiResult.shouldUseAI) {
          console.log(`[AI] AI fixed code: ${aiResult.reason}`);
          fixedCode = aiResult.fixedCode;
          const aiSafety = assessReplacementSafety(code, fixedCode);
          if (
            !aiSafety.safe ||
            !isCandidateValidForLanguage(fixedCode, language, ollamaClient)
          ) {
            console.warn(
              `Skipping AI output for ${fileName}: ${aiSafety.reason}`
            );
            fixedCode = code;
          }
        } else {
          console.log("[OK] No AI changes needed");
        }
      }
    }

    const replacementSafety = assessReplacementSafety(code, fixedCode);
    if (
      fixedCode !== code &&
      (!replacementSafety.safe ||
        !isCandidateValidForLanguage(fixedCode, language, ollamaClient))
    ) {
      console.warn(
        `Skipping unsafe replacement for ${fileName}: ${replacementSafety.reason}`
      );
      return false;
    }
    if (fixedCode === code) {

      console.log("[INFO] No changes detected");
      return false;
    }

    console.log("[OK] Code analysis complete, applying fixes...");
    await replaceDocumentText(document, fixedCode);

    if (editor) {
      await document.save();
    }

    // Show change log for HTML files
    if (
      result &&
      result.changeLog &&
      result.changeLog.length > 0 &&
      fileName.endsWith(".html")
    ) {
      const changes = result.changeLog.join("\n- ");

      if (result.warning) {
        vscode.window.showWarningMessage(
          `${result.warning}

Fixes applied:
- ${changes}` ,
          { modal: false }
        );
      } else {
        // Show changes with preview option
        vscode.window
          .showInformationMessage(
            `HTML fixes applied:
- ${changes}`,
            "Show Preview"
          )
          .then((selection) => {
            if (selection === "Show Preview") {
              livePreviewer(globalContext);
            }
          });

        // Also auto-show preview if enabled
        if (result.shouldShowPreview) {
          setTimeout(async () => {
            try {
              await livePreviewer(globalContext);
            } catch (error) {
              console.warn("Could not show preview:", error.message);
            }
          }, 1000); // Delay to let user read the changes first
        }
      }
    } else if (result && result.warning && fileName.endsWith(".html")) {
      vscode.window.showWarningMessage(result.warning);
    }

    console.log("[OK] Code formatted successfully!");
    return true;
  } catch (error) {
    console.error("[ERROR] Code Janitor error:", error);
    console.error("[ERROR] Code Janitor error:", error);
    return false;
  }
}

let globalContext; // Store context globally
let chatPanelInstance = null; // Shared chat panel instance

function getApiKeyConfigKey(provider) {
  if (provider === "groq") return "groqApiKey";
  if (provider === "openrouter") return "openrouterApiKey";
  if (provider === "anthropic") return "anthropicApiKey";
  if (provider === "nvidia") return "nvidiaApiKey";
  return null;
}

function getApiSecretKey(provider) {
  return `codeJanitor.ai.${provider}.apiKey`;
}

function getGitHubSecretKey() {
  return "codeJanitor.github.apiToken";
}

function getConfigTargetForKey(section, key) {
  const cfg = vscode.workspace.getConfiguration(section);
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

async function restorePersistedApiKeys(context) {
  if (!context?.secrets) return;

  const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
  const providers = ["groq", "openrouter", "anthropic", "nvidia"];

  for (const provider of providers) {
    const configKey = getApiKeyConfigKey(provider);
    if (!configKey) continue;

    const configValue = String(cfg.get(configKey, "") || "").trim();
    const secretValue = String(
      (await context.secrets.get(getApiSecretKey(provider))) || ""
    )
      .trim()
      .replace(/^['"`]|['"`]$/g, "");

    if (!secretValue && configValue) {
      await context.secrets.store(getApiSecretKey(provider), configValue);
    }

    if (configValue) {
      const target = getConfigTargetForKey("codeJanitor.ai", configKey);
      await cfg.update(configKey, "", target);
    }
  }
}

async function restorePersistedGitHubToken(context) {
  if (!context?.secrets) return;

  const cfg = vscode.workspace.getConfiguration("codeJanitor.github");
  const configKey = "apiToken";
  const configValue = String(cfg.get(configKey, "") || "").trim();
  const secretValue = String(
    (await context.secrets.get(getGitHubSecretKey())) || ""
  )
    .trim()
    .replace(/^['"`]|['"`]$/g, "");

  if (!secretValue && configValue) {
    await context.secrets.store(getGitHubSecretKey(), configValue);
  }

  if (configValue) {
    const target = getConfigTargetForKey("codeJanitor.github", configKey);
    await cfg.update(configKey, "", target);
  }
}

async function activate(context) {
  globalContext = context;
  console.log("[OK] Code Janitor extension is activating...");
  await restorePersistedApiKeys(context);
  await restorePersistedGitHubToken(context);

  // Show setup guide on first install
  const hasSeenSetup = context.globalState.get("codeJanitor.seenSetup", false);
  if (!hasSeenSetup) {
    vscode.window
      .showInformationMessage(
        "Welcome to Code Janitor! Check the setup guide to get started with AI models.",
        "Open Setup Guide",
        "Dismiss"
      )
      .then((selection) => {
        if (selection === "Open Setup Guide") {
          context.globalState.update("codeJanitor.seenSetup", true);
          vscode.env.openExternal(
            vscode.Uri.parse("https://code-janitor-web.vercel.app")
          );
        }
      });
  }

  // Auto-correction state
  let isAutoFixing = false;
  let autoFixTimeout = null;
  const backgroundAiAgent = new AIAgent(context);
  const workspaceMemoryService = new WorkspaceMemoryService(context, {
    resolveAgent: () => chatPanelInstance?.agent || backgroundAiAgent
  });
  chatPanelInstance = new ChatPanel(context, workspaceMemoryService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "codeJanitor.chatSidebar",
      chatPanelInstance,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  context.subscriptions.push(workspaceMemoryService);
  await workspaceMemoryService.initialize();

  // 1. Manual Fix Command - Open AI chat and trigger Fix issues
  const fixDisposable = vscode.commands.registerCommand(
    "codeJanitor.fixCode",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found!");
        return;
      }
      // Always create fresh instance or reuse if panel is still open
      if (!chatPanelInstance) {
        chatPanelInstance = new ChatPanel(context, workspaceMemoryService);
      }
      // Show panel and trigger fix
      await chatPanelInstance.show();
      // Wait for webview to be ready
      await new Promise(resolve => setTimeout(resolve, 500));
      // Trigger Fix issues action
      if (chatPanelInstance.panel?.webview) {
        chatPanelInstance.panel.webview.postMessage({ type: "triggerFix" });
      }
    }
  );
  context.subscriptions.push(fixDisposable);

  // Create diagnostics collection for linting issues
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("codeJanitor");
  context.subscriptions.push(diagnosticCollection);
  const frontendDiagnosticCollection =
    vscode.languages.createDiagnosticCollection("codeJanitorFrontend");
  context.subscriptions.push(frontendDiagnosticCollection);

  // Register Code Action Provider for "Quick Fix with AI"
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    [
      "javascript",
      "javascriptreact",
      "typescript",
      "typescriptreact",
      "python",
      "java",
      "c",
      "cpp",
      "html",
      "css",
      "scss",
      "sass",
      "less"
    ],
    {
      provideCodeActions(document, range, context) {
        const diagnostics = context.diagnostics.filter((d) =>
          String(d.source || "").startsWith("Code Janitor")
        );
        if (diagnostics.length === 0) return [];

        const fixes = [];
        
        // Create "Fix with AI" action for each diagnostic
        for (const diagnostic of diagnostics) {
          const fix = new vscode.CodeAction(
            `Fix with AI: ${diagnostic.message}`,
            vscode.CodeActionKind.QuickFix
          );
          fix.command = {
            command: "codeJanitor.quickFixWithAI",
            title: "Fix with AI",
            arguments: [document, diagnostic]
          };
          fix.diagnostics = [diagnostic];
          fix.isPreferred = true;
          fixes.push(fix);
        }

        // Create "Fix All with AI" action if multiple issues
        if (diagnostics.length > 1) {
          const fixAll = new vscode.CodeAction(
            `Fix All ${diagnostics.length} Issues with AI`,
            vscode.CodeActionKind.QuickFix
          );
          fixAll.command = {
            command: "codeJanitor.quickFixAllWithAI",
            title: "Fix All with AI",
            arguments: [document, diagnostics]
          };
          fixAll.diagnostics = diagnostics;
          fixes.push(fixAll);
        }

        return fixes;
      }
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );
  context.subscriptions.push(codeActionProvider);

  // 2. Lint Command
  const lintDisposable = vscode.commands.registerCommand(
    "codeJanitor.lintCode",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found!");
        return;
      }

      const document = editor.document;
      if (
        document.languageId !== "javascript" &&
        document.languageId !== "javascriptreact"
      ) {
        vscode.window.showInformationMessage(
          "Linting is currently only supported for JavaScript files."
        );
        return;
      }

      try {
        const linter = new Linter(document.fileName);
        const result = await linter.lint();

        if (result.success) {
          if (result.issues && result.issues.length > 0) {
            // Convert issues to VS Code diagnostics
            const diagnostics = result.issues.map((issue) => {
              const range = new vscode.Range(
                new vscode.Position(issue.line - 1, issue.column - 1),
                new vscode.Position(issue.line - 1, issue.column - 1 + 10)
              );
              const severity =
                issue.severity === 2
                  ? vscode.DiagnosticSeverity.Error
                  : vscode.DiagnosticSeverity.Warning;
              const diagnostic = new vscode.Diagnostic(
                range,
                issue.message,
                severity
              );
              diagnostic.source = "Code Janitor";
              if (issue.ruleId) {
                diagnostic.code = issue.ruleId;
              }
              return diagnostic;
            });

            // Set diagnostics in Problems panel
            diagnosticCollection.set(document.uri, diagnostics);

            const issueCount = result.issues.length;
            vscode.window.showWarningMessage(
              `Found ${issueCount} linting issue(s). Check Problems panel for details.`
            );
          } else {
            // Clear diagnostics if no issues
            diagnosticCollection.set(document.uri, []);
            vscode.window.showInformationMessage("No linting issues found.");
          }
        } else {
          vscode.window.showErrorMessage(`Linting failed: ${result.message}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Linter error: ${error.message}`);
      }
    }
  );
  context.subscriptions.push(lintDisposable);

  // Quick Fix with AI Command - Single issue
  const quickFixDisposable = vscode.commands.registerCommand(
    "codeJanitor.quickFixWithAI",
    async (document, diagnostic) => {
      if (!chatPanelInstance) {
        chatPanelInstance = new ChatPanel(context, workspaceMemoryService);
      }
      await chatPanelInstance.show();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Build pre-filled message with error context
      const line = diagnostic.range.start.line + 1;
      const message = `Fix this error on line ${line}:\n\n**Error:** ${diagnostic.message}\n**Rule:** ${diagnostic.code || "N/A"}\n\nPlease fix this issue in the file.`;
      
      if (chatPanelInstance.panel?.webview) {
        chatPanelInstance.panel.webview.postMessage({ 
          type: "prefillMessage", 
          message 
        });
      }
    }
  );
  context.subscriptions.push(quickFixDisposable);

  // Quick Fix All with AI Command - Multiple issues
  const quickFixAllDisposable = vscode.commands.registerCommand(
    "codeJanitor.quickFixAllWithAI",
    async (document, diagnostics) => {
      if (!chatPanelInstance) {
        chatPanelInstance = new ChatPanel(context, workspaceMemoryService);
      }
      await chatPanelInstance.show();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Build pre-filled message with all errors
      const errorList = diagnostics.map((d, i) => {
        const line = d.range.start.line + 1;
        return `${i + 1}. Line ${line}: ${d.message} (${d.code || "N/A"})`;
      }).join("\n");
      
      const message = `Fix these ${diagnostics.length} errors:\n\n${errorList}\n\nPlease fix all these issues in the file.`;
      
      if (chatPanelInstance.panel?.webview) {
        chatPanelInstance.panel.webview.postMessage({ 
          type: "prefillMessage", 
          message 
        });
      }
    }
  );
  context.subscriptions.push(quickFixAllDisposable);

  // 3. Frontend Validation Command
  const validateDisposable = vscode.commands.registerCommand(
    "codeJanitor.validateFrontend",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found!");
        return;
      }

      const document = editor.document;
      if (!supportsFrontendValidation(document)) {
        vscode.window.showInformationMessage(
          "Frontend validation is supported for HTML, CSS, JS, TS, and common frontend module files."
        );
        return;
      }

      try {
        const { validator, graphContext } = createFrontendValidator(document, {
          useGraphContext: true
        });
        const result = validator.validate();
        updateFrontendDiagnostics(
          document,
          result,
          frontendDiagnosticCollection
        );

        if (result.hasIssues) {
          const issueCount = result.issues.length;
          const missingPackages = getMissingFrontendPackages(result.issues);
          const creatableCount = result.issues.filter(
            (issue) => issue.creatable
          ).length;
          const details =
            `Found ${issueCount} frontend issue(s):\n` +
            result.issues
              .map(
                (issue, index) =>
                  `${index + 1}. Line ${issue.line}, Col ${issue.column}: ${issue.message}`
              )
              .join("\n");
          const actions = [];

          if (creatableCount > 0) {
            actions.push("Create Files");
          }
          if (missingPackages.length > 0) {
            actions.push("Install Dependencies");
          }
          actions.push("Show Details", "Open Problems");

          const action = await vscode.window.showWarningMessage(
            buildFrontendValidationSummaryMessage(
              issueCount,
              creatableCount,
              missingPackages.length
            ),
            ...actions
          );

          if (action === "Create Files") {
            const creation = validator.createMissingFiles(result.issues);
            const refreshedResult = await validateFrontendFile(
              document,
              frontendDiagnosticCollection,
              { useGraphContext: true }
            );

            if (creation.createdFiles.length > 0) {
              const remaining = refreshedResult.issues.length;
              vscode.window.showInformationMessage(
                remaining > 0
                  ? `Created ${creation.createdFiles.length} file(s). ${remaining} frontend issue(s) still remain.`
                  : `Created ${creation.createdFiles.length} missing file(s).`
              );
            } else {
              vscode.window.showWarningMessage(
                "No missing files were created automatically. Some paths may be outside the workspace or non-creatable assets."
              );
            }
          } else if (action === "Install Dependencies") {
            installFrontendPackages(result.issues);
          } else if (action === "Show Details") {
            vscode.window.showInformationMessage(details);
          } else if (action === "Open Problems") {
            await vscode.commands.executeCommand(
              "workbench.actions.view.problems"
            );
          }
        } else {
          vscode.window.showInformationMessage(
            graphContext
              ? "No frontend validation issues found. Graphify context was used."
              : "No frontend validation issues found."
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Frontend validation error: ${error.message}`
        );
      }
    }
  );
  context.subscriptions.push(validateDisposable);

  // 4. Live Preview Command (Enhanced for React)
  const previewDisposable = vscode.commands.registerCommand(
    "codeJanitor.livePreview",
    () => livePreviewer(context)
  );
  context.subscriptions.push(previewDisposable);
  const inspectPreviewDisposable = vscode.commands.registerCommand(
    "codeJanitor.inspectLivePreview",
    () => livePreviewer(context, { inspect: true })
  );
  context.subscriptions.push(inspectPreviewDisposable);
  console.log("[OK] Enhanced Live Preview command registered.");

  // 5. AI Chat Command
  try {
    const chatDisposable = vscode.commands.registerCommand(
      "codeJanitor.openChat",
      async () => {
        try {
          console.log("[Extension] codeJanitor.openChat command triggered");
          if (!chatPanelInstance) {
            console.log("[Extension] Creating new ChatPanel instance");
            chatPanelInstance = new ChatPanel(context, workspaceMemoryService);
          }
          console.log("[Extension] Opening full-size chat panel");
          await chatPanelInstance.show();
          console.log("[Extension] Full-size chat panel opened successfully");
        } catch (error) {
          console.error("[Extension] CRITICAL ERROR in openChat command:", error);
          console.error("[Extension] Error stack:", error.stack);
          vscode.window.showErrorMessage(`Failed to open AI Chat: ${error.message}
Check Developer Console (Help -> Toggle Developer Tools) for details.`);
        }
      }
    );
    context.subscriptions.push(chatDisposable);
    console.log("[OK] AI Chat command registered.");
  } catch (regErr) {
    console.error("[Extension] Failed to register codeJanitor.openChat — likely a duplicate Code Janitor install. Continuing activation.", regErr);
  }

  // Bug Fix Scan Command (Alt+B)
  try {
    const bugFixScanDisposable = vscode.commands.registerCommand(
      "codeJanitor.bugFixScan",
      async () => {
        try {
          const editor = vscode.window.activeTextEditor;
          if (!chatPanelInstance) {
            chatPanelInstance = new ChatPanel(context, workspaceMemoryService);
          }
          await chatPanelInstance.show();
          await chatPanelInstance.runBugScan(editor);
        } catch (error) {
          console.error("[Extension] Error in bugFixScan command:", error);
          vscode.window.showErrorMessage(`Bug Fix scan failed: ${error.message}`);
        }
      }
    );
    context.subscriptions.push(bugFixScanDisposable);
    console.log("[OK] Bug Fix Scan command registered.");
  } catch (regErr) {
    console.error("[Extension] Failed to register codeJanitor.bugFixScan — likely a duplicate Code Janitor install. Continuing activation.", regErr);
  }
  // Generate Edge Cases Command
  const generateEdgeCasesDisposable = vscode.commands.registerCommand(
    "codeJanitor.generateEdgeCases",
    async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("No active editor found!");
          return;
        }

        const document = editor.document;
        const filePath = document.fileName;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (!workspaceRoot) {
          vscode.window.showErrorMessage("No workspace folder open!");
          return;
        }

        vscode.window.showInformationMessage("Generating edge cases...");

        const { generateEdgeCases } = require("./ai-agent/tools/generate-edge-cases");
        const relativePath = vscode.workspace.asRelativePath(filePath);
        const result = await generateEdgeCases(relativePath, workspaceRoot, {
          context,
          agent: chatPanelInstance?.agent || backgroundAiAgent
        });

        if (result.success) {
          const message = `Generated ${result.edgeCaseCount} edge cases for ${relativePath}`;
          const action = await vscode.window.showInformationMessage(
            message,
            "View Test Code",
            "Save Test File"
          );

          if (action === "View Test Code") {
            const doc = await vscode.workspace.openTextDocument({
              content: result.testCode,
              language: result.language
            });
            await vscode.window.showTextDocument(doc);
          } else if (action === "Save Test File") {
            const testFilePath = vscode.Uri.file(
              require("path").join(workspaceRoot, result.testFilePath)
            );
            const fs = require("fs").promises;
            await fs.mkdir(require("path").dirname(testFilePath.fsPath), { recursive: true });
            await fs.writeFile(testFilePath.fsPath, result.testCode);
            vscode.window.showInformationMessage(`Test file saved: ${result.testFilePath}`);
          }
        } else {
          vscode.window.showErrorMessage(`Edge case generation failed: ${result.error}`);
        }
      } catch (error) {
        console.error("[Extension] Error in generateEdgeCases command:", error);
        vscode.window.showErrorMessage(`Edge case generation failed: ${error.message}`);
      }
    }
  );
  context.subscriptions.push(generateEdgeCasesDisposable);
  console.log("[OK] Generate Edge Cases command registered.");

  // Execute Tests Command
  const executeTestsDisposable = vscode.commands.registerCommand(
    "codeJanitor.executeTests",
    async () => {
      try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (!workspaceRoot) {
          vscode.window.showErrorMessage("No workspace folder open!");
          return;
        }

        vscode.window.showInformationMessage("Executing tests...");

        const editor = vscode.window.activeTextEditor;
        const path = require("path");
        const fs = require("fs").promises;
        let generatedTestPath = null;
        let generatedSourcePath = null;

        if (editor?.document?.uri?.scheme === "file") {
          const relativeActivePath = vscode.workspace.asRelativePath(editor.document.fileName);
          const { getLanguage } = require("./ai-agent/tools/list-code-definition-names");
          const activeLanguage = getLanguage(relativeActivePath);
          const isExistingTestFile = /\.(test|spec)\.[^.]+$/i.test(relativeActivePath);

          if (activeLanguage && !isExistingTestFile) {
            const { generateEdgeCases } = require("./ai-agent/tools/generate-edge-cases");
            const edgeCaseResult = await generateEdgeCases(relativeActivePath, workspaceRoot, {
              context,
              agent: chatPanelInstance?.agent || backgroundAiAgent
            });

            if (edgeCaseResult.success) {
              const extension = path.extname(relativeActivePath);
              const sourceBaseName = path.basename(relativeActivePath, extension);
              generatedSourcePath = relativeActivePath;
              generatedTestPath = path.join(
                path.dirname(relativeActivePath),
                "__tests__",
                `${sourceBaseName}.edge-cases.generated.test${extension}`
              ).replace(/\\/g, "/");
              const absoluteGeneratedTestPath = path.join(workspaceRoot, generatedTestPath);
              await fs.mkdir(path.dirname(absoluteGeneratedTestPath), { recursive: true });
              await fs.writeFile(absoluteGeneratedTestPath, edgeCaseResult.testCode);
            }
          }
        }

        const { executeTests } = require("./ai-agent/tools/execute-tests");
        const result = await executeTests({
          testPath: generatedTestPath,
          generateReport: true,
          includeEdgeCases: true,
          temporaryTestPaths: generatedTestPath ? [generatedTestPath] : []
        }, workspaceRoot, {
          context,
          agent: chatPanelInstance?.agent || backgroundAiAgent
        });

        if (result.success) {
          const { summary, report } = result;
          const successRate = summary.total > 0 
            ? ((summary.passed / summary.total) * 100).toFixed(2) 
            : 0;

          const scopeLabel = generatedSourcePath
            ? `Generated edge-case tests for ${generatedSourcePath}`
            : "Tests";
          const message = `${scopeLabel}: ${summary.passed}/${summary.total} passed (${successRate}%)`;
          const action = await vscode.window.showInformationMessage(
            message,
            "View Report",
            "View Details"
          );

          if (action === "View Report" && report?.markdown) {
            const doc = await vscode.workspace.openTextDocument({
              content: report.markdown,
              language: "markdown"
            });
            await vscode.window.showTextDocument(doc);
          } else if (action === "View Details") {
            const details = `Test Execution Results\n\n` +
              `Framework: ${result.framework}\n` +
              `Total Tests: ${summary.total}\n` +
              `Passed: ${summary.passed}\n` +
              `Failed: ${summary.failed}\n` +
              `Skipped: ${summary.skipped}\n` +
              `Duration: ${(summary.duration / 1000).toFixed(2)}s\n` +
              `Success Rate: ${successRate}%\n` +
              `Generated Test File: ${
                generatedTestPath
                  ? result.cleanup?.removed?.includes(generatedTestPath)
                    ? `Removed after success (${generatedTestPath})`
                    : summary.failed > 0
                      ? `Kept for inspection (${generatedTestPath})`
                      : generatedTestPath
                  : "Not used"
              }`;
            
            const doc = await vscode.workspace.openTextDocument({
              content: details,
              language: "plaintext"
            });
            await vscode.window.showTextDocument(doc);
          }

          if (generatedTestPath && summary.failed > 0) {
            vscode.window.showWarningMessage(
              `Generated test file kept for inspection: ${generatedTestPath}`
            );
          } else if (generatedTestPath && result.cleanup?.failed?.length) {
            vscode.window.showWarningMessage(
              `Tests passed, but cleanup failed for: ${result.cleanup.failed.map((item) => item.path).join(", ")}`
            );
          }
        } else {
          vscode.window.showErrorMessage(`Test execution failed: ${result.error}`);
        }
      } catch (error) {
        console.error("[Extension] Error in executeTests command:", error);
        vscode.window.showErrorMessage(`Test execution failed: ${error.message}`);
      }
    }
  );
  context.subscriptions.push(executeTestsDisposable);
  console.log("[OK] Execute Tests command registered.");

  // Generate Documentation Command
  const generateDocumentationDisposable = vscode.commands.registerCommand(
    "codeJanitor.generateDocumentation",
    async () => {
      try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (!workspaceRoot) {
          vscode.window.showErrorMessage("No workspace folder open!");
          return;
        }

        const docType = await vscode.window.showQuickPick(
          [
            { label: "README", value: "readme", description: "Generate README.md" },
            { label: "API Documentation", value: "api", description: "Generate API.md" },
            { label: "Contributing Guide", value: "contributing", description: "Generate CONTRIBUTING.md" },
            { label: "Full Documentation", value: "full", description: "Generate complete documentation suite" }
          ],
          { placeHolder: "Select documentation type" }
        );

        if (!docType) return;

        vscode.window.showInformationMessage(`Generating ${docType.label}...`);

        const { generateDocumentation } = require("./ai-agent/tools/generate-documentation");
        const result = await generateDocumentation({
          type: docType.value,
          includeApi: true,
          includeExamples: true
        }, workspaceRoot);

        if (result.success) {
          const message = `Documentation generated: ${result.outputPath}`;
          const action = await vscode.window.showInformationMessage(
            message,
            "Open File",
            "View Summary"
          );

          if (action === "Open File") {
            const docUri = vscode.Uri.file(
              require("path").join(workspaceRoot, result.outputPath)
            );
            const doc = await vscode.workspace.openTextDocument(docUri);
            await vscode.window.showTextDocument(doc);
          } else if (action === "View Summary") {
            const summary = `Documentation Generation Summary\n\n` +
              `Type: ${result.type}\n` +
              `Output: ${result.outputPath}\n` +
              `Files Analyzed: ${result.analysis.files}\n` +
              `Functions Documented: ${result.analysis.functions}\n` +
              `Classes Documented: ${result.analysis.classes}\n` +
              `Languages: ${result.analysis.languages.join(", ")}`;
            
            const doc = await vscode.workspace.openTextDocument({
              content: summary,
              language: "plaintext"
            });
            await vscode.window.showTextDocument(doc);
          }
        } else {
          vscode.window.showErrorMessage(`Documentation generation failed: ${result.error}`);
        }
      } catch (error) {
        console.error("[Extension] Error in generateDocumentation command:", error);
        vscode.window.showErrorMessage(`Documentation generation failed: ${error.message}`);
      }
    }
  );
  context.subscriptions.push(generateDocumentationDisposable);
  console.log("[OK] Generate Documentation command registered.");


  const githubContextDisposable = vscode.commands.registerCommand(
    "codeJanitor.showGitHubContext",
    async () => {
      try {
        if (!chatPanelInstance) {
          chatPanelInstance = new ChatPanel(context, workspaceMemoryService);
        }
        await chatPanelInstance.runGitHubRepositoryContext();
      } catch (error) {
        console.error("[Extension] Error in showGitHubContext command:", error);
        vscode.window.showErrorMessage(
          `GitHub repository context failed: ${error.message}`
        );
      }
    }
  );
  context.subscriptions.push(githubContextDisposable);
  console.log("[OK] GitHub context command registered.");

  const refreshWorkspaceMemoryDisposable = vscode.commands.registerCommand(
    "codeJanitor.refreshWorkspaceMemory",
    async () => {
      try {
        const refreshed = await workspaceMemoryService.refreshAllNow("manual", {
          force: true
        });
        if (refreshed.length === 0) {
          vscode.window.showInformationMessage(
            "Code Janitor: Open a workspace folder to build workspace memory."
          );
          return;
        }

        vscode.window.showInformationMessage(
          `Code Janitor: Workspace memory refreshed (${refreshed
            .map((entry) => entry.relativePath)
            .join(", ")}).`
        );
      } catch (error) {
        console.error("[Extension] Error refreshing workspace memory:", error);
        vscode.window.showErrorMessage(
          `Workspace memory refresh failed: ${error.message}`
        );
      }
    }
  );
  context.subscriptions.push(refreshWorkspaceMemoryDisposable);
  console.log("[OK] Workspace memory refresh command registered.");

  const openWorkspaceMemoryDisposable = vscode.commands.registerCommand(
    "codeJanitor.openWorkspaceMemory",
    async () => {
      try {
        await workspaceMemoryService.refreshAllNow("open", { force: true });
        const openedPath = await workspaceMemoryService.openWorkspaceMemory();
        if (!openedPath) {
          vscode.window.showInformationMessage(
            "Code Janitor: Open a workspace folder to use workspace memory."
          );
        }
      } catch (error) {
        console.error("[Extension] Error opening workspace memory:", error);
        vscode.window.showErrorMessage(
          `Open workspace memory failed: ${error.message}`
        );
      }
    }
  );
  context.subscriptions.push(openWorkspaceMemoryDisposable);
  console.log("[OK] Workspace memory open command registered.");

  // 6. Graphify Command
  const graphifyPanel = new GraphifyPanel(context);
  const graphifyDisposable = vscode.commands.registerCommand(
    "codeJanitor.openGraphify",
    () => {
      console.log("[Extension] codeJanitor.openGraphify command triggered");
      graphifyPanel.show();
    }
  );
  context.subscriptions.push(graphifyDisposable);
  console.log("[OK] Graphify command registered.");

  // 7. Performance Report Command
  const performanceDisposable = vscode.commands.registerCommand(
    "codeJanitor.showPerformance",
    async () => {
      if (chatPanelInstance && chatPanelInstance.performanceMonitor) {
        const analysis = chatPanelInstance.performanceMonitor.analyzePerformance();
        await chatPanelInstance.performanceMonitor.showPerformanceReview(analysis);
      } else {
        vscode.window.showInformationMessage("Performance monitoring not available. Open AI Chat first.");
      }
    }
  );
  context.subscriptions.push(performanceDisposable);
  console.log("[OK] Performance report command registered.");

  // URI handler: vscode://Debanshu2005.code-janitor/check-models
  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri) {
      if (uri.path === "/check-models") {
        if (!chatPanelInstance) {
          chatPanelInstance = new ChatPanel(context, workspaceMemoryService);
        }
        chatPanelInstance.show();
      }
    }
  });
  context.subscriptions.push(uriHandler);

  // 7. Real-time Auto-correction (DISABLED BY DEFAULT)
  const changeDisposable = vscode.workspace.onDidChangeTextDocument(
    async (event) => {
      const config = vscode.workspace.getConfiguration("codeJanitor");
      // Auto-correction is now DISABLED by default to prevent code corruption
      if (!config.get("autoCorrection.enabled", false)) return;

      const document = event.document;
      const supportedLanguages = config.get("autoCorrection.languages", [
        "python",
        "javascript",
        "java",
        "c",
        "cpp",
        "html"
      ]);

      if (!supportedLanguages.includes(document.languageId)) return;
      if (isAutoFixing) return;

      // Clear previous timeout
      if (autoFixTimeout) {
        clearTimeout(autoFixTimeout);
      }

      // Set new timeout for debounced auto-correction
      const delay = config.get("autoCorrection.delay", 500);
      autoFixTimeout = setTimeout(async () => {
        if (isAutoFixing) return;

        try {
          isAutoFixing = true;
          await autoFixLine(
            document,
            vscode.window.activeTextEditor,
            event.contentChanges
          );
        } catch (error) {
          console.warn("Auto-correction error:", error.message);
        } finally {
          isAutoFixing = false;
        }
      }, delay);
    }
  );
  context.subscriptions.push(changeDisposable);

  // 8. Auto-fix and validate before save (DISABLED BY DEFAULT)
  const saveDisposable = vscode.workspace.onWillSaveTextDocument(
    async (event) => {
      const config = vscode.workspace.getConfiguration("codeJanitor");
      // Auto-fix on save is disabled by default to avoid surprising edits.
      if (!config.get("autoFixOnSave.enabled", false)) return;

      console.log("[INFO] Auto-fix triggered before save...");

      // Validate frontend files
      if (supportsFrontendValidation(event.document)) {
        await validateFrontendFile(
          event.document,
          frontendDiagnosticCollection,
          { useGraphContext: true }
        );
      }

      // Apply fixes and show preview for HTML files
      await runFixerAndApply(event.document);

      // For HTML files, the preview is already handled in runFixerAndApply
      // No additional action needed here
    }
  );
  context.subscriptions.push(saveDisposable);

  console.log("[OK] Code Janitor extension activated successfully!");
}

function updateFrontendDiagnostics(
  document,
  result,
  frontendDiagnosticCollection
) {
  if (!frontendDiagnosticCollection) {
    return;
  }

  const diagnostics = result.issues.map((issue) => {
    const startLine = Math.max((issue.line || 1) - 1, 0);
    const startColumn = Math.max((issue.column || 1) - 1, 0);
    const endColumn = startColumn + Math.max(issue.length || 1, 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(startLine, startColumn, startLine, endColumn),
      issue.message,
      vscode.DiagnosticSeverity.Error
    );

    diagnostic.source = FRONTEND_DIAGNOSTIC_SOURCE;
    diagnostic.code = issue.kind || issue.type || "frontend-validation";
    return diagnostic;
  });

  frontendDiagnosticCollection.set(document.uri, diagnostics);
}

// Helper function to validate frontend files
async function validateFrontendFile(
  document,
  frontendDiagnosticCollection,
  options = {}
) {
  try {
    const { validator } = createFrontendValidator(document, options);
    const result = validator.validate();
    updateFrontendDiagnostics(
      document,
      result,
      frontendDiagnosticCollection
    );

    if (result.hasIssues) {
      console.log(
        `Frontend validation found ${result.issues.length} issues in ${document.fileName}`
      );
      // Silently log issues during save, don't interrupt the save process
      result.issues.forEach((issue) => {
        console.log(`  - ${issue.message}`);
      });
    }

    return result;
  } catch (error) {
    console.warn(
      `Frontend validation error for ${document.fileName}:`,
      error.message
    );
    if (frontendDiagnosticCollection) {
      frontendDiagnosticCollection.set(document.uri, []);
    }
    return {
      hasIssues: false,
      issues: []
    };
  }
}

// Auto-fix specific lines that were changed
async function autoFixLine(document, editor, contentChanges) {
  try {
    const edit = new vscode.WorkspaceEdit();
    let hasChanges = false;

    for (const change of contentChanges) {
      const startLine = change.range.start.line;
      const endLine = change.range.end.line;

      // Get the affected line(s)
      for (
        let lineNum = startLine;
        lineNum <= Math.min(endLine + 1, document.lineCount - 1);
        lineNum++
      ) {
        try {
          const line = document.lineAt(lineNum);
          const lineText = line.text;

          if (!lineText.trim()) continue; // Skip empty lines

          const fixedLine = await fixSingleLine(
            lineText,
            document.languageId,
            document,
            lineNum
          );

          if (fixedLine && fixedLine !== lineText) {
            edit.replace(document.uri, line.range, fixedLine);
            hasChanges = true;
          }
        } catch (lineError) {
          console.warn(
            `Auto-fix failed for line ${lineNum}:`,
            lineError.message
          );
        }
      }
    }

    // Apply all changes in a single batch
    if (hasChanges) {
      await vscode.workspace.applyEdit(edit);
    }
  } catch (error) {
    console.error("Auto-fix error:", error.message);
  }
}

// Fix a single line based on language
async function fixSingleLine(lineText, languageId, document, lineNum) {
  try {
    const trimmed = lineText.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      return null; // Skip comments and empty lines
    }

    let fixed = lineText;

    // Get proper indentation context
    const indentLevel = getIndentLevel(document, lineNum);
    const properIndent = " ".repeat(Math.max(0, indentLevel * 4));

    switch (languageId) {
      case "python":
        // Use optimized Python line fixing for real-time
        fixed = fixPythonLineOptimized(lineText, properIndent);
        break;
      case "javascript":
      case "javascriptreact":
        fixed = fixJavaScriptLine(lineText, properIndent);
        break;
      case "java":
        fixed = fixJavaLine(lineText, properIndent);
        break;
      case "c":
      case "cpp":
      case "cppm":
        fixed = fixCLine(lineText, properIndent);
        break;
      case "html":
        fixed = fixHtmlLine(lineText, properIndent);
        break;
      default:
        return lineText;
    }

    return fixed;
  } catch (error) {
    console.warn(`Fix single line error for ${languageId}:`, error.message);
    return lineText;
  }
}

// Get proper indentation level for a line
function getIndentLevel(document, lineNum) {
  try {
    let indentLevel = 0;

    for (let i = lineNum - 1; i >= 0; i--) {
      if (i < 0 || i >= document.lineCount) continue;

      const prevLine = document.lineAt(i).text.trim();
      if (!prevLine) continue;

      if (prevLine.endsWith(":") || prevLine.endsWith("{")) {
        indentLevel++;
        break;
      }
      if (
        prevLine.match(
          /^(if|for|while|def|class|function|try|catch|else|elif)\b/
        )
      ) {
        indentLevel++;
        break;
      }
    }

    return Math.max(0, indentLevel);
  } catch (error) {
    console.warn("Indent level calculation error:", error.message);
    return 0;
  }
}

// Optimized Python line fixer for real-time auto-correction
function fixPythonLineOptimized(line, properIndent) {
  const trimmed = line.trim();

  // If line is empty or a comment, don't touch it
  if (!trimmed || trimmed.startsWith("#")) {
    return line;
  }

  // Preserve existing indentation if it looks correct
  const currentIndent = line.match(/^\s*/)[0];
  const hasValidIndent = currentIndent.length % 4 === 0;

  // Only fix actual syntax errors, not indentation
  let fixed = trimmed;

  // Fix missing colons (most common Python syntax error)
  if (
    /^(if|elif|else|def|class|for|while|try|except|finally|with)\b/.test(
      fixed
    ) &&
    !fixed.endsWith(":") &&
    !fixed.includes("#")
  ) {
    fixed += ":";
  }

  // Fix print statements (quick regex)
  if (/^print\s+[^(]/.test(fixed)) {
    fixed = fixed.replace(/^print\s+(.+)$/, "print($1)");
  }

  // Fix most common boolean/null values
  if (fixed.includes("true")) fixed = fixed.replace(/\btrue\b/g, "True");
  if (fixed.includes("false")) fixed = fixed.replace(/\bfalse\b/g, "False");
  if (fixed.includes("null")) fixed = fixed.replace(/\bnull\b/g, "None");

  // If nothing changed, return original line with original indentation
  if (fixed === trimmed) {
    return line;
  }

  // Use existing indentation if it's valid, otherwise use calculated indent
  return (hasValidIndent ? currentIndent : properIndent) + fixed;
}

// Language-specific line fixers
function fixJavaScriptLine(line) {
  // Disable auto-semicolon insertion - causes corruption
  return line;
}

function fixJavaLine(line) {
  // Disable auto-semicolon insertion - causes corruption
  return line;
}

function fixCLine(line) {
  // Disable auto-semicolon insertion - causes corruption
  return line;
}

function fixHtmlLine(line, properIndent) {
  // Basic HTML formatting - just apply proper indentation
  return properIndent + line.trim();
}

function deactivate() {
  console.log("[OK] Code Janitor extension deactivated");
}

module.exports = { activate, deactivate };

