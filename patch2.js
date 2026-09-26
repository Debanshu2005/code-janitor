const fs = require('fs');

let content = fs.readFileSync('src/ai-agent/chat-panel.js', 'utf8');

const regex = /\\s*streamController\\?\\.ensureFinalTextVisible\\([\\s\\S]*?this\\._postSessionState\\(\\);/m;
const match = content.match(regex);

if (match) {
    const block = match[0];
    content = content.replace(block, "");
    
    // Find the insertion point (before hasFileAction)
    const hasFileActionStr = `          const hasFileAction = response.actions.some(`;
    content = content.replace(
        hasFileActionStr,
        block.trim() + "\\n\\n" + hasFileActionStr
    );
    
    fs.writeFileSync('src/ai-agent/chat-panel.js', content);
    console.log("Moved finalization block successfully.");
} else {
    console.log("Could not find the block via regex.");
}
