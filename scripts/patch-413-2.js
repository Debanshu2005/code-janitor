const fs = require('fs');
let content = fs.readFileSync('src/ai-agent/agent.js', 'utf8');
content = content.replace('{ role: "user", content: userMessageContent }', '{ role: "user", content: safeUserContent }');
fs.writeFileSync('src/ai-agent/agent.js', content);
console.log('Done');
