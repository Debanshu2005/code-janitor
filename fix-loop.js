const fs = require('fs');
let content = fs.readFileSync('src/ai-agent/chat-panel.js', 'utf8');

const oldExec = `              const result = await this.agent.executeCommand(action.command, workspaceFolder);
              const resultText = result.success
                ? (result.output || "Done.")
                : \`\${result.error}\${result.output ? \`\\n\${result.output}\` : ""}\`;
              const suffix = result.outputTruncated
                ? "\\n[Command output was truncated for safety.]"
                : "";
              this._postMessage({
                type: result.success ? "applied" : "error",
                text: \`\${resultText}\${suffix}\`
              });`;

const newExec = `              let result = await this.agent.executeCommand(action.command, workspaceFolder);
              
              // Autonomous Retry Loop
              let attempts = 1;
              let lastStderr = result.error || "";
              while (!result.success && attempts < 3) {
                 this._postMessage({ type: "status", text: \`Command failed. Autonomous self-correction attempt \${attempts}/3...\` });
                 
                 const retryPrompt = \`The command \\\`\${action.command}\\\` failed with exit code \${result.exitCode}.\\n\\nOutput:\\n\${result.output}\\n\\nError:\\n\${result.error}\\n\\nPlease analyze the error and output a NEW \\\`CMD:\\\` to fix this issue. Do not explain, just output the command.\`;
                 
                 const retryResponse = await this.agent.chat(retryPrompt, workspaceFolder, null, this.abortController?.signal, { mode: this.chatMode, skipHistory: true });
                 
                 if (retryResponse.error) break;
                 
                 const newCmdMatch = (retryResponse.text || "").match(/CMD:\\s*(.+)/i);
                 if (!newCmdMatch) break;
                 
                 action.command = newCmdMatch[1].trim();
                 
                 const val = this.agent.validateCommand(action.command);
                 if (!val.allowed) break;
                 if (val.classification === 'destructive') {
                   this._postMessage({ type: "confirm", command: action.command, classification: val.classification });
                   const allowed = await new Promise((res) => { this._confirmResolve = res; });
                   if (!allowed) break;
                 }
                 
                 result = await this.agent.executeCommand(action.command, workspaceFolder);
                 
                 if (!result.success && (result.error || "") === lastStderr) {
                   this._postMessage({ type: "status", text: \`Identical error repeated. Aborting autonomous retry.\` });
                   break;
                 }
                 lastStderr = result.error || "";
                 attempts++;
              }

              const resultText = result.success
                ? (result.output || "Done.")
                : \`\${result.error}\${result.output ? \`\\n\${result.output}\` : ""}\`;
              const suffix = result.outputTruncated
                ? "\\n[Command output was truncated for safety.]"
                : "";
              
              // Only report to the UI once it succeeds or runs out of retries
              this._postMessage({
                type: result.success ? "applied" : "error",
                text: \`\${resultText}\${suffix}\`
              });`;

const finalContent = content.replace(oldExec, newExec).replace(oldExec.replace(/\n/g, '\r\n'), newExec);
fs.writeFileSync('src/ai-agent/chat-panel.js', finalContent);
console.log('Updated chat-panel.js with autonomous retry loop');
