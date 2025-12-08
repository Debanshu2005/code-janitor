const vscode = require("vscode");
const prettier = require("prettier");

// Global panel reference to manage the preview instance
let currentPanel = undefined;

// Helper function to escape special characters for data URI inclusion;
const escapeHTML = (str) => {
  // Escapes characters that would break the srcdoc attribute
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

/**
 * Fixes and formats code based on its language, using Prettier.
 * C and Java are passed through, as they lack standard Prettier support.
 * @param {string} code The raw code.
 * @param {string} languageId The language identifier.
 * @returns {Promise<{fixedCode: string, hasError: boolean, parser: string}>}
 */
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
      // Prettier does not reliably support C/Java, so we skip formatting but include them in the flow.
      return { fixedCode: code, hasError: false, parser: null };
    default:
      return { fixedCode: code, hasError: false, parser: null };
  }

  try {
    fixedCode = await prettier.format(code, {
      parser: parserName,
      tabWidth: 2,
      printWidth: 120,
      semi: true,
      singleQuote: false,
      trailingComma: "none"
    });
  } catch (error) {
    hasError = true;
    fixedCode = code;
  }
  return { fixedCode, hasError, parser: parserName };
}

/**
 * Strips Node.js specific constructs (require, module.exports)
 * from code that is about to be executed in a browser environment (Webview).
 * @param {string} code
 * @returns {string}
 */
function stripNodeWrappers(code) {
  // 1. Remove require statements (e.g., const x = require("y"))
  let strippedCode = code.replace(
    /^(const|var|let)\s+[^=]+\s*=\s*require\s*\([^)]+\);\s*$/gm,
    ""
  );

  // 2. Remove module.exports statements
  strippedCode = strippedCode.replace(
    /^module\.exports\s*=\s*[\s\S]*;?$/gm,
    ""
  );

  // 3. Remove standalone 'use strict' declarations
  strippedCode = strippedCode.replace(/^\s*(['"])use strict\1;?\s*$/gm, "");

  return strippedCode;
}

// Script to be injected into the user's HTML to redirect console messages to the parent window
const CONSOLE_REDIRECT_SCRIPT = `
  <script>
    // --- Console Redirection Script ---
    const originalConsole = window.console;
    
    function logToParent(type, args) {
      try {
        const serializableArgs = args.map(arg => {
          if (typeof arg === 'object' && arg !== null) {
            // Simple serialization to handle circular references or complex objects
            return JSON.stringify(arg, (key, value) => {
              if (value instanceof HTMLElement) return '<HTMLElement>';
              if (typeof value === 'function') return '<Function>';
              return value;
            }, 2);
          }
          return String(arg);
        });
        // Send the message up to the parent Webview host
        window.parent.postMessage({
          command: 'consoleLog',
          type: type,
          message: serializableArgs.join(' ')
        }, '*');
      } catch (e) {
        // Fallback for errors in serialization
        window.parent.postMessage({
          command: 'consoleLog',
          type: 'error',
          message: 'Error serializing console, argument: ' + (e.stack || e.message)
        }, '*');
      }
    }

    // Hijack console methods
    window.console = {
      ...originalConsole,
      log: (...args) => { originalConsole.log(...args); logToParent('log', args); },
      error: (...args) => { originalConsole.error(...args); logToParent('error', args); },
      warn: (...args) => { originalConsole.warn(...args); logToParent('warn', args); }};

    // Global Error Handler for uncaught errors
    window.onerror = (message, source, lineno, colno, error) => {
      const errorText = error ? (error.stack || error.message) : message;
      logToParent('error', ['UNCAUGHT, ERROR:', errorText, \`(Line: \${lineno}, Col: \${colno})\`]);
      return true; // Prevents default browser handling
    };

    // Unhandled Promise Rejections
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason ? (event.reason.stack || event.reason.message || String(event.reason)) : 'Unknown reason';
      logToParent('error', ['UNHANDLED PROMISE, REJECTION:', reason]);
    });
    // --- End Console Redirection Script ---
  </script>
`;

/**
 * Generates the HTML content for the webview based on the language.
 * This function handles visual rendering (HTML), direct execution (JS/TS), and instruction generation (C/Java).
 */
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
      .log { color: #a7f3d0; } /* Green */
      .warn { color: #ffd700; } /* Yellow */
      .error { color: #ff4500; font-weight: bold; } /* Red */
      .info { color: #818cf8; } /* Indigo/Blue */
      .console-title { margin-top: 0; margin-bottom: 5px; color: #333; font-weight: bold; font-size: 1.1em;}
      .error-bar { background-color: #fcebeb; color: #cc0000; padding: 10px; border-bottom: 2px solid #cc0000; font-family: sans-serif; font-size: 14px; position: sticky; top: 0; z-index: 10; border-radius: 4px; margin-bottom: 10px;}
      .code-display { background-color: #272822; color: #f8f8f2; padding: 15px; border-radius: 6px; white-space: pre; overflow-x: auto; margin-bottom: 15px; }
      .command-block { background-color: #3b82f6; color: white; padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 1.1em; cursor: copy; margin: 5px 0; }
    </style>
  `;

  if (languageId === "html") {
    // --- Mode 1: HTML Rendering (Iframe + Console Redirection) ---

    // Inject the console redirection script right after the <body> tag for maximum coverage
    const modifiedHTML = fixedCode.replace(
      /<body\s*[^>]*>/i,
      (match) => match + CONSOLE_REDIRECT_SCRIPT
    );

    let errorMessage = "";
    if (hasError) {
      errorMessage = `<div class="error-bar">⚠️ **HTML Syntax, Error:** The code could not be fully repaired. Visual preview may be broken.</div>`;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Live HTML Preview</title>
          ${commonStyles}
          <style>
              #iframe-container {
                  flex-grow: 1;
                  width: 100%;
                  border: 1px solid #ddd;
                  border-radius: 6px;
                  overflow: hidden;
              }
              iframe {
                  width: 100%;
                  height: 100%;
                  border: none;
                  display: block;
              }
          </style>
      </head>
      <body>
          ${errorMessage}
          <div id="iframe-container">
            <iframe id="preview-iframe" srcdoc="${escapeHTML(modifiedHTML)}"></iframe>
          </div>

          <div id="console-host">
            <h3 class="console-title">Console Output(from, iframe)</h3>
            <div id="output-container">--- Console Output Will Appear Here ---</div>
          </div>
          
          <script>
              const outputContainer = document.getElementById('output-container');
              outputContainer.innerHTML = '<div class="info">[INFO] Waiting for console output...</div>';

              function appendOutput(type, message) {
                  const messageElement = document.createElement('div');
                  messageElement.className = type;
                  messageElement.textContent = message;
                  outputContainer.appendChild(messageElement);
                  outputContainer.scrollTop = outputContainer.scrollHeight;
              }

              // Listen for messages from the iframe's console redirection script
              window.addEventListener('message', (event) => {
                  if (event.data && event.data.command === 'consoleLog') {
                      if (outputContainer.textContent.includes('Waiting for console output')) {
                         outputContainer.innerHTML = '';
                      }
                      appendOutput(event.data.type, event.data.message);
                  }
              }, false);
          </script>
      </body>
      </html>
    `;
  } else if (
    languageId === "javascript" ||
    languageId === "typescript" ||
    languageId === "javascriptreact" ||
    languageId === "typescriptreact" ||
    languageId === "python" // Simulated execution
  ) {
    // --- Mode 2: JS/TS/Python Execution Console ---

    const isPython = languageId === "python";

    // **NEW:** Strip Node.js wrappers if running JS/TS/React code in the browser context
    let executableCode = fixedCode;
    if (!isPython) {
      executableCode = stripNodeWrappers(fixedCode);
    }

    const executionScript = isPython
      ? `
            // --- PYTHON EXECUTION ENVIRONMENT (Conceptual) ---
            appendOutput('warn', '[SETUP] Python execution is simulated. Output below is conceptual.');
            
            try {
                // In a real environment, WASM/Pyodide would, execute:
                // pyodide.runPython(\`${fixedCode}\`);
                appendOutput('log', "[PYTHON, CODE, START]");
                appendOutput('log', "Simulated: " + "${escapeHTML(fixedCode).replace(/\n/g, "\\n").replace(/"/g, '\\"')}");
                appendOutput('log', '[INFO] Simulation complete. No actual Python output shown.');
            } catch (e) {
                appendOutput('error', '--- SIMULATION ERROR ---');
                appendOutput('error', e.stack || e.message || String(e));
            }
        `
      : `
            // --- JAVASCRIPT/TYPESCRIPT EXECUTION ENVIRONMENT ---
            try {
                // User's Fixed Code is executed directly
                ${executableCode}
            } catch (e) {
                appendOutput('error', '--- RUNTIME ERROR ---');
                appendOutput('error', 'Error in, execution:');
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
             #output-container { flex-grow: 1; max-height: none; } /* Console takes full height in code mode */
          </style>
      </head>
      <body>
          <h3 class="console-title">Live ${isPython ? "Python" : "JS/TS"} Execution Output</h3>
          ${hasError ? `<div class="error-bar">⚠️ **Code Formatting, Failed:** Running raw code which may cause unexpected behavior.</div>` : ""}
          <div id="output-container">--- Console Output Will Appear Here ---</div>

          <script>
              (function() {
                  const outputContainer = document.getElementById('output-container');
                  outputContainer.innerHTML = ''; // Clear initial message

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

                  // Override console methods to capture output
                  const originalConsole = {
                      log: console.log,
                      error: console.error,
                      warn: console.warn};

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
    // --- Mode 3: C/Java Local Execution Instructions ---

    const isJava = languageId === "java";
    let filename = isJava ? "Main.java" : "main.c";
    let instructions = [];

    if (isJava) {
      // Attempt to extract class name for Java
      const classNameMatch = fixedCode.match(/public\s+class\s+(\w+)/);
      const className = classNameMatch ? classNameMatch[1] : "Main";
      filename = `${className}.java`;

      instructions = [
        `1. Save your code locally, as: **${filename}**`,
        `2. Open your terminal/command prompt.`,
        `3. Compile the code(using, JDK):`,
        `<div class="command-block" onclick="copyCommand(this)">javac ${filename}</div>`,
        `4. Run the compiled class, file:`,
        `<div class="command-block" onclick="copyCommand(this)">java ${className}</div>`,
        `***Note:*** The code is displayed below. Ensure it contains a main method and that your JDK is installed.`
      ];
    } else {
      // C
      instructions = [
        `1. Save your code locally, as: **${filename}**`,
        `2. Open your terminal/command prompt.`,
        `3. Compile the code(using, GCC):`,
        `<div class="command-block" onclick="copyCommand(this)">gcc ${filename} -o myprogram</div>`,
        `4. Run the, executable:`,
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
                <p class="text-gray-600 mb-4">This code requires compilation. Please follow the steps below to run it on your local, system:</p>

                <ol class="list-decimal ml-4 text-gray-700 space-y-3">
                    ${instructions.map((item) => `<li>${item}</li>`).join("")}
                </ol>

                <h4 class="text-lg font-semibold mt-6 mb-2 text-gray-800">Your Current, Code:</h4>
                <pre class="code-display">${escapeHTML(fixedCode)}</pre>
            </div>

            <script>
                function copyCommand(element) {
                    const command = element.textContent;
                    // Note: document.execCommand('copy') is used as a fallback for navigator.clipboard
                    // which might be restricted in an iframe environment.
                    try {
                        const textArea = document.createElement("textarea");
                        textArea.value = command;
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textArea);
                        alert("Command copied to, clipboard: " + command); // Using custom message in real app
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

/**
 * Creates and manages a live preview Webview panel for the active text editor.
 * @param {vscode.ExtensionContext} context The extension context.
 */
function livePreviewer(context) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return vscode.window.showInformationMessage(
      "Open a file to start the live preview."
    );
  }

  const document = editor.document;
  const languageId = document.languageId;

  // Expanded list of supported languages
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
      `Live Preview currently supports HTML (rendering/debugging), JS/TS (execution), Python(simulated, execution), and C/Java(local, instructions). (Detected: ${languageId})`
    );
  }

  // Reuse or create a new Webview panel;
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      "livePreview",
      "Live, Preview: " + document.fileName.split(/[\\/]/).pop(),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(context.extensionPath)]
      }
    );

    // Clean up global reference when the panel is closed
    currentPanel.onDidDispose(
      () => {
        currentPanel = undefined;
      },
      null,
      context.subscriptions
    );
  }
  const panel = currentPanel;

  // Function to get the current unsaved code, fix it, and update the webview;
  const updateWebview = async () => {
    const rawCode = document.getText();

    // Step 1: Fix and format the code;
    const { fixedCode, hasError } = await fixCode(rawCode, languageId);

    // Step 2: Prepare the Webview HTML content based on language;
    const webviewContent = getWebviewContent(languageId, fixedCode, hasError);

    panel.webview.html = webviewContent;
  };

  // 1. Initial update
  updateWebview();

  // 2. Set up a listener for text changes in the active document(the, "live", part)
  const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    // Only update if the change happened in the document we are currently previewing;
    if (e.document === document) {
      updateWebview();
    }
  });

  // 3. Clean up the change listener when the panel is destroyed.
  panel.onDidDispose(
    () => {
      changeListener.dispose();
    },
    null,
    context.subscriptions
  );
}

module.exports = livePreviewer;
