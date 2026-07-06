const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const ARDUINO_VERIFY_COMMANDS = [
  "arduino-ide.verify",
  "arduino.languageserver.verify",
  "arduino.verify",
  "arduino-cli.verify",
  "arduino-ide.compile",
  "arduino.compile"
];

const SOURCE_PATTERN = /\.(ino|pde|h|hpp|c|cpp|cc|cxx)$/i;
const IGNORED_SOURCE_DIRS = new Set([
  ".git",
  "node_modules",
  "build",
  "dist",
  "out",
  ".arduinoIDE",
  ".pio"
]);

class ArduinoDiagnostics {
  constructor(vscodeApi = vscode) {
    this.vscode = vscodeApi;
  }

  resolveProjectRoot(workspaceFolder, activeEditor) {
    if (workspaceFolder) return workspaceFolder;

    const activePath = activeEditor?.document?.fileName || "";
    if (!activePath || activeEditor?.document?.uri?.scheme !== "file") {
      return null;
    }

    return path.dirname(activePath);
  }

  async walkSourceFiles(rootDir, bucket = []) {
    if (!rootDir) return bucket;

    let entries = [];
    try {
      entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    } catch (_) {
      return bucket;
    }

    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_SOURCE_DIRS.has(entry.name)) {
          await this.walkSourceFiles(fullPath, bucket);
        }
        continue;
      }

      if (SOURCE_PATTERN.test(entry.name)) {
        bucket.push(fullPath);
      }
    }

    return bucket;
  }

  _readConfigValue(configName, keys) {
    try {
      const config = this.vscode.workspace.getConfiguration(configName);
      for (const key of keys) {
        const value = config.get(key);
        if (value) return value;
      }
    } catch (_) {
      // Config lookup is best effort across Arduino IDE and compatible hosts.
    }

    return null;
  }

  _formatConfigObject(value, fallback) {
    if (!value) return "";
    if (typeof value !== "object") return String(value);

    const direct =
      value.name ||
      value.boardName ||
      value.address ||
      value.port ||
      value.portName ||
      value.fqbn ||
      value.board ||
      value.selectedBoard ||
      value.type ||
      value.id ||
      value.device;

    if (direct && typeof direct !== "object") return String(direct);

    const fqbn = value.fqbn || value.FQBN || "";
    if (typeof fqbn === "string" && fqbn.includes(":")) {
      const parts = fqbn.split(":");
      const boardPart = parts[2] || parts[parts.length - 1];
      if (boardPart) {
        return boardPart.charAt(0).toUpperCase() + boardPart.slice(1);
      }
    }

    const filtered = {};
    for (const key of Object.keys(value)) {
      if (value[key] && value[key] !== "" && key !== "certificates") {
        filtered[key] = value[key];
      }
    }

    return Object.keys(filtered).length > 0 ? JSON.stringify(filtered) : fallback;
  }

  async _detectPortFromSystem(commandRunner, workspaceFolder) {
    if (process.platform === "win32") {
      if (typeof commandRunner !== "function") return null;
      const result = await commandRunner("mode", workspaceFolder);
      const match = String(result?.output || "").match(/COM\d+/i);
      return match ? match[0] : null;
    }

    try {
      const devEntries = await fs.promises.readdir("/dev");
      const prefix =
        process.platform === "darwin"
          ? /^cu\./i
          : /^(ttyUSB|ttyACM|ttyS)/i;
      const entry = devEntries.find((name) => prefix.test(name));
      return entry ? path.join("/dev", entry) : null;
    } catch (_) {
      return null;
    }
  }

  async detectBoardAndPort({ workspaceFolder, commandRunner }) {
    let board = this._readConfigValue("arduino", [
      "board",
      "selectedBoard",
      "defaultBoard"
    ]);
    let port = this._readConfigValue("arduino", [
      "port",
      "selectedPort",
      "defaultPort"
    ]);

    if (!board || !port) {
      try {
        const boardList = await this.vscode.commands.executeCommand(
          "arduino-ide.boardList"
        );
        if (!board && Array.isArray(boardList) && boardList.length > 0) {
          board = boardList[0]?.matchingBoards?.[0] || boardList[0];
        }
        if (!port && Array.isArray(boardList) && boardList.length > 0) {
          port = boardList[0]?.address || boardList[0]?.port || boardList[0];
        }
      } catch (_) {
        // Command availability varies by host; config/system fallbacks follow.
      }
    }

    if (!board || !port) {
      board =
        board ||
        this._readConfigValue("arduino.workbench", ["board", "selectedBoard"]);
      port =
        port ||
        this._readConfigValue("arduino.workbench", ["port", "selectedPort"]);
    }

    if (!port) {
      port = await this._detectPortFromSystem(commandRunner, workspaceFolder);
    }

    const boardName = this._formatConfigObject(board, "Unknown Board");
    const portName = this._formatConfigObject(port, "Not detected");
    const boardInfo = board
      ? `Board: ${boardName} | Port: ${port ? portName : "Not detected"}`
      : "";

    return {
      board,
      port,
      boardName,
      portName,
      boardInfo
    };
  }

  async runVerifyCommand(onStatus) {
    let commandExecuted = false;
    let executedCommand = "";
    let availableArduinoCommands = [];

    let allCommands = [];
    try {
      allCommands = await this.vscode.commands.getCommands();
    } catch (_) {
      allCommands = [];
    }

    for (const cmd of ARDUINO_VERIFY_COMMANDS) {
      if (allCommands.length > 0 && !allCommands.includes(cmd)) continue;

      try {
        await this.vscode.commands.executeCommand(cmd);
        commandExecuted = true;
        executedCommand = cmd;
        onStatus?.(`Running verification using: ${cmd}`);
        break;
      } catch (_) {
        // Try the next Arduino host command.
      }
    }

    if (!commandExecuted) {
      availableArduinoCommands = allCommands
        .filter((cmd) => cmd.toLowerCase().includes("arduino"))
        .slice(0, 10);
    }

    return {
      commandExecuted,
      executedCommand,
      availableArduinoCommands
    };
  }

  collectDiagnostics(projectRoot, specificFiles) {
    const diagnostics = this.vscode.languages.getDiagnostics();
    const issues = [];
    const specific = Array.isArray(specificFiles)
      ? new Set(specificFiles.map((file) => file.replace(/\\/g, "/")))
      : null;

    for (const [uri, fileDiagnostics] of diagnostics) {
      if (uri.scheme !== "file") continue;

      const relativePath = path
        .relative(projectRoot, uri.fsPath)
        .replace(/\\/g, "/");
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        continue;
      }
      if (specific && !specific.has(relativePath)) continue;

      for (const diag of fileDiagnostics) {
        const isError = diag.severity === this.vscode.DiagnosticSeverity.Error;
        const isWarning =
          diag.severity === this.vscode.DiagnosticSeverity.Warning;
        if (!isError && !isWarning) continue;

        const line = diag.range.start.line + 1;
        const severity = isError ? "error" : "warning";
        issues.push({
          file: relativePath,
          message: diag.message,
          line,
          severity,
          error: `${severity.toUpperCase()} Line ${line}: ${diag.message}`,
          isLibraryError:
            /library|import|include|module|package|cannot find|no such file/i.test(
              diag.message
            )
        });
      }
    }

    return issues;
  }

  async collectProjectHealth({
    workspaceFolder,
    activeEditor,
    specificFiles,
    commandRunner,
    onStatus,
    runVerify = true,
    verifyWaitMs = 2000
  }) {
    const projectRoot = this.resolveProjectRoot(workspaceFolder, activeEditor);
    if (!projectRoot) {
      return {
        projectRoot: null,
        issues: [],
        error: "Open an Arduino sketch or workspace first."
      };
    }

    const boardState = await this.detectBoardAndPort({
      workspaceFolder: projectRoot,
      commandRunner
    });

    let verifyState = {
      commandExecuted: false,
      executedCommand: "",
      availableArduinoCommands: []
    };

    if (runVerify) {
      verifyState = await this.runVerifyCommand(onStatus);
      await new Promise((resolve) => setTimeout(resolve, verifyWaitMs));
    }

    return {
      projectRoot,
      ...boardState,
      ...verifyState,
      issues: this.collectDiagnostics(projectRoot, specificFiles)
    };
  }
}

module.exports = {
  ArduinoDiagnostics,
  ARDUINO_VERIFY_COMMANDS,
  SOURCE_PATTERN,
  IGNORED_SOURCE_DIRS
};
