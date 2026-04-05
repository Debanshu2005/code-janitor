const fs = require("fs")
const path = require("path")
const vscode = require("vscode")

let prettier
try {
  prettier = require(path.join(__dirname, "..", "node_modules", "prettier"))
} catch {
  try {
    prettier = require("prettier")
  } catch {
    prettier = null
    console.warn("Prettier not available for live preview")
  }
}

let currentPanel

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function stripNodeWrappers(code) {
  return code
    .replace(/^(const|var|let)\s+[^=]+\s*=\s*require\s*\([^)]+\);\s*$/gm, "")
    .replace(/^module\.exports\s*=\s*[\s\S]*;?$/gm, "")
    .replace(/^\s*(['"])use strict\1;?\s*$/gm, "")
}

function resolveLocalPath(src, documentPath) {
  if (!src || /^(https?:|data:|vscode-webview-resource:)/i.test(src)) {
    return null
  }

  const documentDir = path.dirname(documentPath)
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const candidates = path.isAbsolute(src)
    ? [src]
    : [
        path.resolve(documentDir, src),
        workspaceRoot ? path.resolve(workspaceRoot, src) : null
      ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function convertLocalPathsToWebviewUris(html, webview, documentPath) {
  return html.replace(
    /(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi,
    (match, prefix, src, suffix) => {
      const fullPath = resolveLocalPath(src, documentPath)
      if (!fullPath) {
        return match
      }

      return (
        prefix +
        webview.asWebviewUri(vscode.Uri.file(fullPath)).toString() +
        suffix
      )
    }
  )
}

async function formatCode(code, languageId, filePath) {
  if (!prettier) {
    return { fixedCode: code, hasError: false }
  }

  let parser
  switch (languageId) {
    case "html":
      parser = "html"
      break
    case "javascript":
    case "typescript":
    case "javascriptreact":
    case "typescriptreact":
      parser = "babel"
      break
    default:
      return { fixedCode: code, hasError: false }
  }

  try {
    const config = (await prettier.resolveConfig(filePath)) || {}
    const fixedCode = await prettier.format(code, {
      ...config,
      filepath: filePath,
      parser: config.parser || parser,
      semi: true,
      trailingComma: "none",
      printWidth: 120
    })

    return { fixedCode, hasError: false }
  } catch (error) {
    console.warn("Live preview formatting failed:", error.message)
    return { fixedCode: code, hasError: true }
  }
}

function getCommonStyles() {
  return `
    <style>
      body {
        font-family: "Segoe UI", sans-serif;
        padding: 10px;
        height: 100vh;
        display: flex;
        flex-direction: column;
        margin: 0;
        background: #f4f4f4;
      }
      .console-title {
        margin: 0 0 8px;
        color: #333;
        font-size: 1.05rem;
      }
      .error-bar {
        background: #fcebeb;
        color: #b42318;
        padding: 10px;
        border-left: 4px solid #b42318;
        margin-bottom: 10px;
        border-radius: 4px;
      }
      #output-container {
        flex: 1;
        min-height: 120px;
        overflow-y: auto;
        background: #1e1e1e;
        color: #d4d4d4;
        padding: 15px;
        border-radius: 6px;
        white-space: pre-wrap;
        font-family: monospace;
      }
      .log { color: #a7f3d0; }
      .warn { color: #ffd700; }
      .error { color: #ff7b72; font-weight: 600; }
      .code-display {
        background: #272822;
        color: #f8f8f2;
        padding: 15px;
        border-radius: 6px;
        white-space: pre-wrap;
        overflow-x: auto;
      }
      .command-block {
        background: #2563eb;
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-family: monospace;
        cursor: copy;
        margin: 6px 0;
      }
      #react-container {
        flex: 1;
        padding: 20px;
        border: 1px solid #ddd;
        border-radius: 6px;
        background: white;
      }
    </style>
  `
}

function getConsoleScript(executionScript) {
  return `
    <script>
      (function () {
        const outputContainer = document.getElementById("output-container");
        outputContainer.innerHTML = "";

        function appendOutput(type, message) {
          const messageElement = document.createElement("div");
          messageElement.className = type;
          messageElement.textContent = message;
          outputContainer.appendChild(messageElement);
          outputContainer.scrollTop = outputContainer.scrollHeight;
        }

        function safeStringify(item) {
          try {
            return JSON.stringify(item, (key, value) => {
              if (value instanceof HTMLElement) return "<HTMLElement>";
              if (typeof value === "function") return "<Function>";
              return value;
            }, 2);
          } catch {
            return String(item);
          }
        }

        const originalConsole = {
          log: console.log,
          error: console.error,
          warn: console.warn
        };

        console.log = function (...args) {
          originalConsole.log(...args);
          appendOutput("log", "[LOG] " + args.map((arg) =>
            typeof arg === "object" && arg !== null ? safeStringify(arg) : String(arg)
          ).join(" "));
        };

        console.error = function (...args) {
          originalConsole.error(...args);
          appendOutput("error", "[ERROR] " + args.map(String).join(" "));
        };

        console.warn = function (...args) {
          originalConsole.warn(...args);
          appendOutput("warn", "[WARN] " + args.map(String).join(" "));
        };

        try {
          ${executionScript}
        } catch (error) {
          appendOutput("error", "--- RUNTIME ERROR ---");
          appendOutput("error", error.stack || error.message || String(error));
        }
      })();
    </script>
  `
}

function getExecutionView(languageId, fixedCode, hasError) {
  const isPython = languageId === "python"
  const executableCode = isPython ? fixedCode : stripNodeWrappers(fixedCode)
  const executionScript = isPython
    ? `console.warn("[SETUP] Python execution is simulated."); console.log(${JSON.stringify(
        fixedCode
      )});`
    : executableCode

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${isPython ? "Python" : "JS/TS"} Preview</title>
        ${getCommonStyles()}
      </head>
      <body>
        <h3 class="console-title">Live ${isPython ? "Python" : "JS/TS"} Output</h3>
        ${hasError ? '<div class="error-bar">Formatting failed. Running the original code.</div>' : ""}
        <div id="output-container">Console output will appear here.</div>
        ${getConsoleScript(executionScript)}
      </body>
    </html>
  `
}

function getReactView(fixedCode, hasError) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>React/JSX Live Preview</title>
        ${getCommonStyles()}
        <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
        <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
        <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
      </head>
      <body>
        <h3 class="console-title">Live React/JSX Preview</h3>
        ${hasError ? '<div class="error-bar">Formatting failed. Running the original code.</div>' : ""}
        <div id="react-container"></div>
        <h3 class="console-title">Console Output</h3>
        <div id="output-container">Console output will appear here.</div>
        <script type="text/babel">
          function appendOutput(type, message) {
            const outputContainer = document.getElementById("output-container");
            const messageElement = document.createElement("div");
            messageElement.className = type;
            messageElement.textContent = message;
            outputContainer.appendChild(messageElement);
            outputContainer.scrollTop = outputContainer.scrollHeight;
          }

          const originalConsole = { log: console.log, error: console.error, warn: console.warn };
          console.log = (...args) => { originalConsole.log(...args); appendOutput("log", args.map(String).join(" ")); };
          console.error = (...args) => { originalConsole.error(...args); appendOutput("error", args.map(String).join(" ")); };
          console.warn = (...args) => { originalConsole.warn(...args); appendOutput("warn", args.map(String).join(" ")); };

          try {
            ${fixedCode}
            const container = document.getElementById("react-container");
            const root = ReactDOM.createRoot(container);

            if (typeof App !== "undefined") {
              root.render(<App />);
            } else if (typeof Component !== "undefined") {
              root.render(<Component />);
            } else {
              appendOutput("warn", "Define a component named App or Component.");
            }
          } catch (error) {
            appendOutput("error", error.stack || error.message || String(error));
          }
        </script>
      </body>
    </html>
  `
}

function getCompiledLanguageView(languageId, fixedCode) {
  const isJava = languageId === "java"
  const classNameMatch = fixedCode.match(/public\s+class\s+(\w+)/)
  const className = classNameMatch ? classNameMatch[1] : "Main"
  const fileName = isJava ? `${className}.java` : "main.c"
  const compileCommand = isJava
    ? `javac ${fileName}`
    : `gcc ${fileName} -o myprogram`
  const runCommand = isJava ? `java ${className}` : "./myprogram"

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${isJava ? "Java" : "C"} Execution Instructions</title>
        ${getCommonStyles()}
      </head>
      <body>
        <h3 class="console-title">Local Execution Steps for ${isJava ? "Java" : "C"}</h3>
        <div class="command-block">${compileCommand}</div>
        <div class="command-block">${runCommand}</div>
        <pre class="code-display">${escapeHTML(fixedCode)}</pre>
      </body>
    </html>
  `
}

function getWebviewContent(languageId, fixedCode, hasError) {
  if (languageId === "html") {
    return fixedCode
  }

  if (languageId === "javascriptreact" || languageId === "typescriptreact") {
    return getReactView(fixedCode, hasError)
  }

  if (
    languageId === "javascript" ||
    languageId === "typescript" ||
    languageId === "python"
  ) {
    return getExecutionView(languageId, fixedCode, hasError)
  }

  if (languageId === "c" || languageId === "java") {
    return getCompiledLanguageView(languageId, fixedCode)
  }

  return `<pre class="code-display">${escapeHTML(fixedCode)}</pre>`
}

function getLocalResourceRoots(documentPath) {
  const roots = [vscode.Uri.file(path.dirname(documentPath))]
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

  if (workspaceRoot) {
    roots.push(vscode.Uri.file(workspaceRoot))
  }

  return roots
}

function livePreviewer(context) {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    return vscode.window.showInformationMessage(
      "Open a supported file to start the live preview."
    )
  }

  const document = editor.document
  const languageId = document.languageId
  const supportedLanguages = [
    "html",
    "javascript",
    "typescript",
    "javascriptreact",
    "typescriptreact",
    "python",
    "c",
    "java"
  ]

  if (!supportedLanguages.includes(languageId)) {
    return vscode.window.showWarningMessage(
      `Live Preview supports HTML, JS/TS, React/JSX, Python, C, and Java. Detected: ${languageId}`
    )
  }

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside)
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      "livePreview",
      `Live Preview: ${path.basename(document.fileName)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: getLocalResourceRoots(document.fileName)
      }
    )

    currentPanel.onDidDispose(
      () => {
        currentPanel = undefined
      },
      null,
      context.subscriptions
    )
  }

  const panel = currentPanel

  const updateWebview = async () => {
    const rawCode = document.getText()
    const { fixedCode, hasError } = await formatCode(
      rawCode,
      languageId,
      document.fileName
    )

    const processedCode =
      languageId === "html"
        ? convertLocalPathsToWebviewUris(
            fixedCode,
            panel.webview,
            document.fileName
          )
        : fixedCode

    panel.webview.html = getWebviewContent(languageId, processedCode, hasError)
  }

  updateWebview()

  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document === document) {
      updateWebview()
    }
  })

  panel.onDidDispose(
    () => {
      changeListener.dispose()
    },
    null,
    context.subscriptions
  )
}

module.exports = livePreviewer
