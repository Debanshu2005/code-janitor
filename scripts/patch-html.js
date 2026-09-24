const fs = require('fs');
let html1 = fs.readFileSync('src/ai-agent/chat-panel.html', 'utf8');
html1 = html1.replace('models: ["llama-3.1-8b-instant","llama-3.1-70b-versatile","llama3-8b-8192","llama3-70b-8192","mixtral-8x7b-32768","gemma2-9b-it"]', 'models: ["openai/gpt-oss-120b","openai/gpt-oss-20b","qwen/qwen3.8-27b","allam-2-7b"]');
fs.writeFileSync('src/ai-agent/chat-panel.html', html1);

let html2 = fs.readFileSync('arduino-ide-agent/src/ai-agent/chat-panel.html', 'utf8');
html2 = html2.replace('models: ["llama-3.1-8b-instant","llama-3.1-70b-versatile","llama3-8b-8192","llama3-70b-8192","mixtral-8x7b-32768","gemma2-9b-it"]', 'models: ["openai/gpt-oss-120b","openai/gpt-oss-20b","qwen/qwen3.8-27b","allam-2-7b"]');
fs.writeFileSync('arduino-ide-agent/src/ai-agent/chat-panel.html', html2);
console.log('done');
