const fs = require('fs');
let html = fs.readFileSync('src/ai-agent/chat-panel.html', 'utf8');

const oldText = `          if (sections.thinking) {
            wrap.appendChild(renderSection("Thinking", sections.thinking, "thinking"));
          }
          wrap.appendChild(renderSection("Answer", sections.answer || "", "answer"));`;

const newText = `          if (sections.thinking) {
            wrap.appendChild(renderSection("Thinking", sections.thinking, "thinking", !sections.answer));
          }
          if (sections.answer) {
            wrap.appendChild(renderSection("Answer", sections.answer || "", "answer"));
          }`;

html = html.replace(oldText, newText);
// Fallback for CRLF
html = html.replace(oldText.replace(/\n/g, "\r\n"), newText);

fs.writeFileSync('src/ai-agent/chat-panel.html', html);
console.log("Updated HTML");
