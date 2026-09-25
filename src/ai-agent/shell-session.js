const { spawn } = require("child_process");
const crypto = require("crypto");
const os = require("os");
const EventEmitter = require("events");

class PersistentShell extends EventEmitter {
  constructor(cwd) {
    super();
    this.cwd = cwd || process.cwd();
    this.isWindows = os.platform() === "win32";
    
    // Detect shell
    this.shellPath = process.env.SHELL || (this.isWindows ? "powershell.exe" : "/bin/bash");
    
    // Spawn
    const isPwsh = this.isWindows && this.shellPath.toLowerCase().includes("powershell");
    const args = isPwsh ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"] : [];
    this.process = spawn(this.shellPath, args, {
      cwd: this.cwd,
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    
    this.ready = true;
    this.currentCommand = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    
    this.process.stdout.on("data", (data) => this._onStdout(data));
    this.process.stderr.on("data", (data) => this._onStderr(data));
    
    this.process.on("error", (err) => {
      if (this.currentCommand) {
        this.currentCommand.resolve({
          stdout: this.stdoutBuffer,
          stderr: this.stderrBuffer + `\nShell error: ${err.message}`,
          exitCode: -1,
          durationMs: Date.now() - this.currentCommand.startTime,
          timedOut: false
        });
        this.currentCommand = null;
      }
    });
    
    this.process.on("close", (code) => {
      if (this.currentCommand) {
        this.currentCommand.resolve({
          stdout: this.stdoutBuffer,
          stderr: this.stderrBuffer + `\nShell closed unexpectedly with code ${code}`,
          exitCode: code || -1,
          durationMs: Date.now() - this.currentCommand.startTime,
          timedOut: false
        });
        this.currentCommand = null;
      }
    });
  }

  _onStdout(data) {
    const text = data.toString();
    this.stdoutBuffer += text;
    this.emit("output", { type: "stdout", data: text });
    this._checkSentinel();
  }

  _onStderr(data) {
    const text = data.toString();
    this.stderrBuffer += text;
    this.emit("output", { type: "stderr", data: text });
  }

  _checkSentinel() {
    if (!this.currentCommand) return;
    
    const sentinel = this.currentCommand.sentinel;
    const regex = new RegExp(`${sentinel}[\\r\\n]+([\\-\\d]+)`);
    
    const match = this.stdoutBuffer.match(regex);
    if (match) {
      // Command finished!
      const exitCode = parseInt(match[1], 10);
      const cleanStdout = this.stdoutBuffer.substring(0, match.index);
      
      clearTimeout(this.currentCommand.timeoutId);
      
      const result = {
        stdout: cleanStdout.trim(),
        stderr: this.stderrBuffer.trim(),
        exitCode: isNaN(exitCode) ? -1 : exitCode,
        durationMs: Date.now() - this.currentCommand.startTime,
        timedOut: false
      };
      
      this.currentCommand.resolve(result);
      this.currentCommand = null;
    }
  }

  execute(command, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        return resolve({ stdout: "", stderr: "Shell process is dead.", exitCode: -1, durationMs: 0, timedOut: false });
      }
      
      // Wait for previous to finish? Here we assume sequential execution per chat turn
      if (this.currentCommand) {
        return resolve({ stdout: "", stderr: "A command is already running.", exitCode: -1, durationMs: 0, timedOut: false });
      }

      this.stdoutBuffer = "";
      this.stderrBuffer = "";
      const sentinel = "CMD_END_" + crypto.randomUUID().replace(/-/g, "");
      
      let shellCmd;
      if (this.isWindows) {
        // ALWAYS use PowerShell formatting on Windows if we spawn powershell, but check shellPath just in case.
        if (this.shellPath.toLowerCase().includes("powershell")) {
          shellCmd = `${command}\r\n$err = if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }\r\nWrite-Output "${sentinel}"\r\nWrite-Output $err\r\n`;
        } else {
          shellCmd = `${command}\r\necho ${sentinel}\r\necho %errorlevel%\r\n`;
        }
      } else {
        // POSIX
        shellCmd = `${command}\necho "${sentinel}"\necho $?\n`;
      }
      
      const timeoutMs = options.timeoutMs || 30000;
      const timeoutId = setTimeout(() => {
        if (this.currentCommand) {
          // We don't kill the shell process so long-running commands (like npm start) can keep running in background.
          // But we resolve the promise so the chat doesn't hang.
          this.currentCommand.resolve({
            stdout: this.stdoutBuffer.trim(),
            stderr: this.stderrBuffer.trim() + "\n[Command timed out, left running in background]",
            exitCode: 0, // Assume OK if it runs indefinitely
            durationMs: Date.now() - this.currentCommand.startTime,
            timedOut: true
          });
          this.currentCommand = null;
        }
      }, timeoutMs);

      this.currentCommand = {
        sentinel,
        startTime: Date.now(),
        resolve,
        timeoutId
      };
      
      this.process.stdin.write(shellCmd);
    });
  }

  dispose() {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }
}

// Singleton manager
const sessions = new Map();

function getShellSession(workspaceFolder) {
  if (!workspaceFolder) return null;
  if (!sessions.has(workspaceFolder)) {
    sessions.set(workspaceFolder, new PersistentShell(workspaceFolder));
  }
  return sessions.get(workspaceFolder);
}

function disposeShellSessions() {
  for (const session of sessions.values()) {
    session.dispose();
  }
  sessions.clear();
}

module.exports = {
  PersistentShell,
  getShellSession,
  disposeShellSessions
};
