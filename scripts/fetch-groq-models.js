const fs = require('fs');
const path = require('path');
const { Agent } = require('./src/ai-agent/agent.js');

async function test() {
  const config = {
    get: (key) => {
      // Mock global config fetcher
      try {
        const configStr = fs.readFileSync(path.join(process.env.USERPROFILE, '.codejanitor', 'config.json'), 'utf8');
        const parsed = JSON.parse(configStr);
        return parsed[key] || "";
      } catch {
        return "";
      }
    }
  };
  
  const agent = new Agent({ getConfig: () => config, getMcpClientManager: () => null });
  const models = await agent._fetchGroqModelNames(config.get('groqApiKey'));
  console.log("Live Groq Models:", models);
}

test().catch(console.error);
