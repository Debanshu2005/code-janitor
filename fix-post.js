const fs = require('fs');
let content = fs.readFileSync('src/ai-agent/chat-panel.js', 'utf8');

const oldPost = `              // Only report to the UI once it succeeds or runs out of retries
              this._postMessage({
                type: result.success ? "applied" : "error",
                text: \`\${resultText}\${suffix}\`
              });`;

const newPost = `              // Report the final execution card to the UI
              this._postMessage({
                type: "execution_card",
                command: action.command,
                status: result.success ? "success" : "failed",
                stdout: result.output || "",
                stderr: result.error || "",
                exitCode: result.exitCode,
                retries: attempts > 1 ? attempts - 1 : 0
              });`;

const finalContent = content.replace(oldPost, newPost).replace(oldPost.replace(/\n/g, '\r\n'), newPost);
fs.writeFileSync('src/ai-agent/chat-panel.js', finalContent);
console.log('Updated to execution_card');
