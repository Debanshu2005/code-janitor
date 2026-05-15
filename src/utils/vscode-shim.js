let vscode = null;

try {
  vscode = require("vscode");
} catch {
  vscode = null;
}

if (vscode) {
  module.exports = vscode;
} else {
  const createConfigSection = () => ({
    get(_key, defaultValue) {
      return defaultValue;
    },
    async update() {}
  });

  module.exports = {
    window: {
      activeTextEditor: null,
      visibleTextEditors: [],
      tabGroups: { all: [] },
      onDidChangeActiveTextEditor() {
        return { dispose() {} };
      }
    },
    workspace: {
      workspaceFolders: [],
      textDocuments: [],
      getWorkspaceFolder() {
        return null;
      },
      getConfiguration() {
        return createConfigSection();
      }
    },
    commands: {
      async executeCommand() {}
    },
    Uri: {
      file(fsPath) {
        return { fsPath, scheme: "file" };
      },
      parse(value) {
        return {
          fsPath: String(value || ""),
          scheme: "file",
          toString() {
            return String(value || "");
          }
        };
      }
    }
  };
}
