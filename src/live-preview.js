const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

let prettier;
try {
  prettier = require(path.join(__dirname, "..", "node_modules", "prettier"));
} catch {
  try {
    prettier = require("prettier");
  } catch {
    prettier = null;
    console.warn("Prettier not available for live preview");
  }
}

let currentPanel;
let currentChangeListener;
let currentMessageListener;
let currentPreviewState;

function clonePreviewDiagnostics(diagnostics) {
  return diagnostics ? JSON.parse(JSON.stringify(diagnostics)) : null;
}

function createPreviewDiagnostics(documentPath, languageId, sessionId) {
  return {
    documentPath,
    languageId,
    sessionId,
    ready: false,
    title: "",
    bodyTextExcerpt: "",
    logs: [],
    warnings: [],
    errors: [],
    resourceFailures: [],
    readyAt: null
  };
}

function pushPreviewEntry(list, entry) {
  list.push(entry);
  if (list.length > 20) {
    list.shift();
  }
}

function withPreviewInstrumentation(html, sessionId) {
  const script = `
<script>
  (function () {
    const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
    const sessionId = ${JSON.stringify(sessionId)};

    function send(type, payload) {
      if (!vscode) return;
      vscode.postMessage(Object.assign({ type: type, sessionId: sessionId }, payload || {}));
    }

    function truncate(value, maxLength) {
      const text = String(value == null ? "" : value);
      return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
    }

    function stringifyArg(value) {
      try {
        if (typeof value === "string") return value;
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }

    const originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };

    console.log = function (...args) {
      originalConsole.log(...args);
      send("previewLog", { level: "log", message: truncate(args.map(stringifyArg).join(" "), 400) });
    };

    console.warn = function (...args) {
      originalConsole.warn(...args);
      send("previewLog", { level: "warn", message: truncate(args.map(stringifyArg).join(" "), 400) });
    };

    console.error = function (...args) {
      originalConsole.error(...args);
      send("previewLog", { level: "error", message: truncate(args.map(stringifyArg).join(" "), 400) });
    };

    window.addEventListener("error", function (event) {
      const target = event && event.target;
      if (target && target !== window) {
        send("previewResourceError", {
          tagName: target.tagName || "",
          url: truncate(target.currentSrc || target.src || target.href || "", 500),
          message: truncate("Failed to load resource", 400)
        });
        return;
      }

      send("previewError", {
        message: truncate((event && (event.message || event.error && event.error.message)) || "Unknown runtime error", 600),
        stack: truncate(event && event.error && event.error.stack ? event.error.stack : "", 2000),
        source: truncate(event && event.filename ? event.filename : "", 500),
        line: event && event.lineno ? event.lineno : null,
        column: event && event.colno ? event.colno : null
      });
    }, true);

    window.addEventListener("unhandledrejection", function (event) {
      const reason = event && event.reason;
      send("previewError", {
        message: truncate(reason && reason.message ? reason.message : String(reason || "Unhandled promise rejection"), 600),
        stack: truncate(reason && reason.stack ? reason.stack : "", 2000),
        source: "unhandledrejection"
      });
    });

    function reportReady() {
      const bodyText = document.body && document.body.innerText
        ? truncate(document.body.innerText.replace(/\\s+/g, " ").trim(), 500)
        : "";
      send("previewReady", {
        title: truncate(document.title || "", 200),
        bodyTextExcerpt: bodyText
      });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(reportReady, 150);
    } else {
      window.addEventListener("DOMContentLoaded", function () {
        setTimeout(reportReady, 150);
      }, { once: true });
    }
  })();
</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}</body>`);
  }

  return `${html}${script}`;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripNodeWrappers(code) {
  return code
    .replace(/^(const|var|let)\s+[^=]+\s*=\s*require\s*\([^)]+\);\s*$/gm, "")
    .replace(/^module\.exports\s*=\s*[\s\S]*;?$/gm, "")
    .replace(/^\s*(['"])use strict\1;?\s*$/gm, "");
}

function resolveLocalPath(src, documentPath) {
  if (!src || /^(https?:|data:|vscode-webview-resource:)/i.test(src)) {
    return null;
  }

  const documentDir = path.dirname(documentPath);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const candidates = path.isAbsolute(src)
    ? [src]
    : [
        path.resolve(documentDir, src),
        workspaceRoot ? path.resolve(workspaceRoot, src) : null
      ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function convertLocalPathsToWebviewUris(html, webview, documentPath) {
  return html.replace(
    /(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi,
    (match, prefix, src, suffix) => {
      const fullPath = resolveLocalPath(src, documentPath);
      if (!fullPath) {
        return match;
      }

      return (
        prefix +
        webview.asWebviewUri(vscode.Uri.file(fullPath)).toString() +
        suffix
      );
    }
  );
}

async function formatCode(code, languageId, filePath) {
  if (!prettier) {
    return { fixedCode: code, hasError: false };
  }

  let parser;
  switch (languageId) {
    case "html":
      parser = "html";
      break;
    case "javascript":
    case "typescript":
    case "javascriptreact":
    case "typescriptreact":
      parser = "babel";
      break;
    default:
      return { fixedCode: code, hasError: false };
  }

  try {
    const config = (await prettier.resolveConfig(filePath)) || {};
    const fixedCode = await prettier.format(code, {
      ...config,
      filepath: filePath,
      parser: config.parser || parser,
      semi: true,
      trailingComma: "none",
      printWidth: 120
    });

    return { fixedCode, hasError: false };
  } catch (error) {
    console.warn("Live preview formatting failed:", error.message);
    return { fixedCode: code, hasError: true };
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
  `;
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
  `;
}

function getExecutionView(languageId, fixedCode, hasError) {
  const isPython = languageId === "python";
  const executableCode = isPython ? fixedCode : stripNodeWrappers(fixedCode);
  const executionScript = isPython
    ? `console.warn("[SETUP] Python execution is simulated."); console.log(${JSON.stringify(
        fixedCode
      )});`
    : executableCode;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${isPython ? "Python" : "JS/TS"} Preview</title>
        ${getCommonStyles()}
      </head>
      <body>
        <h3 class="console-title">Live ${isPython ? "Python" : "JS/TS"} Output</h3>
        ${hasError ? "<div class=\"error-bar\">Formatting failed. Running the original code.</div>" : ""}
        <div id="output-container">Console output will appear here.</div>
        ${getConsoleScript(executionScript)}
      </body>
    </html>
  `;
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
        ${hasError ? "<div class=\"error-bar\">Formatting failed. Running the original code.</div>" : ""}
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
  `;
}

function getCompiledLanguageView(languageId, fixedCode) {
  const isJava = languageId === "java";
  const classNameMatch = fixedCode.match(/public\s+class\s+(\w+)/);
  const className = classNameMatch ? classNameMatch[1] : "Main";
  const fileName = isJava ? `${className}.java` : "main.c";
  const compileCommand = isJava
    ? `javac ${fileName}`
    : `gcc ${fileName} -o myprogram`;
  const runCommand = isJava ? `java ${className}` : "./myprogram";

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
  `;
}

function getMarkdownView(code) {
  function renderMd(src) {
    return (
      src
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // Fenced code blocks first
        .replace(
          /```([\w-]*)\n([\s\S]*?)```/g,
          (_, lang, c) =>
            `<pre><code class="lang-${lang}">${c.trimEnd()}</code></pre>`
        )
        // Inline code
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        // Images before links
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "<img alt=\"$1\" src=\"$2\">")
        // Links
        .replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          "<a href=\"$2\" target=\"_blank\">$1</a>"
        )
        // Headings
        .replace(/^#{6} (.+)$/gm, "<h6>$1</h6>")
        .replace(/^#{5} (.+)$/gm, "<h5>$1</h5>")
        .replace(/^#{4} (.+)$/gm, "<h4>$1</h4>")
        .replace(/^#{3} (.+)$/gm, "<h3>$1</h3>")
        .replace(/^#{2} (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        // Bold/italic/strikethrough
        .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/~~(.+?)~~/g, "<del>$1</del>")
        // HR
        .replace(/^[-*]{3,}$/gm, "<hr>")
        // Blockquote
        .replace(/^&gt; ?(.+)$/gm, "<blockquote>$1</blockquote>")
        // Tables
        .replace(
          /^(\|.+\|)\n\|[-|: ]+\|\n((?:\|.+\|\n?)+)/gm,
          (_, hdr, body) => {
            const ths = hdr
              .split("|")
              .slice(1, -1)
              .map((c) => `<th>${c.trim()}</th>`)
              .join("");
            const trs = body
              .trim()
              .split("\n")
              .map(
                (r) =>
                  `<tr>${r
                    .split("|")
                    .slice(1, -1)
                    .map((c) => `<td>${c.trim()}</td>`)
                    .join("")}</tr>`
              )
              .join("");
            return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
          }
        )
        // Lists
        .replace(/^[ \t]*[-*+] (.+)$/gm, "<li>$1</li>")
        .replace(/^[ \t]*\d+\. (.+)$/gm, "<li>$1</li>")
        .replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>")
        // Paragraphs
        .replace(/^(?!<[a-zA-Z/]|\s*$)(.+)$/gm, "<p>$1</p>")
    );
  }
  return `<!DOCTYPE html><html><head><title>Markdown Preview</title><style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#24292e;background:#fff;padding:32px;max-width:860px;margin:0 auto;}
    h1,h2{border-bottom:1px solid #eaecef;padding-bottom:.3em;margin-top:24px;margin-bottom:16px;font-weight:600;}
    h3,h4,h5,h6{margin-top:24px;margin-bottom:16px;font-weight:600;}
    h1{font-size:2em;}h2{font-size:1.5em;}h3{font-size:1.25em;}
    a{color:#0366d6;text-decoration:none;}a:hover{text-decoration:underline;}
    img{max-width:100%;box-sizing:border-box;}
    code{background:#f6f8fa;border-radius:3px;font-size:85%;padding:.2em .4em;font-family:"SFMono-Regular",Consolas,monospace;}
    pre{background:#f6f8fa;border-radius:6px;font-size:85%;line-height:1.45;overflow:auto;padding:16px;margin:16px 0;}
    pre code{background:transparent;padding:0;font-size:100%;}
    blockquote{border-left:.25em solid #dfe2e5;color:#6a737d;margin:0 0 16px;padding:0 1em;}
    table{border-collapse:collapse;width:100%;margin:16px 0;}
    th,td{border:1px solid #dfe2e5;padding:6px 13px;}
    th{background:#f6f8fa;font-weight:600;}
    tr:nth-child(even){background:#f6f8fa;}
    ul,ol{padding-left:2em;margin:0 0 16px;}
    li{margin:.25em 0;}
    hr{border:0;border-top:1px solid #eaecef;margin:24px 0;}
    del{color:#6a737d;}strong{font-weight:600;}
    p{margin:0 0 16px;}
  </style></head><body>${renderMd(code)}</body></html>`;
}

function getCssView(languageId, code) {
  const label = languageId.toUpperCase();
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${label} Preview</title>
        <style>
          body { font-family: "Segoe UI", sans-serif; padding: 20px; background: #f4f4f4; }
          .preview-box { background: white; border-radius: 8px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 20px; }
          .preview-box h2 { margin: 0 0 16px; font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
          pre { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; white-space: pre-wrap; }
        </style>
        <style id="user-styles"></style>
      </head>
      <body>
        <div class="preview-box">
          <h2>${label} Applied to Sample Elements</h2>
          <h1>Heading 1</h1><h2>Heading 2</h2>
          <p>Paragraph text with <a href="#">a link</a> and <strong>bold</strong> and <em>italic</em>.</p>
          <button>Button</button>
          <input type="text" placeholder="Input field" />
          <ul><li>List item 1</li><li>List item 2</li><li>List item 3</li></ul>
          <div class="box">A div.box element</div>
          <div class="container"><div class="item">Container &gt; Item</div></div>
        </div>
        <div class="preview-box"><h2>Source</h2><pre>${code.replace(/</g, "&lt;")}</pre></div>
        <script>
          // Inject user CSS (plain CSS only — SCSS/LESS shown as source)
          try { document.getElementById("user-styles").textContent = ${JSON.stringify(code)}; } catch(e) {}
        </script>
      </body>
    </html>
  `;
}

function getJsonView(code) {
  let formatted = code;
  let parseError = null;
  try {
    formatted = JSON.stringify(JSON.parse(code), null, 2);
  } catch (e) {
    parseError = e.message;
  }
  const highlighted = formatted
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/("[^"]+"):/g, "<span class=\"key\">$1</span>:")
    .replace(/: ("[^"]*")/g, ": <span class=\"str\">$1</span>")
    .replace(/: (-?\d+\.?\d*)/g, ": <span class=\"num\">$1</span>")
    .replace(/: (true|false)/g, ": <span class=\"bool\">$1</span>")
    .replace(/: (null)/g, ": <span class=\"null\">$1</span>");
  return `<!DOCTYPE html><html><head><title>JSON Preview</title><style>
    body{font-family:monospace;padding:20px;background:#1e1e1e;color:#d4d4d4;margin:0;}
    .error{color:#ff7b72;background:#2a0a0a;padding:10px;border-radius:4px;margin-bottom:12px;}
    pre{white-space:pre-wrap;word-break:break-all;font-size:13px;line-height:1.6;}
    .key{color:#7dd3fc;}.str{color:#86efac;}.num{color:#fbbf24;}.bool{color:#f87171;}.null{color:#94a3b8;}
  </style></head><body>
  ${parseError ? `<div class="error">JSON Parse Error: ${parseError}</div>` : ""}
  <pre>${highlighted}</pre>
  </body></html>`;
}

function getSvgView(code) {
  return `<!DOCTYPE html><html><head><title>SVG Preview</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f4f4f4;}</style></head><body>${code}</body></html>`;
}

function getWebviewContent(languageId, fixedCode, hasError) {
  if (languageId === "html") return fixedCode;
  if (languageId === "javascriptreact" || languageId === "typescriptreact")
    return getReactView(fixedCode, hasError);
  if (
    languageId === "javascript" ||
    languageId === "typescript" ||
    languageId === "python"
  )
    return getExecutionView(languageId, fixedCode, hasError);
  if (languageId === "c" || languageId === "java")
    return getCompiledLanguageView(languageId, fixedCode);
  if (languageId === "markdown") return getMarkdownView(fixedCode);
  if (["css", "scss", "less", "sass"].includes(languageId))
    return getCssView(languageId, fixedCode);
  if (languageId === "json" || languageId === "jsonc")
    return getJsonView(fixedCode);
  if (languageId === "xml" || languageId === "svg") return getSvgView(fixedCode);
  if (["vue", "svelte", "astro"].includes(languageId)) {
    const templateMatch = fixedCode.match(
      /<template[^>]*>([\s\S]*?)<\/template>/i
    );
    const styleMatch = fixedCode.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const html = templateMatch ? templateMatch[1] : fixedCode;
    const style = styleMatch ? `<style>${styleMatch[1]}</style>` : "";
    return `<!DOCTYPE html><html><head><title>${languageId} Preview</title>${style}</head><body>${html}</body></html>`;
  }
  return `<!DOCTYPE html><html><head><title>Preview</title><style>body{margin:0;background:#1e1e1e;}pre{padding:20px;color:#d4d4d4;font-family:monospace;font-size:13px;white-space:pre-wrap;word-break:break-all;}</style></head><body><pre>${escapeHTML(fixedCode)}</pre></body></html>`;
}

function getLocalResourceRoots(documentPath) {
  const roots = [vscode.Uri.file(path.dirname(documentPath))];
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (workspaceRoot) {
    roots.push(vscode.Uri.file(workspaceRoot));
  }

  return roots;
}

async function livePreviewer(context, options = {}) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return vscode.window.showInformationMessage(
      "Open a supported file to start the live preview."
    );
  }

  const document = editor.document;
  const languageId = document.languageId;
  const supportedLanguages = [
    "html",
    "javascript",
    "typescript",
    "javascriptreact",
    "typescriptreact",
    "python",
    "c",
    "java",
    "markdown",
    "css",
    "scss",
    "less",
    "sass",
    "json",
    "jsonc",
    "xml",
    "svg",
    "vue",
    "svelte",
    "astro"
  ];

  if (!supportedLanguages.includes(languageId)) {
    return vscode.window.showWarningMessage(
      `Live Preview supports HTML, JS/TS, React/JSX, Python, C, and Java. Detected: ${languageId}`
    );
  }

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
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
    );

    currentPanel.onDidDispose(
      () => {
        currentPanel = undefined;
        currentPreviewState = undefined;
        if (currentChangeListener) {
          currentChangeListener.dispose();
          currentChangeListener = undefined;
        }
        if (currentMessageListener) {
          currentMessageListener.dispose();
          currentMessageListener = undefined;
        }
      },
      null,
      context.subscriptions
    );
  }

  const panel = currentPanel;
  panel.title = `Live Preview: ${path.basename(document.fileName)}`;
  const inspectMode = options.inspect === true;
  const inspectTimeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(500, options.timeoutMs)
    : 2500;
  const sessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  currentPreviewState = createPreviewDiagnostics(
    document.fileName,
    languageId,
    sessionId
  );

  let resolveInspect;
  let inspectResolved = false;
  let inspectTimeout;
  let inspectReadyDelay;
  const finishInspect = () => {
    if (!inspectMode || inspectResolved) return;
    inspectResolved = true;
    clearTimeout(inspectTimeout);
    clearTimeout(inspectReadyDelay);
    resolveInspect({
      success: true,
      diagnostics: clonePreviewDiagnostics(currentPreviewState)
    });
  };
  const inspectPromise = inspectMode
    ? new Promise((resolve) => {
        resolveInspect = resolve;
        inspectTimeout = setTimeout(() => finishInspect(), inspectTimeoutMs);
      })
    : Promise.resolve({
        success: true,
        diagnostics: clonePreviewDiagnostics(currentPreviewState)
      });

  const updateWebview = async () => {
    const rawCode = document.getText();
    const { fixedCode, hasError } = await formatCode(
      rawCode,
      languageId,
      document.fileName
    );

    const processedCode =
      languageId === "html"
        ? convertLocalPathsToWebviewUris(
            fixedCode,
            panel.webview,
            document.fileName
          )
        : fixedCode;

    panel.webview.html = withPreviewInstrumentation(
      getWebviewContent(languageId, processedCode, hasError),
      sessionId
    );
  };

  if (currentChangeListener) {
    currentChangeListener.dispose();
    currentChangeListener = undefined;
  }

  if (currentMessageListener) {
    currentMessageListener.dispose();
    currentMessageListener = undefined;
  }

  currentMessageListener = panel.webview.onDidReceiveMessage((message) => {
    if (!currentPreviewState || message?.sessionId !== currentPreviewState.sessionId) {
      return;
    }

    if (message.type === "previewReady") {
      currentPreviewState.ready = true;
      currentPreviewState.title = message.title || "";
      currentPreviewState.bodyTextExcerpt = message.bodyTextExcerpt || "";
      currentPreviewState.readyAt = new Date().toISOString();
      if (inspectMode) {
        clearTimeout(inspectReadyDelay);
        inspectReadyDelay = setTimeout(() => finishInspect(), 400);
      }
      return;
    }

    if (message.type === "previewLog") {
      const entry = {
        level: message.level || "log",
        message: message.message || ""
      };
      pushPreviewEntry(currentPreviewState.logs, entry);
      if (entry.level === "warn") {
        pushPreviewEntry(currentPreviewState.warnings, entry);
      }
      if (entry.level === "error") {
        pushPreviewEntry(currentPreviewState.errors, entry);
      }
      return;
    }

    if (message.type === "previewError") {
      pushPreviewEntry(currentPreviewState.errors, {
        message: message.message || "Unknown preview error",
        stack: message.stack || "",
        source: message.source || "",
        line: message.line || null,
        column: message.column || null
      });
      return;
    }

    if (message.type === "previewResourceError") {
      pushPreviewEntry(currentPreviewState.resourceFailures, {
        tagName: message.tagName || "",
        url: message.url || "",
        message: message.message || "Failed to load resource"
      });
    }
  });

  await updateWebview();

  currentChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document === document) {
      updateWebview();
    }
  });

  if (!inspectMode) {
    return {
      success: true,
      diagnostics: clonePreviewDiagnostics(currentPreviewState)
    };
  }

  return inspectPromise;
}

livePreviewer.getLastDiagnostics = function () {
  return clonePreviewDiagnostics(currentPreviewState);
};

module.exports = livePreviewer;
