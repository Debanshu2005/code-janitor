const fs = require('fs');
let content = fs.readFileSync('src/ai-agent/chat-panel.html', 'utf8');

const oldElseIf = `        } else if (msg.type === "error") {`;
const newElseIf = `        } else if (msg.type === "execution_card") {
          addActivity(\`Command \${msg.status}: \${msg.command}\`, msg.status === "success" ? "success" : "error");
          
          var wrap = document.createElement("div");
          wrap.className = "exec-card " + msg.status;
          wrap.style.cssText = "background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 12px; margin-top: 8px;";
          
          var header = document.createElement("div");
          header.style.cssText = "display: flex; align-items: center; justify-content: space-between; font-weight: bold; margin-bottom: 8px;";
          
          var title = document.createElement("span");
          var icon = msg.status === "success" ? "\u2705" : "\u274c";
          title.textContent = \`\${icon} \${msg.command}\`;
          
          var badge = document.createElement("span");
          badge.style.cssText = \`font-size: 0.8em; padding: 2px 6px; border-radius: 4px; background: \${msg.status === 'success' ? '#1b5e20' : '#b71c1c'};\`;
          badge.textContent = \`Exit: \${msg.exitCode}\${msg.retries ? ' (' + msg.retries + ' retries)' : ''}\`;
          
          header.appendChild(title);
          header.appendChild(badge);
          wrap.appendChild(header);
          
          if (msg.stdout) {
             var outLabel = document.createElement("div");
             outLabel.textContent = "stdout";
             outLabel.style.cssText = "font-size: 0.8em; opacity: 0.7; margin-top: 8px;";
             wrap.appendChild(outLabel);
             wrap.appendChild(makeCodeBlock("log", msg.stdout));
          }
          if (msg.stderr) {
             var errLabel = document.createElement("div");
             errLabel.textContent = "stderr";
             errLabel.style.cssText = "font-size: 0.8em; opacity: 0.7; margin-top: 8px; color: #ff8a80;";
             wrap.appendChild(errLabel);
             wrap.appendChild(makeCodeBlock("log", msg.stderr));
          }
          
          addRow(wrap, "ai");
        } else if (msg.type === "error") {`;

content = content.replace(oldElseIf, newElseIf);
fs.writeFileSync('src/ai-agent/chat-panel.html', content);
console.log('Added execution_card to chat-panel.html');
