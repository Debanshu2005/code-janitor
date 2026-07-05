# NVIDIA NIM Integration for Code Janitor

## Overview
NVIDIA NIM (NVIDIA Inference Microservices) has been successfully integrated into Code Janitor VS Code extension with full API key persistence support.

## What Was Added

### 1. Configuration (package.json)
- Added `nvidia` as a provider option in `codeJanitor.ai.provider`
- Added `codeJanitor.ai.nvidiaApiKey` configuration for API key storage
- Default model set to `nvidia/minimax-m2.7`

### 2. Backend Integration (agent.js)
- Added NVIDIA NIM API endpoint: `https://integrate.api.nvidia.com/v1/chat/completions`
- Implemented OpenAI-compatible streaming API support
- Added default model selection for NVIDIA provider
- Integrated with existing multi-provider architecture

### 3. API Key Persistence (chat-panel.js)
- Added NVIDIA to API key persistence system (uses VS Code secrets storage)
- Added NVIDIA models list: minimax-m2.7, llama-3.1-nemotron-70b-instruct, mistral-nemo-minitron-8b-8k-instruct, llama-3.1-nemotron-51b-instruct
- Implemented key restoration on extension reload
- Added NVIDIA to provider state tracking

### 4. UI Integration (chat-panel.html)
- Added "🚀 NVIDIA NIM" option to provider dropdown
- Added NVIDIA models to client-side model list
- Integrated API key input with "Get nvidia key" link pointing to https://build.nvidia.com/explore/discover
- Added NVIDIA key state tracking in UI

## How to Use

### Step 1: Get NVIDIA API Key
1. Visit https://build.nvidia.com/explore/discover
2. Sign up or log in
3. Generate an API key

### Step 2: Configure Code Janitor
Open VS Code settings and configure:

```json
{
  "codeJanitor.ai.provider": "nvidia",
  "codeJanitor.ai.nvidiaApiKey": "YOUR_API_KEY_HERE",
  "codeJanitor.ai.model": "nvidia/minimax-m2.7"
}
```

Or use the UI:
1. Open Code Janitor AI Chat (`Ctrl+Alt+C`)
2. Select "🚀 NVIDIA NIM" from provider dropdown
3. Paste your API key in the input field
4. Click "Save"
5. Select your preferred model from the model dropdown

### Step 3: Use It
- **AI Chat**: `Ctrl+Alt+C` to open chat panel
- **Alt+D**: AI-powered syntax fixing with multi-stage pipeline
- **Action Chips**: Quick actions like "Check syntax", "Fix issues", "Refactor"

## Available NVIDIA Models
- `nvidia/minimax-m2.7` (default - the model you linked)
- `nvidia/llama-3.1-nemotron-70b-instruct`
- `nvidia/mistral-nemo-minitron-8b-8k-instruct`
- `nvidia/llama-3.1-nemotron-51b-instruct`

You can add more models by editing the `MODELS_BY_PROVIDER.nvidia` array in `chat-panel.js`.

## API Key Persistence
Unlike basic settings storage, Code Janitor now uses VS Code's secure secrets storage for API keys:
- Keys are stored encrypted in VS Code's secret storage
- Keys persist across VS Code restarts
- Keys are automatically restored when you reopen the extension
- Keys are synced with VS Code settings for backup

This matches the behavior of other cloud providers (Groq, OpenRouter, Anthropic).

## Technical Details

### API Endpoint
```
POST https://integrate.api.nvidia.com/v1/chat/completions
```

### Request Format (OpenAI-compatible)
```json
{
  "model": "nvidia/minimax-m2.7",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "stream": true,
  "temperature": 0.05,
  "max_tokens": 8192
}
```

### Response Format
Server-Sent Events (SSE) with OpenAI-compatible format:
```
data: {"choices":[{"delta":{"content":"token"}}]}
```

## Files Modified
1. `package.json` - Added provider and API key config
2. `src/ai-agent/agent.js` - Added NVIDIA request handling
3. `src/ai-agent/chat-panel.js` - Added API key persistence and model management
4. `src/ai-agent/chat-panel.html` - Added UI support

## Testing
After making changes:
1. Reload VS Code: `Ctrl+Shift+P` → "Developer: Reload Window"
2. Open AI Chat: `Ctrl+Alt+C`
3. Select NVIDIA NIM provider
4. Enter API key and save
5. Test with a simple query like "Explain what this file does"

## Comparison with Arduino IDE Extension
The Arduino IDE extension you mentioned likely stores API keys in workspace settings or global state without encryption. Code Janitor's implementation is more secure:
- Uses VS Code's encrypted secrets storage
- Automatically syncs across devices with Settings Sync
- Persists across extension updates
- Follows VS Code security best practices

## Next Steps
If you want to add more NVIDIA models:
1. Check available models at https://build.nvidia.com/explore/discover
2. Add model IDs to `MODELS_BY_PROVIDER.nvidia` in `chat-panel.js`
3. Reload VS Code

Enjoy using NVIDIA NIM with Code Janitor! 🚀
