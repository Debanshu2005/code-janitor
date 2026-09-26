const fs = require('fs');

let content = fs.readFileSync('src/ai-agent/agent.js', 'utf8');

const regex = /if \(\!normalized\) \{\s*return false;\s*\}\s*return true;/m;
const replacement = `if (!normalized) {
      return false;
    }

    if (/^(dir|findstr|cmd|tree|type|copy|xcopy|del|ren|move)\\b/.test(normalized)) {
      return false;
    }

    return true;`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('src/ai-agent/agent.js', content);
    console.log("Patched agent.js successfully");
} else {
    console.log("Could not find target in agent.js");
}
