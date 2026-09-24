const fs = require('fs');

function patch(filepath) {
  let content = fs.readFileSync(filepath, 'utf8');
  const target = `    if (config.provider === "groq") {\r
      const apiKey = config.groqApiKey;\r
      console.log("[Agent] Groq request - API key configured:", !!apiKey);`;
      
  const target2 = `    if (config.provider === "groq") {\n      const apiKey = config.groqApiKey;\n      console.log("[Agent] Groq request - API key configured:", !!apiKey);`;

  const replacement = `    if (config.provider === "groq") {
      const apiKey = config.groqApiKey;
      console.log("[Agent] Groq request - API key configured:", !!apiKey);
      
      let safeUserContent = userMessageContent;
      if (typeof safeUserContent === "string" && safeUserContent.length > 45000) {
        safeUserContent = "...[Context truncated to fit Groq 64KB API limit]\\n\\n" + safeUserContent.slice(-45000);
      }`;
      
  if (content.includes(target)) {
     content = content.replace(target, replacement);
  } else if (content.includes(target2)) {
     content = content.replace(target2, replacement);
  } else {
     console.log("NOT FOUND in " + filepath);
     return;
  }
  fs.writeFileSync(filepath, content);
  console.log("Patched " + filepath);
}

patch('src/ai-agent/agent.js');
patch('arduino-ide-agent/src/ai-agent/agent.js');
