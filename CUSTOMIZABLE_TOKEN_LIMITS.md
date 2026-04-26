# Customizable Token Limits Feature

## Version: 1.10.0

## Overview
Code Janitor now supports user-configurable token limits for AI responses. This allows users to customize response length based on their specific needs, model capabilities, and cost considerations.

## Problem
Previously, token limits were hardcoded in the agent:
- Fast mode: 2048 tokens
- Heavy mode: 4096 tokens
- Create mode: 8192 tokens

This caused issues for users who:
- Wanted longer, more detailed responses
- Needed to reduce costs by limiting token usage
- Used models with different optimal token ranges
- Required different limits for different use cases

## Solution
Added three new configuration options that allow users to customize token limits for each mode while maintaining sensible defaults and validation.

## Configuration Options

### 1. Fast Mode Token Limit
```json
"codeJanitor.ai.maxTokens.fast": 2048
```
- **Default**: 2048 tokens
- **Range**: 512 - 4096 tokens
- **Use Case**: Quick responses, simple queries, code explanations

### 2. Heavy Mode Token Limit
```json
"codeJanitor.ai.maxTokens.heavy": 4096
```
- **Default**: 4096 tokens
- **Range**: 1024 - 8192 tokens
- **Use Case**: Complex analysis, code reviews, refactoring suggestions

### 3. Create Mode Token Limit
```json
"codeJanitor.ai.maxTokens.create": 8192
```
- **Default**: 8192 tokens
- **Range**: 2048 - 16384 tokens
- **Use Case**: File generation, large code creation, multi-file projects

## How to Configure

### Via VS Code Settings UI
1. Open Settings (Ctrl+, or Cmd+,)
2. Search for "Code Janitor"
3. Find "Max Tokens" settings
4. Adjust values as needed

### Via settings.json
```json
{
  "codeJanitor.ai.maxTokens.fast": 3072,
  "codeJanitor.ai.maxTokens.heavy": 6144,
  "codeJanitor.ai.maxTokens.create": 12288
}
```

## Use Cases

### 1. Increase Limits for Detailed Responses
If you find responses are being cut off or lack detail:
```json
{
  "codeJanitor.ai.maxTokens.fast": 3072,
  "codeJanitor.ai.maxTokens.heavy": 6144,
  "codeJanitor.ai.maxTokens.create": 12288
}
```

### 2. Decrease Limits to Reduce Costs
If you're using paid APIs and want to minimize costs:
```json
{
  "codeJanitor.ai.maxTokens.fast": 1024,
  "codeJanitor.ai.maxTokens.heavy": 2048,
  "codeJanitor.ai.maxTokens.create": 4096
}
```

### 3. Optimize for Specific Models
Some models perform better with specific token ranges:

**For GPT-4 (high quality, expensive)**:
```json
{
  "codeJanitor.ai.maxTokens.fast": 1536,
  "codeJanitor.ai.maxTokens.heavy": 3072,
  "codeJanitor.ai.maxTokens.create": 6144
}
```

**For Claude (balanced)**:
```json
{
  "codeJanitor.ai.maxTokens.fast": 2048,
  "codeJanitor.ai.maxTokens.heavy": 4096,
  "codeJanitor.ai.maxTokens.create": 8192
}
```

**For Llama 3.1 (fast, local)**:
```json
{
  "codeJanitor.ai.maxTokens.fast": 2560,
  "codeJanitor.ai.maxTokens.heavy": 5120,
  "codeJanitor.ai.maxTokens.create": 10240
}
```

### 4. Balance Speed and Quality
For faster responses with acceptable quality:
```json
{
  "codeJanitor.ai.maxTokens.fast": 1536,
  "codeJanitor.ai.maxTokens.heavy": 3072,
  "codeJanitor.ai.maxTokens.create": 6144
}
```

## Technical Details

### Implementation

#### Configuration Reading (agent.js - getConfig())
```javascript
maxTokens: {
  fast: Math.max(512, Math.min(4096, config.get("maxTokens.fast", 2048))),
  heavy: Math.max(1024, Math.min(8192, config.get("maxTokens.heavy", 4096))),
  create: Math.max(2048, Math.min(16384, config.get("maxTokens.create", 8192)))
}
```

#### Token Limit Application (agent.js - _buildRequestOptions())
```javascript
const baseMaxTokens = isUnlimited 
  ? (config.maxTokens?.create || 8192)
  : mode === "heavy" 
    ? (config.maxTokens?.heavy || 4096)
    : (config.maxTokens?.fast || 2048)
```

### Validation
- **Minimum values** prevent unusably short responses
- **Maximum values** prevent excessive API costs and timeouts
- **Default values** provide sensible starting points
- **Fallback values** ensure operation even if config is missing

### MiniMax M2.7 Optimization
The MiniMax M2.7 model is known to be slow, so it uses reduced token limits regardless of user configuration:
```javascript
const isMinimax = config.model === "minimaxai/minimax-m2.7"
const optimizedMaxTokens = isMinimax 
  ? (mode === "fast" ? 512 : mode === "heavy" ? 2048 : 1024)
  : baseMaxTokens
```

## Benefits

### 1. Flexibility
- Users can adjust limits based on their specific needs
- Different limits for different use cases
- Easy to experiment and find optimal values

### 2. Cost Control
- Reduce token usage to minimize API costs
- Especially important for paid providers (Groq, OpenRouter, Anthropic, NVIDIA)

### 3. Performance Optimization
- Lower limits = faster responses
- Higher limits = more detailed responses
- Users can find the right balance

### 4. Model Compatibility
- Different models have different optimal token ranges
- Users can configure limits to match their model's capabilities

### 5. Backward Compatibility
- Default values match previous hardcoded limits
- Existing users see no change unless they customize
- No breaking changes

## Recommendations

### General Guidelines
1. **Start with defaults**: The default values work well for most use cases
2. **Adjust gradually**: Change limits by 25-50% increments
3. **Monitor quality**: Ensure responses aren't being cut off
4. **Consider costs**: Higher limits = higher API costs
5. **Test different values**: Find what works best for your workflow

### Model-Specific Recommendations

| Provider | Model | Fast | Heavy | Create |
|----------|-------|------|-------|--------|
| Groq | llama-3.1-8b-instant | 2048 | 4096 | 8192 |
| Anthropic | claude-3-5-haiku | 2048 | 4096 | 8192 |
| NVIDIA | meta/llama-3.1-70b | 2560 | 5120 | 10240 |
| OpenRouter | qwen/qwen-2.5-coder | 3072 | 6144 | 12288 |
| Ollama | qwen2.5-coder:1.5b | 1536 | 3072 | 6144 |

### Use Case Recommendations

| Use Case | Fast | Heavy | Create |
|----------|------|-------|--------|
| Quick questions | 1024 | 2048 | 4096 |
| Code review | 2048 | 4096 | 8192 |
| Large projects | 3072 | 6144 | 12288 |
| Cost-sensitive | 1024 | 2048 | 4096 |
| Quality-focused | 3072 | 6144 | 12288 |

## Troubleshooting

### Responses Are Cut Off
**Problem**: AI responses end abruptly or seem incomplete

**Solution**: Increase token limits
```json
{
  "codeJanitor.ai.maxTokens.fast": 3072,
  "codeJanitor.ai.maxTokens.heavy": 6144
}
```

### Responses Are Too Slow
**Problem**: AI takes too long to respond

**Solution**: Decrease token limits
```json
{
  "codeJanitor.ai.maxTokens.fast": 1536,
  "codeJanitor.ai.maxTokens.heavy": 3072
}
```

### API Costs Are Too High
**Problem**: Using too many tokens with paid providers

**Solution**: Reduce token limits
```json
{
  "codeJanitor.ai.maxTokens.fast": 1024,
  "codeJanitor.ai.maxTokens.heavy": 2048,
  "codeJanitor.ai.maxTokens.create": 4096
}
```

### Configuration Not Working
**Problem**: Changes to token limits don't seem to take effect

**Solution**:
1. Reload VS Code window (Ctrl+Shift+P → "Reload Window")
2. Check settings.json for typos
3. Ensure values are within valid ranges
4. Check VS Code output panel for errors

## Future Enhancements

Potential improvements for token limit management:
1. **Per-provider limits**: Different limits for different AI providers
2. **Dynamic adjustment**: Automatically adjust based on response quality
3. **Token usage tracking**: Monitor and report token consumption
4. **Cost estimation**: Show estimated costs before sending requests
5. **Preset profiles**: Quick-switch between "Fast", "Balanced", "Quality" presets
6. **Model-specific defaults**: Automatic optimal limits based on selected model

## Version History
- **1.10.0**: Initial implementation of customizable token limits
- **1.9.5**: Current affairs awareness
- **1.9.4**: Performance optimization (fixed hardcoded token limits)

## Related Documentation
- `FEATURE_ROADMAP.md`: Complete feature roadmap
- `PERFORMANCE_FIX.md`: Token optimization history
- `README.md`: General usage guide

## Feedback
If you have suggestions for improving token limit management, please open an issue on GitHub: https://github.com/Debanshu2005/code-janitor/issues
