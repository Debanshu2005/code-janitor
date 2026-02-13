// src/core/ai/ollama-client.js
const vscode = require('vscode');

class OllamaClient {
  constructor() {
    this.baseUrl = 'http://localhost:11434';
    this.model = 'claude';
  }

  getConfig() {
    const config = vscode.workspace.getConfiguration('codeJanitor.ai');
    return {
      enabled: config.get('enabled', false),
      baseUrl: config.get('ollamaUrl', this.baseUrl),
      model: config.get('model', this.model),
      timeout: config.get('timeout', 30000)
    };
  }

  async isAvailable() {
    const config = this.getConfig();
    if (!config.enabled) {
      return false;
    }

    try {
      const response = await fetch(`${config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      console.warn('Ollama not available:', error.message);
      return false;
    }
  }

  async analyzeSyntax(code, language) {
    const config = this.getConfig();
    
    if (!config.enabled) {
      return null;
    }

    const prompt = `Fix all syntax errors in this ${language} code. Return JSON with:
{"issues": [{"line": number, "issue": "description", "severity": "error|warning"}], "fixedCode": "corrected code"}

Code:
\`\`\`${language}
${code}
\`\`\``;

    try {
      const response = await fetch(`${config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt: prompt,
          stream: false,
          options: { temperature: 0.1 }
        }),
        signal: AbortSignal.timeout(config.timeout)
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const result = this.parseFixResponse(data.response, code);
      
      console.log(`AI fixed ${result.issues?.length || 0} syntax issues`);
      return result;
    } catch (error) {
      console.error('Ollama analysis failed:', error.message);
      return null;
    }
  }

  parseFixResponse(response, originalCode) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          issues: parsed.issues || [],
          fixedCode: parsed.fixedCode || originalCode
        };
      }
      return { issues: [], fixedCode: originalCode };
    } catch (error) {
      console.warn('Failed to parse AI response');
      return { issues: [], fixedCode: originalCode };
    }
  }

  parseAIResponse(response) {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return [];
    } catch (error) {
      console.warn('Failed to parse AI response');
      return [];
    }
  }

  async enhanceFixer(code, language, existingIssues = []) {
    const aiIssues = await this.analyzeSyntax(code, language);
    
    if (!aiIssues || aiIssues.length === 0) {
      return existingIssues;
    }

    const combined = [...existingIssues];
    
    for (const aiIssue of aiIssues) {
      const isDuplicate = existingIssues.some(
        existing => existing.line === aiIssue.line
      );
      
      if (!isDuplicate) {
        combined.push(aiIssue);
      }
    }

    return combined;
  }
}

module.exports = OllamaClient;