const fs = require('fs');
let content = fs.readFileSync('C:/Users/Debanshu/.vscode/extensions/debanshu2005.code-janitor-1.4.0/src/ai-agent/agent.js', 'utf8');

const replacement = `
      let safeUserContent = userMessageContent;
      const MAX_GROQ_CHARS = 12000;
      if (typeof safeUserContent === 'string' && safeUserContent.length > MAX_GROQ_CHARS) {
        safeUserContent = "...[Context truncated to fit Groq 64KB API limit]\\n\\n" + safeUserContent.slice(-MAX_GROQ_CHARS);
      } else if (Array.isArray(safeUserContent) && safeUserContent.length > 0 && safeUserContent[0].type === 'text') {
        if (safeUserContent[0].text && safeUserContent[0].text.length > MAX_GROQ_CHARS) {
           safeUserContent[0].text = "...[Context truncated to fit Groq 64KB API limit]\\n\\n" + safeUserContent[0].text.slice(-MAX_GROQ_CHARS);
        }
      }
`;

content = content.replace(/let safeUserContent = userMessageContent;[\s\S]*?safeUserContent\.slice\(-16000\);\s*\}/m, replacement);
fs.writeFileSync('C:/Users/Debanshu/.vscode/extensions/debanshu2005.code-janitor-1.4.0/src/ai-agent/agent.js', content);
console.log('patched');
