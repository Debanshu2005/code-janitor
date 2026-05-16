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

  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }

  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  class Location {
    constructor(uri, range) {
      this.uri = uri;
      this.range = range;
    }
  }

  class Diagnostic {
    constructor(range, message, severity) {
      this.range = range;
      this.message = message;
      this.severity = severity;
      this.source = undefined;
      this.code = undefined;
      this.relatedInformation = [];
    }
  }

  class DiagnosticRelatedInformation {
    constructor(location, message) {
      this.location = location;
      this.message = message;
    }
  }

  const DiagnosticSeverity = {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3
  };

  const createDiagnosticCollection = () => {
    const entries = new Map();
    return {
      set(uri, diagnostics) {
        entries.set(uri?.fsPath || String(uri), diagnostics);
      },
      get(uri) {
        return entries.get(uri?.fsPath || String(uri));
      },
      delete(uri) {
        entries.delete(uri?.fsPath || String(uri));
      },
      clear() {
        entries.clear();
      },
      dispose() {
        entries.clear();
      }
    };
  };

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
      onWillSaveTextDocument() {
        return { dispose() {} };
      },
      getConfiguration() {
        return createConfigSection();
      }
    },
    languages: {
      createDiagnosticCollection
    },
    commands: {
      async executeCommand() {}
    },
    Position,
    Range,
    Location,
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
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
