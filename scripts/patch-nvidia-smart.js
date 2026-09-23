const fs = require('fs');

const files = [
  'src/ai-agent/agent.js',
  'arduino-ide-agent/src/ai-agent/agent.js'
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let code = fs.readFileSync(file, 'utf8');

  const target = `  _pickNvidiaModel(models, currentModel) {
    const normalizedCurrent = this._sanitizeNvidiaModel(currentModel);
    if (Array.isArray(models) && models.includes(normalizedCurrent)) {
      return normalizedCurrent;
    }

    for (const candidate of NVIDIA_FALLBACK_MODELS) {
      if (Array.isArray(models) && models.includes(candidate)) {
        return candidate;
      }
    }

    return Array.isArray(models) && models.length > 0
      ? models[0]
      : normalizedCurrent;
  }`;

  const replacement = `  _pickNvidiaModel(models, currentModel) {
    const normalizedCurrent = this._sanitizeNvidiaModel(currentModel);
    
    // Always trust the explicitly selected model first, even if it's missing from the discovery list.
    // The v1/models endpoint often caches or omits valid models.
    if (!Array.isArray(models) || models.length === 0 || models.includes(normalizedCurrent)) {
      return normalizedCurrent;
    }

    // Try hardcoded fallbacks
    for (const candidate of NVIDIA_FALLBACK_MODELS) {
      if (models.includes(candidate)) {
        return candidate;
      }
    }

    // Smart fallback: search for ANY llama, mistral, nemotron, or qwen model
    const smartFallback = models.find(m => /llama|mistral|nemotron|qwen/i.test(m));
    if (smartFallback) {
      return smartFallback;
    }

    // If all else fails, just return what the user selected rather than blindly picking models[0]
    // which might be an enterprise/paid model like yi-large
    return normalizedCurrent;
  }`;

  // Use a regex that ignores whitespace differences
  const regex = /_pickNvidiaModel\(models,\s*currentModel\)\s*\{[\s\S]*?return\s*Array\.isArray\(models\)\s*&&\s*models\.length\s*>\s*0\s*\?\s*models\[0\]\s*:\s*normalizedCurrent;\s*\}/g;
  
  if (code.match(regex)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync(file, code);
    console.log('Patched', file);
  } else {
    console.log('Regex did not match in', file);
  }
}
