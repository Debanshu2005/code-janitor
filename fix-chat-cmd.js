const fs = require('fs');
let content = fs.readFileSync('src/ai-agent/chat-panel.js', 'utf8');

const oldCmdHandler = `              const validation = this.agent.validateCommand(action.command);
              if (!validation.allowed) {
                this._postMessage({ type: "status", text: \`Blocked: \${validation.reason}\` });
                continue;
              }
              this._postMessage({ type: "confirm", command: action.command });
              const allowed = await new Promise((resolve) => { this._confirmResolve = resolve; });
              if (!allowed) {
                this._postMessage({ type: "status", text: \`Denied: \${action.command}\` });
                continue;
              }`;

const newCmdHandler = `              const validation = this.agent.validateCommand(action.command);
              if (!validation.allowed) {
                this._postMessage({ type: "status", text: \`Blocked: \${validation.reason}\` });
                continue;
              }
              
              if (validation.classification === 'destructive') {
                this._postMessage({ type: "confirm", command: action.command, classification: validation.classification });
                const allowed = await new Promise((resolve) => { this._confirmResolve = resolve; });
                if (!allowed) {
                  this._postMessage({ type: "status", text: \`Denied: \${action.command}\` });
                  continue;
                }
              } else {
                this._postMessage({ type: "status", text: \`Auto-running \${validation.classification} command: \${action.command}\` });
              }`;

const finalContent = content.replace(oldCmdHandler, newCmdHandler).replace(oldCmdHandler.replace(/\n/g, '\r\n'), newCmdHandler);
fs.writeFileSync('src/ai-agent/chat-panel.js', finalContent);
console.log('Updated chat-panel.js handler');
