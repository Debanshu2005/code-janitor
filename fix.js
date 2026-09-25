const fs = require('fs');
let html = fs.readFileSync('src/ai-agent/chat-panel.html', 'utf8');

// 1. Update extractAssistantSections
const oldExtractRegex = /function extractAssistantSections[\s\S]*?return \{\s*thinking: \(match\[1\] \|\| ""\)\.trim\(\),\s*answer: \(match\[2\] \|\| ""\)\.trim\(\)\s*\};\s*\}/;

const newExtract = `function extractAssistantSections(text) {
        var normalized = String(text || "").replace(/\\r\\n/g, "\\n").trim();
        if (!normalized) return null;

        var thinkMatch = normalized.match(/^<think>\\s*([\\s\\S]*?)\\s*<\\/think>\\s*([\\s\\S]*)$/i);
        if (thinkMatch) {
          return {
            thinking: (thinkMatch[1] || "").trim(),
            answer: (thinkMatch[2] || "").trim()
          };
        }

        var match = normalized.match(/^(?:(?:#{1,6}\\s*)|\\*\\*)?Thinking(?:\\*\\*)?\\s*:?\\s*\\n([\\s\\S]*?)\\n(?:(?:#{1,6}\\s*)|\\*\\*)?Answer(?:\\*\\*)?\\s*:?\\s*\\n([\\s\\S]*)$/i);
        if (!match) return null;

        return {
          thinking: (match[1] || "").trim(),
          answer: (match[2] || "").trim()
        };
      }`;

html = html.replace(oldExtractRegex, newExtract);

// 2. Update renderSection
const oldRenderRegex = /function renderSection[\s\S]*?return section;\s*\}/;

const newRender = `function renderSection(title, body, className) {
        var section = document.createElement("div");
        section.className = "assistant-section " + className;

        if (className === "thinking") {
          var details = document.createElement("details");
          details.style.marginBottom = "8px";
          var summary = document.createElement("summary");
          summary.style.cursor = "pointer";
          summary.style.color = "var(--muted)";
          summary.style.fontSize = "0.9em";
          summary.style.userSelect = "none";
          summary.innerHTML = "<svg width='12' height='12' viewBox='0 0 16 16' style='display:inline-block; vertical-align:middle; margin-right:4px; fill:currentColor;'><path d='M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8z'></path><path d='M7 4h2v5H7V4zm0 6h2v2H7v-2z'></path></svg> Agent Thinking...";
          
          var content = document.createElement("div");
          content.style.marginTop = "6px";
          content.style.paddingLeft = "8px";
          content.style.borderLeft = "2px solid var(--border)";
          content.style.opacity = "0.8";
          content.appendChild(renderRichContent(body));
          
          details.appendChild(summary);
          details.appendChild(content);
          section.appendChild(details);
        } else {
          section.appendChild(renderRichContent(body));
        }
        return section;
      }`;

html = html.replace(oldRenderRegex, newRender);

fs.writeFileSync('src/ai-agent/chat-panel.html', html);
console.log("Updated JS Logic");
