const vscode = require("vscode");
const path = require("path");

let prettier;
try {
  prettier = require(path.join(__dirname, '..', '..', 'node_modules', 'prettier'));
} catch (error) {
  try {
    prettier = require('prettier');
  } catch (e) {
    prettier = null;
    console.warn('Prettier not available for live preview');
  }
}

let currentPanel = undefined;

function convertLocalPathsToWebviewUris(html, webview, documentPath) {
  const documentDir = path.dirname(documentPath);
  const fs = require('fs');
  
  html = html.replace(/(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, src, suffix) => {
    if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('vscode-webview-resource:')) {
      return match;
    }
    
    try {
      let fullPath;
      
      // Handle different path formats
      if (path.isAbsolute(src)) {
        fullPath = src;
      } else {
        // Try relative to document first
        fullPath = path.resolve(documentDir, src);
        
        // If not found, try relative to workspace
        if (!fs.existsSync(fullPath)) {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (workspaceRoot) {
            fullPath = path.resolve(workspaceRoot, src);
          }
        }
      }
      
      console.log(`Checking image: ${src}`);
      console.log(`Full path: ${fullPath}`);
      console.log(`Exists: ${fs.existsSync(fullPath)}`);
      
      if (fs.existsSync(fullPath)) {
        const webviewUri = webview.asWebviewUri(vscode.Uri.file(fullPath));
        console.log(`Converting: ${src} -> ${webviewUri.toString()}`);
        return prefix + webviewUri.toString() + suffix;
      } else {
        console.warn(`Image not found: ${fullPath}`);
      }
    } catch (error) {
      console.warn('Failed to convert image path:', src, error.message);
    }
    return match;
  });
  
  return html;
}

const escapeHTML = (str) => {
  return str.replace(/"/g, "&quot;");
};

async function fixCode(code, languageId) {
  let fixedCode = code;
  let hasError = false;
  let parserName;

  switch (languageId) {
    case "html":
      parserName = "html";
      break;
    case "javascript":
    case "typescript":
    case "javascriptreact":
    case "typescriptreact":
      parserName = "babel";
      break;
    case "python":
      parserName = "python";
      break;
    case "c":
    case "java":
      return { fixedCode: code, hasError: false, parser: null };
    default:
      return { fixedCode: code, hasError: false, parser: null };
  }

  try {
    if (prettier) {
      fixedCode = await prettier.format(code, {
        parser: parserName,
        tabWidth: 2,
        printWidth: 120,
        semi: true,
        singleQuote: false,
        trailingComma: "none"
      });
    }
  } catch (error) {
    hasError = true;
    fixedCode = code;
  }
  return { fixedCode, hasError, parser: parserName };
}

function stripNodeWrappers(code) {
  let strippedCode = code.replace(
    /^(const|var|let)\s+[^=]+\s*=\s*require\s*\([^)]+\);\s*$/gm,
    ""
  );

  strippedCode = strippedCode.replace(
    /^module\.exports\s*=\s*[\s\S]*;?$/gm,
    ""
  );

  strippedCode = strippedCode.replace(/^\s*(['"])use strict\1;?\s*$/gm, "");

  return strippedCode;
}

const CONSOLE_REDIRECT_SCRIPT = `
  <script>
    const originalConsole = window.console;
    
    function logToParent(type, args) {
      try {
        const serializableArgs = args.map(arg => {
          if (typeof arg === 'object' && arg !== null) {
            return JSON.stringify(arg, (key, value) => {
              if (value instanceof HTMLElement) return '<HTMLElement>';
              if (typeof value === 'function') return '<Function>';
              return value;
            }, 2);
          }
          return String(arg);
        });
        window.parent.postMessage({
          command: 'consoleLog',
          type: type,
          message: serializableArgs.join(' ')
        }, '*');
      } catch (e) {
        window.parent.postMessage({
          command: 'consoleLog',
          type: 'error',
          message: 'Error serializing console, argument: ' + (e.stack || e.message)
        }, '*');
      }
    }

    window.console = {
      ...originalConsole,
      log: (...args) => { originalConsole.log(...args); logToParent('log', args); },
      error: (...args) => { originalConsole.error(...args); logToParent('error', args); },
      warn: (...args) => { originalConsole.warn(...args); logToParent('warn', args); }
    };

    window.onerror = (message, source, lineno, colno, error) => {
      const errorText = error ? (error.stack || error.message) : message;
      logToParent('error', ['UNCAUGHT ERROR:', errorText, \`(Line: \${lineno}, Col: \${colno})\`]);
      return true;
    };

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason ? (event.reason.stack || event.reason.message || String(event.reason)) : 'Unknown reason';
      logToParent('error', ['UNHANDLED PROMISE REJECTION:', reason]);
    });
  </script>
`;

function getWebviewContent(languageId, fixedCode, hasError) {
  const commonStyles = `
    <style>
      body { 
          font-family: 'Inter', sans-serif; 
          padding: 10px; 
          height: 100vh;
          display: flex;
          flex-direction: column;
          margin: 0;
          background-color: #f4f4f4;
      }
      #output-container {
          flex-shrink: 0;
          min-height: 120px;
          max-height: 250px;
          overflow-y: auto;
          background-color: #1e1e1e;
          color: #d4d4d4;
          padding: 15px;
          border-radius: 6px;
          white-space: pre-wrap;
          font-family: monospace;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) inset;
          margin-top: 10px;
      }
      .log { color: #a7f3d0; }
      .warn { color: #ffd700; }
      .error { color: #ff4500; font-weight: bold; }
      .info { color: #818cf8; }
      .console-title { margin-top: 0; margin-bottom: 5px; color: #333; font-weight: bold; font-size: 1.1em;}
      .error-bar { background-color: #fcebeb; color: #cc0000; padding: 10px; border-bottom: 2px solid #cc0000; font-family: sans-serif; font-size: 14px; position: sticky; top: 0; z-index: 10; border-radius: 4px; margin-bottom: 10px;}
      .code-display { background-color: #272822; color: #f8f8f2; padding: 15px; border-radius: 6px; white-space: pre; overflow-x: auto; margin-bottom: 15px; }
      .command-block { background-color: #3b82f6; color: white; padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 1.1em; cursor: copy; margin: 5px 0; }
      #react-container { flex-grow: 1; padding: 20px; border: 1px solid #ddd; border-radius: 6px; background: white; }
    </style>
  `;

  if (languageId === "html") {
    // Direct HTML rendering
    return fixedCode;
  } else if (
    languageId === "javascript" ||
    languageId === "typescript" ||
    languageId === "javascriptreact" ||
    languageId === "typescriptreact" ||
    languageId === "python"
  ) {
    const isPython = languageId === "python";
    const isReact = languageId === "javascriptreact" || languageId === "typescriptreact";
    
    let executableCode = fixedCode;
    if (!isPython && !isReact) {
      executableCode = stripNodeWrappers(fixedCode);
    }

    if (isReact) {
      // React/JSX rendering
      return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>React/JSX Live Preview</title>
            ${commonStyles}
            <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
            <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
            <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
        </head>
        <body>
            <h3 class="console-title">Live React/JSX Preview</h3>
            ${hasError ? `<div class="error-bar">⚠️ **Code Formatting Failed:** Running raw code which may cause unexpected behavior.</div>` : ""}
            <div id="react-container"></div>
            <div id="console-host">
              <h3 class="console-title">Console Output</h3>
              <div id="output-container">--- Console Output Will Appear Here ---</div>
            </div>
            
            <script type="text/babel">
                const { useState, useEffect } = React;
                
                function appendOutput(type, message) {
                    const outputContainer = document.getElementById('output-container');
                    const messageElement = document.createElement('div');
                    messageElement.className = type;
                    messageElement.textContent = message;
                    outputContainer.appendChild(messageElement);
                    outputContainer.scrollTop = outputContainer.scrollHeight;
                }

                // Override console for React components
                const originalConsole = {
                    log: console.log,
                    error: console.error,
                    warn: console.warn
                };

                console.log = function(...args) {
                    originalConsole.log(...args);
                    appendOutput('log', '[LOG] ' + args.map(a => typeof a === 'object' && a !== null ? JSON.stringify(a, null, 2) : String(a)).join(' '));
                };
                console.error = function(...args) {
                    originalConsole.error(...args);
                    appendOutput('error', '[ERROR] ' + args.map(a => String(a)).join(' '));
                };
                console.warn = function(...args) {
                    originalConsole.warn(...args);
                    appendOutput('warn', '[WARN] ' + args.map(a => String(a)).join(' '));
                };

                try {
                    // User's JSX code
                    ${executableCode}
                    
                    // Try to render the main component
                    const container = document.getElementById('react-container');
                    const root = ReactDOM.createRoot(container);
                    
                    // Look for common component names
                    if (typeof App !== 'undefined') {
                        root.render(<App />);
                    } else if (typeof Component !== 'undefined') {
                        root.render(<Component />);
                    } else {
                        appendOutput('warn', 'No App or Component found. Define a component named App or Component.');
                    }
                } catch (e) {
                    appendOutput('error', '--- REACT ERROR ---');
                    appendOutput('error', e.stack || e.message || String(e));
                }
            </script>
        </body>
        </html>
      `;
    }

    const executionScript = isPython
      ? `
            appendOutput('warn', '[SETUP] Python execution is simulated. Output below is conceptual.');
            
            try {
                appendOutput('log', "[PYTHON CODE START]");
                appendOutput('log', "Simulated: " + "${escapeHTML(fixedCode).replace(/\n/g, "\\n").replace(/"/g, '\\"')}");
                appendOutput('log', '[INFO] Simulation complete. No actual Python output shown.');
            } catch (e) {
                appendOutput('error', '--- SIMULATION ERROR ---');
                appendOutput('error', e.stack || e.message || String(e));
            }
        `
      : `
            try {
                ${executableCode}
            } catch (e) {
                appendOutput('error', '--- RUNTIME ERROR ---');
                appendOutput('error', 'Error in execution:');
                appendOutput('error', e.stack || e.message || String(e));
            }
        `;

    return `
      <!DOCTYPE html>
      <html>
      <head>
          <title>${isPython ? "Python" : "JS/TS"} Output Console</title>
          ${commonStyles}
          <style>
             #output-container { flex-grow: 1; max-height: none; }
          </style>
      </head>
      <body>
          <h3 class="console-title">Live ${isPython ? "Python" : "JS/TS"} Execution Output</h3>
          ${hasError ? `<div class="error-bar">⚠️ **Code Formatting Failed:** Running raw code which may cause unexpected behavior.</div>` : ""}
          <div id="output-container">--- Console Output Will Appear Here ---</div>

          <script>
              (function() {
                  const outputContainer = document.getElementById('output-container');
                  outputContainer.innerHTML = '';

                  function appendOutput(type, message) {
                      const messageElement = document.createElement('div');
                      messageElement.className = type;
                      messageElement.textContent = message;
                      outputContainer.appendChild(messageElement);
                      outputContainer.scrollTop = outputContainer.scrollHeight;
                  }

                  function safeStringify(item) {
                      try {
                          return JSON.stringify(item, (key, value) => {
                              if (value instanceof HTMLElement) return '<HTMLElement>';
                              if (typeof value === 'function') return '<Function>';
                              return value;
                          }, 2);
                      } catch (e) {
                          return String(item);
                      }
                  }

                  const originalConsole = {
                      log: console.log,
                      error: console.error,
                      warn: console.warn
                  };

                  console.log = function(...args) {
                      originalConsole.log(...args);
                      appendOutput('log', '[LOG] ' + args.map(a => typeof a === 'object' && a !== null ? safeStringify(a) : String(a)).join(' '));
                  };
                  console.error = function(...args) {
                      originalConsole.error(...args);
                      appendOutput('error', '[ERROR] ' + args.map(a => String(a)).join(' '));
                  };
                  console.warn = function(...args) {
                      originalConsole.warn(...args);
                      appendOutput('warn', '[WARN] ' + args.map(a => String(a)).join(' '));
                  };
                  
                  ${executionScript}
              })();
          </script>
      </body>
      </html>
    `;
  } else if (
    languageId === "javascript" ||
    languageId === "typescript" ||
    languageId === "javascriptreact" ||
    languageId === "typescriptreact" ||
    languageId === "python"
  ) {
    const isPython = languageId === "python";
    let executableCode = fixedCode;
    if (!isPython) {
      executableCode = stripNodeWrappers(fixedCode);
    }

    const executionScript = isPython
      ? `
            appendOutput('warn', '[SETUP] Python execution is simulated. Output below is conceptual.');
            
            try {
                appendOutput('log', "[PYTHON CODE START]");
                appendOutput('log', "Simulated: " + "${escapeHTML(fixedCode).replace(/\n/g, "\\n").replace(/"/g, '\\"')}");
                appendOutput('log', '[INFO] Simulation complete. No actual Python output shown.');
            } catch (e) {
                appendOutput('error', '--- SIMULATION ERROR ---');
                appendOutput('error', e.stack || e.message || String(e));
            }
        `
      : `
            try {
                ${executableCode}
            } catch (e) {
                appendOutput('error', '--- RUNTIME ERROR ---');
                appendOutput('error', 'Error in execution:');
                appendOutput('error', e.stack || e.message || String(e));
            }
        `;

    return `
      <!DOCTYPE html>
      <html>
      <head>
          <title>${isPython ? "Python" : "JS/TS"} Output Console</title>
          ${commonStyles}
          <style>
             #output-container { flex-grow: 1; max-height: none; }
          </style>
      </head>
      <body>
          <h3 class="console-title">Live ${isPython ? "Python" : "JS/TS"} Execution Output</h3>
          ${hasError ? `<div class="error-bar">⚠️ **Code Formatting Failed:** Running raw code which may cause unexpected behavior.</div>` : ""}
          <div id="output-container">--- Console Output Will Appear Here ---</div>

          <script>
              (function() {
                  const outputContainer = document.getElementById('output-container');
                  outputContainer.innerHTML = '';

                  function appendOutput(type, message) {
                      const messageElement = document.createElement('div');
                      messageElement.className = type;
                      messageElement.textContent = message;
                      outputContainer.appendChild(messageElement);
                      outputContainer.scrollTop = outputContainer.scrollHeight;
                  }

                  function safeStringify(item) {
                      try {
                          return JSON.stringify(item, (key, value) => {
                              if (value instanceof HTMLElement) return '<HTMLElement>';
                              if (typeof value === 'function') return '<Function>';
                              return value;
                          }, 2);
                      } catch (e) {
                          return String(item);
                      }
                  }

                  const originalConsole = {
                      log: console.log,
                      error: console.error,
                      warn: console.warn
                  };

                  console.log = function(...args) {
                      originalConsole.log(...args);
                      appendOutput('log', '[LOG] ' + args.map(a => typeof a === 'object' && a !== null ? safeStringify(a) : String(a)).join(' '));
                  };
                  console.error = function(...args) {
                      originalConsole.error(...args);
                      appendOutput('error', '[ERROR] ' + args.map(a => String(a)).join(' '));
                  };
                  console.warn = function(...args) {
                      originalConsole.warn(...args);
                      appendOutput('warn', '[WARN] ' + args.map(a => String(a)).join(' '));
                  };
                  
                  ${executionScript}
              })();
          </script>
      </body>
      </html>
    `;
  } else if (languageId === "c" || languageId === "java") {
    const isJava = languageId === "java";
    let filename = isJava ? "Main.java" : "main.c";
    let instructions = [];

    if (isJava) {
      const classNameMatch = fixedCode.match(/public\s+class\s+(\w+)/);
      const className = classNameMatch ? classNameMatch[1] : "Main";
      filename = `${className}.java`;

      instructions = [
        `1. Save your code locally as: **${filename}**`,
        `2. Open your terminal/command prompt.`,
        `3. Compile the code (using JDK):`,
        `<div class="command-block" onclick="copyCommand(this)">javac ${filename}</div>`,
        `4. Run the compiled class file:`,
        `<div class="command-block" onclick="copyCommand(this)">java ${className}</div>`,
        `***Note:*** The code is displayed below. Ensure it contains a main method and that your JDK is installed.`
      ];
    } else {
      instructions = [
        `1. Save your code locally as: **${filename}**`,
        `2. Open your terminal/command prompt.`,
        `3. Compile the code (using GCC):`,
        `<div class="command-block" onclick="copyCommand(this)">gcc ${filename} -o myprogram</div>`,
        `4. Run the executable:`,
        `<div class="command-block" onclick="copyCommand(this)">./myprogram</div>`,
        `***Note:*** The code is displayed below. Ensure your GCC compiler is installed.`
      ];
    }

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${isJava ? "Java" : "C"} Execution Instructions</title>
            ${commonStyles}
            <style>
                .instructions-card {
                    background-color: #fff;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                    flex-grow: 1;
                    overflow-y: auto;
                }
            </style>
        </head>
        <body>
            <div class="instructions-card">
                <h3 class="console-title text-2xl text-indigo-600">Local Execution Steps for ${isJava ? "Java" : "C"}</h3>
                <p class="text-gray-600 mb-4">This code requires compilation. Please follow the steps below to run it on your local system:</p>

                <ol class="list-decimal ml-4 text-gray-700 space-y-3">
                    ${instructions.map((item) => `<li>${item}</li>`).join("")}
                </ol>

                <h4 class="text-lg font-semibold mt-6 mb-2 text-gray-800">Your Current Code:</h4>
                <pre class="code-display">${escapeHTML(fixedCode)}</pre>
            </div>

            <script>
                function copyCommand(element) {
                    const command = element.textContent;
                    try {
                        const textArea = document.createElement("textarea");
                        textArea.value = command;
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textArea);
                        alert("Command copied to clipboard: " + command);
                    } catch (err) {
                        alert("Failed to copy command. Please select and copy manually.");
                    }
                }
            </script>
        </body>
        </html>
    `;
  }
}

function livePreviewer(context) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return vscode.window.showInformationMessage(
      "Open a file to start the live preview."
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
    "java"
  ];

  if (!supportedLanguages.includes(languageId)) {
    return vscode.window.showWarningMessage(
      `Live Preview currently supports HTML (rendering/debugging), JS/TS (execution), Python (simulated execution), and C/Java (local instructions). (Detected: ${languageId})`
    );
  }

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      "livePreview",
      "Live Preview: " + document.fileName.split(/[\\/]/).pop(),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.dirname(document.fileName)),
          vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''),
          vscode.Uri.file('C:\\'),
          vscode.Uri.file('D:\\'),
          vscode.Uri.file('E:\\'),
          vscode.Uri.file('F:\\')
        ]
      }
    );

    currentPanel.onDidDispose(
      () => {
        currentPanel = undefined;
      },
      null,
      context.subscriptions
    );
  }
  const panel = currentPanel;

  const updateWebview = async () => {
    const rawCode = document.getText();

    const { fixedCode, hasError } = await fixCode(rawCode, languageId);
    
    let processedCode = fixedCode;
    if (languageId === 'html') {
      console.log('Processing HTML for image paths...');
      console.log('Document path:', document.fileName);
      processedCode = convertLocalPathsToWebviewUris(fixedCode, panel.webview, document.fileName);
    }

    const webviewContent = getWebviewContent(languageId, processedCode, hasError);

    panel.webview.html = webviewContent;
  };

  updateWebview();

  const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === document) {
      updateWebview();
    }
  });

  panel.onDidDispose(
    () => {
      changeListener.dispose();
    },
    null,
    context.subscriptions
  );
}

module.exports = livePreviewer;