const vscode = require("vscode");

// Map file extensions / languageIds → fixer
function getFixerForDocument(document, code, fileName) {
  if (
    /\.(c|h|cpp|ino)$/i.test(fileName) ||
    ["c", "cpp", "cppm"].includes(document.languageId)
  ) {
    console.log("✓ Loading EmbeddedCFixer for C/C++/Arduino file");
    const EmbeddedCFixer = require("./core/fixers/EmbeddedCFixer");
    return new EmbeddedCFixer(code, fileName);
  } else if (fileName.endsWith(".java") || document.languageId === "java") {
    console.log("✓ Loading JavaFixer for Java file");
    const JavaFixer = require("./core/fixers/JavaFixer");
    return new JavaFixer(code, fileName);
  } else if (
    /\.(js|jsx)$/i.test(fileName) ||
    ["javascript", "javascriptreact"].includes(document.languageId)
  ) {
    console.log("✓ Loading JavascriptFixer for JavaScript file");
    const JavascriptFixer = require("./core/fixers/javascript-fixer");
    return new JavascriptFixer(code, fileName);
  } else if (fileName.endsWith(".py") || document.languageId === "python") {
    console.log("✓ Loading PythonFixer for Python file");
    const PythonFixer = require("./core/fixers/python-fixer");
    return new PythonFixer(code, fileName);
  } else if (fileName.endsWith(".html") || document.languageId === "html") {
    // ✅ HTML support
    console.log("✓ Loading HtmlFixer for HTML file");
    const HtmlFixer = require("./core/fixers/html-fixer");
    return new HtmlFixer(code, fileName);
  }
  return null;
}

async function runFixerAndApply(document, editor = null) {
  const code = document.getText();
  const fileName = document.fileName;

  console.log(`✓ Processing, file: ${fileName}`);
  console.log(`✓ File, languageId: ${document.languageId}`);

  const fixer = getFixerForDocument(document, code, fileName);
  if (!fixer) {
    vscode.window.showInformationMessage("Unsupported file type!");
    return false;
  }

  try {
    console.log("✓ Fixer loaded successfully, analyzing code...");
    if (fixer.analyze) {
      await Promise.resolve(fixer.analyze());
    }

    const fixedCode = fixer.applyFixes
      ? fixer.applyFixes()
      : fixer.getFixedCode
        ? fixer.getFixedCode()
        : code;

    if (fixedCode === code) {
      console.log("✨ No changes detected");
      return false;
    }

    console.log("✓ Code analysis complete, applying fixes...");
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.lineAt(document.lineCount - 1).range.end
    );
    edit.replace(document.uri, fullRange, fixedCode);
    await vscode.workspace.applyEdit(edit);

    if (editor) {
      await document.save();
    }

    console.log("✓ Code formatted successfully!");
    return true;
  } catch (error) {
    console.error("✗ Code Janitor, error:", error);
    vscode.window.showErrorMessage(`Code Janitor, Error: ${error.message}`);

    if (error.code === "MODULE_NOT_FOUND") {
      vscode.window.showErrorMessage(`Missing, dependency: ${error.message}`);
    }
    return false;
  }
}

function activate(context) {
  console.log("✓ Code Janitor extension is activating...");

  // 1. Manual Fix Command
  const fixDisposable = vscode.commands.registerCommand(
    "codeJanitor.fixCode",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found!");
        return;
      }

      const changed = await runFixerAndApply(editor.document, editor);
      if (changed) {
        vscode.window.showInformationMessage("✅ Code formatted successfully!");
      } else {
        vscode.window.showInformationMessage("✨ Nothing to fix!");
      }
    }
  );
  context.subscriptions.push(fixDisposable);

  // 2. Live Preview Command(Protected, Activation)
  try {
    // Correctly require the 'live-preview.js' file
    const livePreviewer = require("./live-preview");

    const previewDisposable = vscode.commands.registerCommand(
      "codeJanitor.livePreview",
      () => livePreviewer(context)
    );
    context.subscriptions.push(previewDisposable);
    console.log("✓ Live Preview command registered.");
  } catch (error) {
    // If the module import fails (e.g., file name typo or missing dependencies in live-preview.js),
    // the core extension activation continues, but we warn the user.
    console.warn(
      "⚠️ Could not register codeJanitor.livePreview. Check that `./live-preview.js` exists and is accessible. Error:",
      error.message
    );
  }

  // 3. Auto-fix before save
  vscode.workspace.onWillSaveTextDocument(async (event) => {
    console.log("🧹 Auto-fix triggered before save...");
    await runFixerAndApply(event.document);
  });

  console.log("✓ Code Janitor extension activated successfully!");
}

function deactivate() {
  console.log("✓ Code Janitor extension deactivated");
}

module.exports = { activate, deactivate };
