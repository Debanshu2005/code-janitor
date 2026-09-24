const fs = require('fs');
let content = fs.readFileSync('C:/Users/Debanshu/.vscode/extensions/debanshu2005.code-janitor-1.4.0/src/ai-agent/agent.js', 'utf8');

const regex = /body: JSON\.stringify\(\{\s*model: config\.model,\s*messages: \[\s*\{\s*role: "system",\s*content: sysContent\s*\},\s*\{\s*role: "user",\s*content: safeUserContent\s*\}\s*\],\s*stream: true,\s*temperature: requestTemperature,\s*top_p: requestTopP\s*\}\)/m;

const replacement = `body: (() => { const b = JSON.stringify({ model: config.model, messages: [{ role: "system", content: sysContent }, { role: "user", content: safeUserContent }], stream: true, temperature: requestTemperature, top_p: requestTopP }); require("fs").appendFileSync(require("path").join(require("os").tmpdir(), "groq_payload.log"), "sys=" + sysContent.length + " user=" + safeUserContent.length + " total=" + b.length + "\\n"); return b; })()`;

content = content.replace(regex, replacement);
fs.writeFileSync('C:/Users/Debanshu/.vscode/extensions/debanshu2005.code-janitor-1.4.0/src/ai-agent/agent.js', content);
console.log('patched installed extension');
