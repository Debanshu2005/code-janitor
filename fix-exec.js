const fs = require('fs');
let content = fs.readFileSync('src/ai-agent/agent.js', 'utf8');

const oldExec = `  async executeCommand(command, workspaceFolder) {
    const validation = this.validateCommand(command);
    if (!validation.allowed) {
      // Log blocked command to performance monitor
      if (global.performanceMonitor) {
        global.performanceMonitor.recordIssue("blocked_command", {
          command,
          reason: validation.reason,
          workspace: workspaceFolder
        });
      }
      return { success: false, error: validation.reason };
    }

    return new Promise((resolve) => {
      const { exec, execFile } = require("child_process");
      const handleResult = (error, stdout, stderr) => {
          const rawOutput = [stdout, stderr].filter(Boolean).join("\\n");
          const outputInfo = this._truncateCommandOutput(rawOutput);
          const hitMaxBuffer =
            !!error &&
            ((error.code || "").toString() === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
              (error.message && error.message.includes("stdout maxBuffer")));

          if (error && !hitMaxBuffer) {
            resolve({
              success: false,
              output: outputInfo.text,
              error: error.message,
              outputTruncated: outputInfo.truncated
            });
            return;
          }

          resolve({
            success: true,
            output: outputInfo.text,
            outputTruncated: outputInfo.truncated || hitMaxBuffer
          });
      };

      if (!workspaceFolder) {
        exec(command, { maxBuffer: 1024 * 1024 }, handleResult);
        return;
      }

      exec(command, { cwd: workspaceFolder, maxBuffer: 1024 * 1024 }, handleResult);
    });
  }`;

const newExec = `  async executeCommand(command, workspaceFolder, options = {}) {
    const validation = this.validateCommand(command);
    if (!validation.allowed) {
      if (global.performanceMonitor) {
        global.performanceMonitor.recordIssue("blocked_command", { command, reason: validation.reason, workspace: workspaceFolder });
      }
      return { success: false, error: validation.reason };
    }

    const { getShellSession } = require("./shell-session");
    const shell = getShellSession(workspaceFolder || process.cwd());
    const result = await shell.execute(command, options);

    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\\n");
    const outputInfo = this._truncateCommandOutput(rawOutput);

    return {
      success: result.exitCode === 0,
      output: outputInfo.text,
      error: result.stderr,
      exitCode: result.exitCode,
      outputTruncated: outputInfo.truncated
    };
  }`;

const finalContent = content.replace(oldExec, newExec).replace(oldExec.replace(/\n/g, '\r\n'), newExec);
fs.writeFileSync('src/ai-agent/agent.js', finalContent);
console.log('Updated executeCommand');
