// src/core/ai/ollama-client.js
const vscode = require('vscode');

class OllamaClient {
  constructor() {
    this.baseUrl = 'http://localhost:11434';
    this.model = 'qwen2.5-coder:1.5b';
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
    console.log(`🔍 AI Config: enabled=${config.enabled}, url=${config.baseUrl}, model=${config.model}, timeout=${config.timeout}`);
    
    if (!config.enabled) {
      console.log('❌ AI is disabled in settings');
      return false;
    }

    try {
      console.log('🔍 Checking Ollama availability...');
      const response = await fetch(`${config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      const available = response.ok;
      console.log(`✓ Ollama available: ${available}`);
      return available;
    } catch (error) {
      console.warn('❌ Ollama not available:', error.message);
      return false;
    }
  }

  async validateAndFix(originalCode, ruleBasedFix, language) {
    const config = this.getConfig();
    
    if (!config.enabled) {
      return { shouldUseAI: false, fixedCode: ruleBasedFix, reason: "AI disabled", securityIssues: [] };
    }

    const prompt = `Analyze this ${language} code for syntax errors AND security vulnerabilities (SQL injection, XSS, hardcoded secrets, etc.).

Code:
${originalCode}

Provide:
1. Fixed code with syntax corrections
2. List of security issues found

Format: JSON with {"fixedCode": "...", "securityIssues": [{"line": 1, "issue": "...", "severity": "high/medium/low"}]}`;

    try {
      console.log(`🤖 Sending AI validation request for ${language}...`);
      const response = await fetch(`${config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt: prompt,
          stream: false,
          options: { 
            temperature: 0.1,
            num_predict: 1024
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const result = this.parseSecurityResponse(data.response, ruleBasedFix);
      
      console.log(`✓ AI validation complete: ${result.reason}`);
      if (result.securityIssues && result.securityIssues.length > 0) {
        console.log(`⚠️ Found ${result.securityIssues.length} security issue(s)`);
      }
      return result;
    } catch (error) {
      console.error('❌ AI validation failed:', error.message);
      return { shouldUseAI: false, fixedCode: ruleBasedFix, reason: "AI unavailable", securityIssues: [] };
    }
  }

  parseSecurityResponse(response, fallbackCode) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          shouldUseAI: parsed.fixedCode && parsed.fixedCode !== fallbackCode,
          fixedCode: parsed.fixedCode || fallbackCode,
          reason: parsed.securityIssues?.length > 0 ? "Security issues found" : "Code is secure",
          securityIssues: parsed.securityIssues || []
        };
      }
      return { shouldUseAI: false, fixedCode: fallbackCode, reason: "Could not parse AI response", securityIssues: [] };
    } catch (error) {
      console.warn('Failed to parse AI security response');
      return { shouldUseAI: false, fixedCode: fallbackCode, reason: "Parse error", securityIssues: [] };
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