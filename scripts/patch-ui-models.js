const fs = require('fs');

const files = [
  'src/ai-agent/chat-panel.js',
  'arduino-ide-agent/src/ai-agent/chat-panel.js',
  'package.json',
  'arduino-ide-agent/package.json',
  'src/ai-agent/agent.js',
  'arduino-ide-agent/src/ai-agent/agent.js'
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let code = fs.readFileSync(file, 'utf8');

  // Fix MODELS_BY_PROVIDER in chat-panel.js
  if (file.includes('chat-panel.js')) {
    // Single line version in src
    code = code.replace(
      /nvidia:\s*\["meta\/llama-3\.1-8b-instruct".*?\]/g,
      'nvidia: ["meta/llama-3.3-70b-instruct","meta/llama-3.2-3b-instruct","mistralai/mistral-nemo-12b-instruct","google/gemma-2-9b-it","meta/llama-3.1-8b-instruct"]'
    );
    // Multi-line version in arduino-ide-agent
    code = code.replace(
      /nvidia:\s*\[[\s\S]*?"nvidia\/llama-3\.3-nemotron-super-49b-v1\.5"\s*\]/g,
      'nvidia: ["meta/llama-3.3-70b-instruct", "meta/llama-3.2-3b-instruct", "mistralai/mistral-nemo-12b-instruct", "google/gemma-2-9b-it", "meta/llama-3.1-8b-instruct"]'
    );
  }

  // Replace default models
  code = code.replace(/"meta\/llama-3\.1-8b-instruct"/g, '"meta/llama-3.3-70b-instruct"');
  code = code.replace(/'meta\/llama-3\.1-8b-instruct'/g, "'meta/llama-3.3-70b-instruct'");

  fs.writeFileSync(file, code);
  console.log('Patched', file);
}
