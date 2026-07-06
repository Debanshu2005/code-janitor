/* eslint-env jest */
jest.mock(
  "vscode",
  () => ({
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3
    },
    commands: {
      executeCommand: jest.fn(),
      getCommands: jest.fn()
    },
    languages: {
      getDiagnostics: jest.fn()
    },
    workspace: {
      getConfiguration: jest.fn(() => ({
        get: jest.fn()
      }))
    }
  }),
  { virtual: true }
);

const path = require("path");
const vscode = require("vscode");
const { ArduinoDiagnostics } = require("../arduino-diagnostics");

describe("ArduinoDiagnostics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("uses active sketch directory when no workspace is open", () => {
    const diagnostics = new ArduinoDiagnostics(vscode);
    const activeEditor = {
      document: {
        uri: { scheme: "file" },
        fileName: path.join("C:", "Users", "demo", "Blink", "Blink.ino")
      }
    };

    expect(diagnostics.resolveProjectRoot(null, activeEditor)).toBe(
      path.join("C:", "Users", "demo", "Blink")
    );
  });

  test("collects only project errors and warnings", () => {
    const diagnostics = new ArduinoDiagnostics(vscode);
    const projectRoot = path.join("C:", "sketch");
    vscode.languages.getDiagnostics.mockReturnValue([
      [
        { scheme: "file", fsPath: path.join(projectRoot, "Blink.ino") },
        [
          {
            severity: vscode.DiagnosticSeverity.Error,
            message: "'ledPin' was not declared in this scope",
            range: { start: { line: 4 } }
          },
          {
            severity: vscode.DiagnosticSeverity.Information,
            message: "informational",
            range: { start: { line: 8 } }
          }
        ]
      ],
      [
        { scheme: "file", fsPath: path.join("C:", "other", "Other.ino") },
        [
          {
            severity: vscode.DiagnosticSeverity.Warning,
            message: "outside project",
            range: { start: { line: 1 } }
          }
        ]
      ]
    ]);

    expect(diagnostics.collectDiagnostics(projectRoot, null)).toEqual([
      {
        file: "Blink.ino",
        message: "'ledPin' was not declared in this scope",
        line: 5,
        severity: "error",
        error: "ERROR Line 5: 'ledPin' was not declared in this scope",
        isLibraryError: false
      }
    ]);
  });

  test("runs the first available Arduino verify command", async () => {
    const diagnostics = new ArduinoDiagnostics(vscode);
    vscode.commands.getCommands.mockResolvedValue([
      "arduino-ide.verify",
      "arduino.compile"
    ]);
    vscode.commands.executeCommand.mockResolvedValue(undefined);
    const onStatus = jest.fn();

    await expect(diagnostics.runVerifyCommand(onStatus)).resolves.toEqual({
      commandExecuted: true,
      executedCommand: "arduino-ide.verify",
      availableArduinoCommands: []
    });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "arduino-ide.verify"
    );
    expect(onStatus).toHaveBeenCalledWith(
      "Running verification using: arduino-ide.verify"
    );
  });
});
