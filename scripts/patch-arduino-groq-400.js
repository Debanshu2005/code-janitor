const fs = require('fs');

function patchFile(file) {
  let code = fs.readFileSync(file, 'utf8');
  
  const regex = /body:\s*JSON\.stringify\(\{\s*model:\s*config\.model,\s*messages:\s*\[[\s\S]*?\],\s*stream:\s*true,\s*temperature:\s*0\.2,\s*max_tokens:\s*maxTokens,\s*top_p:\s*0\.9\s*\}\)/g;
  
  const replacer = `body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: sysContent },
            { role: "user", content: userMessageContent }
          ],
          stream: true,
          temperature: 0.2,
          top_p: 0.9
        })`;

  if (code.match(regex)) {
    code = code.replace(regex, replacer);
    fs.writeFileSync(file, code);
    console.log('Patched via regex', file);
  } else {
    console.log('No match in', file);
  }
}

patchFile('arduino-ide-agent/src/ai-agent/agent.js');
