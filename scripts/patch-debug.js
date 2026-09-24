const fs = require('fs');
let content = fs.readFileSync('src/ai-agent/agent.js', 'utf8');

const regex = /body: JSON\.stringify\(\{\s*model: config\.model,\s*messages: \[\s*\{\s*role: "system",\s*content: sysContent\s*\},\s*\{\s*role: "user",\s*content: safeUserContent\s*\}\s*\],\s*stream: true,\s*temperature: requestTemperature,\s*top_p: requestTopP\s*\}\)/m;

const replacement = `body: (() => { const b = JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: sysContent },
            { role: "user", content: safeUserContent }
          ],
          stream: true,
          temperature: requestTemperature,
          top_p: requestTopP
        }); require("fs").writeFileSync(require("path").join(require("os").tmpdir(), "groq_payload.json"), b); console.log("GROQ_PAYLOAD_SIZE:", b.length); return b; })()`;

content = content.replace(regex, replacement);
fs.writeFileSync('src/ai-agent/agent.js', content);
console.log('patched logs');
