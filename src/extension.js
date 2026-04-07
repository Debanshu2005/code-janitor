const vscode = require("vscode")
const Linter = require("./core/linter")
const FrontendValidator = require("./core/frontend-validator")
const livePreviewer = require("./live-preview")
const OllamaClient = require("./core/ai/ollama-client")
const ChatPanel = require("./ai-agent/chat-panel")

// Map file extensions / languageIds → fixer
function getFixerForDocument(document, code, fileName) {
  console.log(`Debug - Language ID: ${document.languageId}, File: ${fileName}`)

  const fixerMap = {
    c: () => new (require("./core/fixers/EmbeddedCFixer"))(code, fileName),
    cpp: () => new (require("./core/fixers/EmbeddedCFixer"))(code, fileName),
    cppm: () => new (require("./core/fixers/EmbeddedCFixer"))(code, fileName),
    java: () => new (require("./core/fixers/JavaFixer"))(code, fileName),
    javascript: () =>
      new (require("./core/fixers/javascript-fixer"))(code, fileName),
    javascriptreact: () =>
      new (require("./core/fixers/javascript-fixer"))(code, fileName),
    python: () => new (require("./core/fixers/python-fixer"))(code, fileName),
    html: () => new (require("./core/fixers/html-fixer"))(code, fileName)
  }

  // Check by language ID first
  if (fixerMap[document.languageId]) {
    console.log(`Found fixer by language ID: ${document.languageId}`)
    return fixerMap[document.languageId]()
  }

  // Check by file extension
  if (/\.(c|h|cpp|ino)$/i.test(fileName)) return fixerMap.c()
  if (/\.(js|jsx)$/i.test(fileName)) {
    console.log("Found JS file by extension")
    return fixerMap.javascript()
  }
  if (fileName.endsWith(".java")) return fixerMap.java()
  if (fileName.endsWith(".py")) return fixerMap.python()
  if (fileName.endsWith(".html")) return fixerMap.html()

  console.log(
    `No fixer found for languageId: ${document.languageId}, fileName: ${fileName}`
  )
  return null
}

async function runFixerAndApply(document, editor = null) {
  const code = document.getText()
  const fileName = document.fileName

  console.log(`✓ Processing file: ${fileName}`)
  console.log(`✓ File languageId: ${document.languageId}`)

  const fixer = getFixerForDocument(document, code, fileName)
  if (!fixer) {
    vscode.window.showInformationMessage("Unsupported file type!")
    return false
  }

  try {
    console.log("✓ Fixer loaded successfully, analyzing code...")
    let result = null

    if (fixer.analyze) {
      result = await fixer.analyze()
    }

    let fixedCode = code
    if (result && typeof result.fixedCode === "string") {
      fixedCode = result.fixedCode
    } else if (result && result.formatted) {
      fixedCode = result.formatted
    } else if (fixer.applyFixes) {
      fixedCode = fixer.applyFixes()
    } else if (fixer.getFixedCode) {
      fixedCode = fixer.getFixedCode()
    }

    // AI validation and enhancement (skip for fixer files)
    const isFixerFile =
      fileName.includes("\\fixers\\") || fileName.includes("/fixers/")
    const ollamaClient = new OllamaClient()
    const shouldSkipAI = result && result.skipAI === true
    const shouldTryAI = !shouldSkipAI || (result && result.shouldTryAI === true)

    if (!isFixerFile && shouldTryAI && (await ollamaClient.isAvailable())) {
      const language =
        document.languageId === "javascriptreact"
          ? "javascript"
          : document.languageId === "cppm"
            ? "cpp"
            : document.languageId

      const supportedLanguages = [
        "python",
        "javascript",
        "java",
        "c",
        "cpp",
        "html"
      ]
      if (supportedLanguages.includes(language)) {
        console.log(`🤖 Using AI-only fixing for ${language}...`)
        const aiResult = await ollamaClient.validateAndFix(
          code,
          fixedCode,
          language
        )
        if (aiResult && aiResult.shouldUseAI) {
          console.log(`🤖 AI fixed code: ${aiResult.reason}`)
          fixedCode = aiResult.fixedCode
        } else {
          console.log(`✓ No AI changes needed`)
        }
      }
    }

    if (fixedCode === code) {
      console.log("✨ No changes detected")
      return false
    }

    console.log("✓ Code analysis complete, applying fixes...")
    const edit = new vscode.WorkspaceEdit()
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.lineAt(document.lineCount - 1).range.end
    )
    edit.replace(document.uri, fullRange, fixedCode)
    await vscode.workspace.applyEdit(edit)

    if (editor) {
      await document.save()
    }

    // Show change log for HTML files
    if (
      result &&
      result.changeLog &&
      result.changeLog.length > 0 &&
      fileName.endsWith(".html")
    ) {
      const changes = result.changeLog.join("\n• ")

      if (result.warning) {
        vscode.window.showWarningMessage(
          `${result.warning}\n\nFixes applied:\n• ${changes}`,
          { modal: false }
        )
      } else {
        // Show changes with preview option
        vscode.window
          .showInformationMessage(
            `HTML fixes applied:\n• ${changes}`,
            "Show Preview"
          )
          .then((selection) => {
            if (selection === "Show Preview") {
              livePreviewer(globalContext)
            }
          })

        // Also auto-show preview if enabled
        if (result.shouldShowPreview) {
          setTimeout(async () => {
            try {
              await livePreviewer(globalContext)
            } catch (error) {
              console.warn("Could not show preview:", error.message)
            }
          }, 1000) // Delay to let user read the changes first
        }
      }
    } else if (result && result.warning && fileName.endsWith(".html")) {
      vscode.window.showWarningMessage(result.warning)
    }

    console.log("✓ Code formatted successfully!")
    return true
  } catch (error) {
    console.error("✗ Code Janitor error:", error)
    vscode.window.showErrorMessage(`Code Janitor Error: ${error.message}`)
    return false
  }
}

let globalContext // Store context globally

function activate(context) {
  console.log("✓ Code Janitor extension is activating...")
  globalContext = context

  // Show setup guide on first install
  const hasSeenSetup = context.globalState.get("codeJanitor.seenSetup", false);
  if (!hasSeenSetup) {
    vscode.window.showInformationMessage(
      "🧹 Welcome to Code Janitor! Check the setup guide to get started with AI models.",
      "Open Setup Guide",
      "Dismiss"
    ).then(selection => {
      if (selection === "Open Setup Guide") {
        context.globalState.update("codeJanitor.seenSetup", true);
        vscode.env.openExternal(vscode.Uri.parse("https://code-janitor-web.vercel.app"));
      }
    });
  }

  // Auto-correction state
  let isAutoFixing = false
  let autoFixTimeout = null

  // 1. Manual Fix Command
  const fixDisposable = vscode.commands.registerCommand(
    "codeJanitor.fixCode",
    async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found!")
        return
      }

      const changed = await runFixerAndApply(editor.document, editor)
      if (changed) {
        // Success message is now handled in runFixerAndApply for HTML files
        if (!editor.document.fileName.endsWith(".html")) {
          vscode.window.showInformationMessage(
            "✅ Code formatted successfully!"
          )
        }
      } else {
        vscode.window.showInformationMessage("✨ Nothing to fix!")
      }
    }
  )
  context.subscriptions.push(fixDisposable)

  // Create diagnostics collection for linting issues
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("codeJanitor")
  context.subscriptions.push(diagnosticCollection)

  // 2. Lint Command
  const lintDisposable = vscode.commands.registerCommand(
    "codeJanitor.lintCode",
    async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found!")
        return
      }

      const document = editor.document
      if (
        document.languageId !== "javascript" &&
        document.languageId !== "javascriptreact"
      ) {
        vscode.window.showInformationMessage(
          "Linting is currently only supported for JavaScript files."
        )
        return
      }

      try {
        const linter = new Linter(document.fileName)
        const result = await linter.lint()

        if (result.success) {
          if (result.issues && result.issues.length > 0) {
            // Convert issues to VS Code diagnostics
            const diagnostics = result.issues.map((issue) => {
              const range = new vscode.Range(
                new vscode.Position(issue.line - 1, issue.column - 1),
                new vscode.Position(issue.line - 1, issue.column - 1 + 10)
              )
              const severity =
                issue.severity === 2
                  ? vscode.DiagnosticSeverity.Error
                  : vscode.DiagnosticSeverity.Warning
              const diagnostic = new vscode.Diagnostic(
                range,
                issue.message,
                severity
              )
              diagnostic.source = "Code Janitor"
              if (issue.ruleId) {
                diagnostic.code = issue.ruleId
              }
              return diagnostic
            })

            // Set diagnostics in Problems panel
            diagnosticCollection.set(document.uri, diagnostics)

            const issueCount = result.issues.length
            vscode.window.showWarningMessage(
              `Found ${issueCount} linting issue(s). Check Problems panel for details.`
            )
          } else {
            // Clear diagnostics if no issues
            diagnosticCollection.set(document.uri, [])
            vscode.window.showInformationMessage("✅ No linting issues found!")
          }
        } else {
          vscode.window.showErrorMessage(`Linting failed: ${result.message}`)
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Linter error: ${error.message}`)
      }
    }
  )
  context.subscriptions.push(lintDisposable)

  // 3. Frontend Validation Command
  const validateDisposable = vscode.commands.registerCommand(
    "codeJanitor.validateFrontend",
    async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found!")
        return
      }

      const document = editor.document
      const ext = document.fileName.toLowerCase()

      if (
        !ext.endsWith(".html") &&
        !ext.endsWith(".css") &&
        !ext.endsWith(".js")
      ) {
        vscode.window.showInformationMessage(
          "Frontend validation is only supported for HTML, CSS, and JS files."
        )
        return
      }

      try {
        const validator = new FrontendValidator(
          document.fileName,
          document.getText()
        )
        const result = validator.validate()

        if (result.hasIssues) {
          const issueCount = result.issues.length
          const message =
            `Found ${issueCount} frontend issue(s):\n` +
            result.issues.map((issue) => `• ${issue.message}`).join("\n")

          const action = await vscode.window.showWarningMessage(
            `Found ${issueCount} missing file(s). Create missing files?`,
            "Create Files",
            "Show Details",
            "Cancel"
          )

          if (action === "Create Files") {
            result._applyFixes()
            vscode.window.showInformationMessage(
              "✅ Missing files created successfully!"
            )
          } else if (action === "Show Details") {
            vscode.window.showInformationMessage(message)
          }
        } else {
          vscode.window.showInformationMessage(
            "✅ No frontend validation issues found!"
          )
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Frontend validation error: ${error.message}`
        )
      }
    }
  )
  context.subscriptions.push(validateDisposable)

  // 4. Live Preview Command (Enhanced for React)
  const previewDisposable = vscode.commands.registerCommand(
    "codeJanitor.livePreview",
    () => livePreviewer(context)
  )
  context.subscriptions.push(previewDisposable)
  console.log("✓ Enhanced Live Preview command registered.")

  // 5. AI Chat Command
  const chatPanel = new ChatPanel(context)
  const chatDisposable = vscode.commands.registerCommand(
    "codeJanitor.openChat",
    () => chatPanel.show()
  )
  context.subscriptions.push(chatDisposable)
  console.log("✓ AI Chat command registered.")

  // URI handler: vscode://Debanshu2005.code-janitor/check-models
  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri) {
      if (uri.path === "/check-models") {
        chatPanel.show()
      }
    }
  })
  context.subscriptions.push(uriHandler)

  // 6. Real-time Auto-correction
  const changeDisposable = vscode.workspace.onDidChangeTextDocument(
    async (event) => {
      const config = vscode.workspace.getConfiguration("codeJanitor")
      if (!config.get("autoCorrection.enabled", true)) return

      const document = event.document
      const supportedLanguages = config.get("autoCorrection.languages", [
        "python",
        "javascript",
        "java",
        "c",
        "cpp",
        "html"
      ])

      if (!supportedLanguages.includes(document.languageId)) return
      if (isAutoFixing) return

      // Clear previous timeout
      if (autoFixTimeout) {
        clearTimeout(autoFixTimeout)
      }

      // Set new timeout for debounced auto-correction
      const delay = config.get("autoCorrection.delay", 500)
      autoFixTimeout = setTimeout(async () => {
        if (isAutoFixing) return

        try {
          isAutoFixing = true
          await autoFixLine(
            document,
            vscode.window.activeTextEditor,
            event.contentChanges
          )
        } catch (error) {
          console.warn("Auto-correction error:", error.message)
        } finally {
          isAutoFixing = false
        }
      }, delay)
    }
  )
  context.subscriptions.push(changeDisposable)

  // 7. Auto-fix and validate before save
  const saveDisposable = vscode.workspace.onWillSaveTextDocument(
    async (event) => {
      console.log("🧹 Auto-fix triggered before save...")

      // Validate frontend files
      const ext = event.document.fileName.toLowerCase()
      if (
        ext.endsWith(".html") ||
        ext.endsWith(".css") ||
        ext.endsWith(".js")
      ) {
        await validateFrontendFile(event.document)
      }

      // Apply fixes and show preview for HTML files
      const changed = await runFixerAndApply(event.document)

      // For HTML files, the preview is already handled in runFixerAndApply
      // No additional action needed here
    }
  )
  context.subscriptions.push(saveDisposable)

  console.log("✓ Code Janitor extension activated successfully!")
}

// Helper function to check if file is supported
function isSupportedFile(fileName, languageId) {
  const supportedExtensions = /\.(c|h|cpp|ino|java|js|jsx|py|html)$/i
  const supportedLanguages = [
    "c",
    "cpp",
    "cppm",
    "java",
    "javascript",
    "javascriptreact",
    "python",
    "html"
  ]

  return (
    supportedExtensions.test(fileName) ||
    supportedLanguages.includes(languageId)
  )
}

// Helper function to validate frontend files
async function validateFrontendFile(document) {
  try {
    const validator = new FrontendValidator(
      document.fileName,
      document.getText()
    )
    const result = validator.validate()

    if (result.hasIssues) {
      console.log(
        `Frontend validation found ${result.issues.length} issues in ${document.fileName}`
      )
      // Silently log issues during save, don't interrupt the save process
      result.issues.forEach((issue) => {
        console.log(`  - ${issue.message}`)
      })
    }
  } catch (error) {
    console.warn(
      `Frontend validation error for ${document.fileName}:`,
      error.message
    )
  }
}

// Auto-fix specific lines that were changed
async function autoFixLine(document, editor, contentChanges) {
  try {
    const edit = new vscode.WorkspaceEdit()
    let hasChanges = false

    for (const change of contentChanges) {
      const startLine = change.range.start.line
      const endLine = change.range.end.line

      // Get the affected line(s)
      for (
        let lineNum = startLine;
        lineNum <= Math.min(endLine + 1, document.lineCount - 1);
        lineNum++
      ) {
        try {
          const line = document.lineAt(lineNum)
          const lineText = line.text

          if (!lineText.trim()) continue // Skip empty lines

          const fixedLine = await fixSingleLine(
            lineText,
            document.languageId,
            document,
            lineNum
          )

          if (fixedLine && fixedLine !== lineText) {
            edit.replace(document.uri, line.range, fixedLine)
            hasChanges = true
          }
        } catch (lineError) {
          console.warn(
            `Auto-fix failed for line ${lineNum}:`,
            lineError.message
          )
        }
      }
    }

    // Apply all changes in a single batch
    if (hasChanges) {
      await vscode.workspace.applyEdit(edit)
    }
  } catch (error) {
    console.error("Auto-fix error:", error.message)
  }
}

// Fix a single line based on language
async function fixSingleLine(lineText, languageId, document, lineNum) {
  try {
    const trimmed = lineText.trim()
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      return null // Skip comments and empty lines
    }

    let fixed = lineText

    // Get proper indentation context
    const indentLevel = getIndentLevel(document, lineNum)
    const properIndent = " ".repeat(Math.max(0, indentLevel * 4))

    switch (languageId) {
      case "python":
        // Use optimized Python line fixing for real-time
        fixed = fixPythonLineOptimized(lineText, properIndent)
        break
      case "javascript":
      case "javascriptreact":
        fixed = fixJavaScriptLine(lineText, properIndent)
        break
      case "java":
        fixed = fixJavaLine(lineText, properIndent)
        break
      case "c":
      case "cpp":
      case "cppm":
        fixed = fixCLine(lineText, properIndent)
        break
      case "html":
        fixed = fixHtmlLine(lineText, properIndent)
        break
      default:
        return lineText
    }

    return fixed
  } catch (error) {
    console.warn(`Fix single line error for ${languageId}:`, error.message)
    return lineText
  }
}

// Get proper indentation level for a line
function getIndentLevel(document, lineNum) {
  try {
    let indentLevel = 0

    for (let i = lineNum - 1; i >= 0; i--) {
      if (i < 0 || i >= document.lineCount) continue

      const prevLine = document.lineAt(i).text.trim()
      if (!prevLine) continue

      if (prevLine.endsWith(":") || prevLine.endsWith("{")) {
        indentLevel++
        break
      }
      if (
        prevLine.match(
          /^(if|for|while|def|class|function|try|catch|else|elif)\b/
        )
      ) {
        indentLevel++
        break
      }
    }

    return Math.max(0, indentLevel)
  } catch (error) {
    console.warn("Indent level calculation error:", error.message)
    return 0
  }
}

// Optimized Python line fixer for real-time auto-correction
function fixPythonLineOptimized(line, properIndent) {
  let fixed = line.trim()

  // Only apply the most essential fixes for real-time performance

  // Fix missing colons (most common Python syntax error)
  if (
    /^(if|elif|else|def|class|for|while|try|except|finally|with)\b/.test(
      fixed
    ) &&
    !fixed.endsWith(":") &&
    !fixed.includes("#")
  ) {
    fixed += ":"
  }

  // Fix print statements (quick regex)
  if (/^print\s+[^\(]/.test(fixed)) {
    fixed = fixed.replace(/^print\s+(.+)$/, "print($1)")
  }

  // Fix most common boolean/null values
  if (fixed.includes("true")) fixed = fixed.replace(/\btrue\b/g, "True")
  if (fixed.includes("false")) fixed = fixed.replace(/\bfalse\b/g, "False")
  if (fixed.includes("null")) fixed = fixed.replace(/\bnull\b/g, "None")

  return properIndent + fixed
}

// Language-specific line fixers
function fixPythonLine(line, properIndent) {
  let fixed = line.trim()

  // Fix missing colons
  if (
    /^(if|elif|else|def|class|for|while|try|except|finally|with)\b/.test(
      fixed
    ) &&
    !fixed.endsWith(":") &&
    !fixed.includes("#")
  ) {
    fixed += ":"
  }

  // Fix print statements
  fixed = fixed.replace(/^print\s+([^\(].+)$/, "print($1)")

  // Fix boolean values
  fixed = fixed
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None")
    .replace(/\bundefined\b/g, "None")

  // Remove JS keywords only if they appear to be JavaScript syntax
  if (
    /^(var|let|const)\s+\w+\s*=/.test(fixed) ||
    /^function\s+\w+\s*\(/.test(fixed)
  ) {
    fixed = fixed.replace(/^(var|let|const|function)\s+/, "")
  }

  return properIndent + fixed
}

function fixJavaScriptLine(line, properIndent) {
  // Disable auto-semicolon insertion - causes corruption
  return line
}

function fixJavaLine(line, properIndent) {
  // Disable auto-semicolon insertion - causes corruption
  return line
}

function fixCLine(line, properIndent) {
  // Disable auto-semicolon insertion - causes corruption
  return line
}

function fixHtmlLine(line, properIndent) {
  // Basic HTML formatting - just apply proper indentation
  return properIndent + line.trim()
}

function deactivate() {
  console.log("✓ Code Janitor extension deactivated")
}

module.exports = { activate, deactivate }
