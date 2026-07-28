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
let currentSaveListener;
let currentMessageListener;
let currentPreviewState;
let currentDevServerTerminal;
let currentDevServerKey = "";

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

function isExternalOrSpecialResource(resource) {
  return /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(resource || "");
}

function stripResourceSuffix(resource) {
  return String(resource || "").split(/[?#]/, 1)[0];
}

function appendResourceSuffix(uri, resource) {
  const suffixMatch = String(resource || "").match(/([?#].*)$/);
  if (!suffixMatch) return uri;
  const suffix = suffixMatch[1];
  if (suffix.startsWith("?") && uri.includes("?")) {
    return `${uri}&${suffix.slice(1)}`;
  }
  return `${uri}${suffix}`;
}

function resolveLocalPath(src, documentPath) {
  if (!src || isExternalOrSpecialResource(src)) {
    return null;
  }

  const cleanSrc = stripResourceSuffix(src);
  if (!cleanSrc) return null;

  const documentDir = path.dirname(documentPath);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const candidates = cleanSrc.startsWith("/") && workspaceRoot
    ? [path.resolve(workspaceRoot, cleanSrc.replace(/^\/+/, ""))]
    : path.isAbsolute(cleanSrc)
      ? [cleanSrc]
    : [
        path.resolve(documentDir, cleanSrc),
        workspaceRoot ? path.resolve(workspaceRoot, cleanSrc) : null
      ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getWebviewResourceUri(webview, resource, documentPath) {
  const fullPath = resolveLocalPath(resource, documentPath);
  if (!fullPath) {
    return "";
  }

  const cacheBuster = (() => {
    try {
      return fs.statSync(fullPath).mtimeMs.toString(36);
    } catch {
      return Date.now().toString(36);
    }
  })();
  const uri = `${webview.asWebviewUri(vscode.Uri.file(fullPath)).toString()}?v=${cacheBuster}`;
  return appendResourceSuffix(uri, resource);
}

function rewriteHtmlResourceAttributes(html, webview, documentPath) {
  const resourceAttributePattern =
    /(<(?:img|script|source|video|audio|track|iframe|embed|object)\b[^>]*?\s(?:src|poster|data)=["'])([^"']+)(["'][^>]*>)/gi;
  const linkHrefPattern =
    /(<link\b(?=[^>]*?\b(?:rel=["'][^"']*(?:stylesheet|icon|preload|modulepreload|manifest)[^"']*["']|as=["'](?:style|script|image|font|fetch)["']))[^>]*?\shref=["'])([^"']+)(["'][^>]*>)/gi;

  return html
    .replace(resourceAttributePattern, (match, prefix, resource, suffix) => {
      const uri = getWebviewResourceUri(webview, resource, documentPath);
      return uri ? `${prefix}${uri}${suffix}` : match;
    })
    .replace(linkHrefPattern, (match, prefix, resource, suffix) => {
      const uri = getWebviewResourceUri(webview, resource, documentPath);
      return uri ? `${prefix}${uri}${suffix}` : match;
    });
}

function rewriteSrcset(html, webview, documentPath) {
  return html.replace(
    /(\s(?:srcset|imagesrcset)=["'])([^"']+)(["'])/gi,
    (match, prefix, srcset, suffix) => {
      const rewritten = String(srcset)
        .split(",")
        .map((candidate) => {
          const parts = candidate.trim().split(/\s+/);
          if (!parts[0]) return "";
          const uri = getWebviewResourceUri(webview, parts[0], documentPath);
          return [uri || parts[0], ...parts.slice(1)].join(" ");
        })
        .filter(Boolean)
        .join(", ");
      return rewritten ? `${prefix}${rewritten}${suffix}` : match;
    }
  );
}

function convertLocalPathsToWebviewUris(html, webview, documentPath) {
  return rewriteSrcset(
    rewriteHtmlResourceAttributes(html, webview, documentPath),
    webview,
    documentPath
  );
}

function isPathInside(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function isRelatedPreviewDocument(filePath, previewDocumentPath) {
  if (!filePath || !previewDocumentPath) return false;
  const normalizedFile = path.resolve(filePath);
  const normalizedPreview = path.resolve(previewDocumentPath);
  if (normalizedFile === normalizedPreview) return true;

  const previewDir = path.dirname(normalizedPreview);
  if (isPathInside(previewDir, normalizedFile)) return true;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return workspaceRoot
    ? isPathInside(path.resolve(workspaceRoot), normalizedFile)
    : false;
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

function findNearestPackageJson(startPath) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ? path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath)
    : "";
  let currentDir = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? path.resolve(startPath)
    : path.dirname(path.resolve(startPath));

  while (currentDir && currentDir !== path.dirname(currentDir)) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    if (workspaceRoot && currentDir === workspaceRoot) {
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  return "";
}

function readPackageJson(packageJsonPath) {
  if (!packageJsonPath) return null;
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return null;
  }
}

function hasStaticHtmlEntry(projectDir) {
  return ["index.html", "public/index.html", "dist/index.html"].some((entry) =>
    fs.existsSync(path.join(projectDir, entry))
  );
}

function hasWebAppSignals(packageJson = {}, projectDir = "") {
  const combinedDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  };
  const depNames = Object.keys(combinedDeps);
  const hasKnownWebDependency = depNames.some((dep) =>
    /^(vite|next|react|react-dom|@vitejs\/|vue|svelte|astro|parcel|webpack|@angular\/core|@remix-run\/)/i.test(dep)
  );
  const hasKnownConfig = [
    "vite.config.js",
    "vite.config.ts",
    "next.config.js",
    "next.config.mjs",
    "astro.config.mjs",
    "svelte.config.js"
  ].some((configFile) =>
    fs.existsSync(path.join(projectDir, configFile))
  );

  return hasKnownWebDependency || hasKnownConfig;
}

function pickPreviewScript(packageJson = {}) {
  const scripts = packageJson.scripts || {};
  for (const name of ["dev", "start", "serve", "preview"]) {
    if (typeof scripts[name] === "string" && scripts[name].trim()) {
      return { name, command: scripts[name].trim() };
    }
  }
  return null;
}

function detectPreviewPort(scriptCommand = "", packageJson = {}) {
  const explicitPort =
    scriptCommand.match(/(?:--port|-p)\s+([0-9]{2,5})/) ||
    scriptCommand.match(/PORT=([0-9]{2,5})/i) ||
    scriptCommand.match(/\blocalhost:([0-9]{2,5})\b/i);
  if (explicitPort) return Number(explicitPort[1]);

  const command = String(scriptCommand || "").toLowerCase();
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  };
  if (command.includes("vite") || deps.vite) return 5173;
  if (command.includes("astro") || deps.astro) return 4321;
  if (command.includes("parcel") || deps.parcel) return 1234;
  if (command.includes("next") || deps.next) return 3000;
  if (command.includes("react-scripts") || deps["react-scripts"]) return 3000;
  if (command.includes("webpack") || deps.webpack) return 8080;
  return 3000;
}

function detectPackageManager(projectDir) {
  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

function getRunScriptCommand(projectDir, scriptName) {
  const manager = detectPackageManager(projectDir);
  if (manager === "yarn") return `yarn ${scriptName}`;
  if (manager === "pnpm") return `pnpm ${scriptName}`;
  return `npm run ${scriptName}`;
}

function isPackagePreviewCandidate(document, packageJson, projectDir) {
  if (!document || !packageJson) {
    return false;
  }

  const fileName = path.basename(document.fileName || "").toLowerCase();
  const ext = path.extname(fileName).toLowerCase();
  const hasStaticEntry = hasStaticHtmlEntry(projectDir);
  const isFrameworkApp = hasWebAppSignals(packageJson, projectDir);

  if (fileName === "package.json") return !hasStaticEntry || isFrameworkApp;
  if (ext === ".html") return isFrameworkApp;
  if ([".jsx", ".tsx", ".vue", ".svelte", ".astro"].includes(ext)) return true;
  if (
    [".js", ".ts", ".css", ".scss", ".sass", ".less"].includes(ext) &&
    isFrameworkApp
  ) {
    return true;
  }

  return false;
}

function getDevServerPreviewHtml({ url, projectDir, scriptName, command }) {
  const safeUrl = escapeHTML(url);
  const safeProject = escapeHTML(projectDir);
  const safeScript = escapeHTML(scriptName);
  const safeCommand = escapeHTML(command);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:* http://127.0.0.1:*; style-src 'unsafe-inline';">
    <style>
      body { margin: 0; background: #0d1117; color: #c9d1d9; font-family: "Segoe UI", sans-serif; }
      .bar { height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 12px; background: #161b22; border-bottom: 1px solid #30363d; font-size: 12px; }
      .bar strong { color: #f0f6fc; }
      .bar code { color: #79c0ff; }
      iframe { width: 100vw; height: calc(100vh - 38px); border: 0; background: white; }
    </style>
  </head>
  <body>
    <div class="bar">
      <strong>Dev server preview</strong>
      <span>${safeProject}</span>
      <code>${safeCommand}</code>
      <span>script: ${safeScript}</span>
    </div>
    <iframe src="${safeUrl}" title="Code Janitor dev server preview"></iframe>
  </body>
</html>`;
}

function startDevServerPreview(context, { document, packageJsonPath, packageJson }) {
  const projectDir = path.dirname(packageJsonPath);
  const script = pickPreviewScript(packageJson);
  if (!script) {
    vscode.window.showWarningMessage(
      "No dev/start/serve/preview script found in package.json. Add one to preview this app."
    );
    return null;
  }

  const port = detectPreviewPort(script.command, packageJson);
  const url = `http://localhost:${port}`;
  const command = getRunScriptCommand(projectDir, script.name);
  const serverKey = `${projectDir}:${script.name}:${port}`;

  if (!currentDevServerTerminal || currentDevServerKey !== serverKey) {
    currentDevServerTerminal = vscode.window.createTerminal({
      name: `Code Janitor Preview: ${path.basename(projectDir)}`,
      cwd: projectDir
    });
    currentDevServerTerminal.sendText(command);
    currentDevServerKey = serverKey;
  }
  currentDevServerTerminal.show(false);

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      "livePreview",
      `Live Preview: ${path.basename(projectDir)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(projectDir)]
      }
    );
    currentPanel.onDidDispose(
      () => {
        currentPanel = undefined;
        currentPreviewState = undefined;
      },
      null,
      context.subscriptions
    );
  }

  currentPanel.title = `Live Preview: ${path.basename(projectDir)}`;
  currentPanel.webview.html = getDevServerPreviewHtml({
    url,
    projectDir,
    scriptName: script.name,
    command
  });
  vscode.window.showInformationMessage(
    `Starting ${script.name} for preview. If the panel is blank, wait for the dev server to finish booting and refresh the preview.`
  );

  return {
    success: true,
    devServer: true,
    url,
    projectDir,
    script: script.name,
    documentPath: document.fileName
  };
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
  const packageJsonPath = findNearestPackageJson(document.fileName);
  const packageJson = readPackageJson(packageJsonPath);
  if (
    packageJsonPath &&
    pickPreviewScript(packageJson) &&
    isPackagePreviewCandidate(document, packageJson, path.dirname(packageJsonPath))
  ) {
    return startDevServerPreview(context, {
      document,
      packageJsonPath,
      packageJson
    });
  }

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
        if (currentSaveListener) {
          currentSaveListener.dispose();
          currentSaveListener = undefined;
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

  if (currentSaveListener) {
    currentSaveListener.dispose();
    currentSaveListener = undefined;
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

  if (typeof vscode.workspace.onDidSaveTextDocument === "function") {
    currentSaveListener = vscode.workspace.onDidSaveTextDocument((savedDocument) => {
      if (
        savedDocument?.uri?.scheme === "file" &&
        isRelatedPreviewDocument(savedDocument.fileName, document.fileName)
      ) {
        updateWebview();
      }
    });
  }

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

livePreviewer._test = {
  convertLocalPathsToWebviewUris,
  detectPreviewPort,
  getRunScriptCommand,
  isPackagePreviewCandidate,
  isRelatedPreviewDocument,
  pickPreviewScript,
  resolveLocalPath
};

module.exports = livePreviewer;
