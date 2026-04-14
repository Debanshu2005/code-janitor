# Version 1.5.5 - Debug Logging for 401 Errors

## Changes Made

### 1. Enhanced API Key Logging (chat-panel.js)
- Added detailed logging in `_getEffectiveAiConfig()` to show:
  - Base config from agent (which keys are present)
  - Retrieved API keys from secrets/settings (with preview)
  - Effective config being sent to agent
- Added detailed logging in `_persistApiKey()` to show:
  - Key length and preview when saving
  - Secret storage confirmation
  - Config save verification

### 2. Enhanced Request Logging (agent.js)
- Added logging in `_buildRequestOptions()` to show:
  - Current provider
  - API key status for all providers (with preview and length)
- Added logging in Groq request builder to show:
  - Exact API key being used in Authorization header

### 3. Created Diagnostic Guide
- Created `DIAGNOSTIC_STEPS.md` with comprehensive troubleshooting steps
- Covers both Ollama (local) and cloud provider (Groq/OpenRouter/etc.) setup
- Includes common mistakes and how to fix them

## How to Use

1. **Reload the extension** (F5 or reload window)

2. **Open Developer Tools**:
   - Help → Toggle Developer Tools
   - Go to Console tab

3. **Try to use the AI**:
   - Open Code Janitor chat
   - Switch provider or enter API key
   - Send a message

4. **Check the console logs** for:
   - `[ChatPanel]` logs showing API key storage/retrieval
   - `[Agent]` logs showing what key is being used in requests
   - Any error messages

## Expected Console Output

### When Entering API Key:
```
[ChatPanel] Persisting API key for groq, length: 56, preview: gsk_abc123...
[ChatPanel] Stored in secrets: codeJanitor.ai.groq.apiKey
[ChatPanel] Verified groq key saved in config: true length: 56
```

### When Sending Message:
```
[ChatPanel] Base config from agent: { provider: "groq", hasGroqKey: true }
[ChatPanel] Retrieved API keys: { groq: "gsk_abc123..." }
[ChatPanel] Effective config for provider groq: { hasKey: true }
[Agent] Building request for provider: groq
[Agent] API key status: { groq: "gsk_abc123... (length: 56)" }
[Agent] Groq request - API key: gsk_abc123... (length: 56)
```

## Troubleshooting

### If logs show "(empty)" or "(EMPTY!)":
- API key is not being saved or retrieved correctly
- Check VS Code settings: `codeJanitor.ai.groqApiKey` (or other provider)
- Try the "Nuclear Option" in DIAGNOSTIC_STEPS.md

### If logs show the key but still get 401:
- The API key itself is invalid or expired
- Generate a new key from the provider's dashboard
- Make sure you're copying the ENTIRE key (including prefix like `gsk_`)

### If using Ollama and getting 401:
- This should NEVER happen - Ollama doesn't use authentication
- Check if Ollama is actually running: `ollama serve`
- Check if you're actually using Ollama (not Groq): Look for `provider: "ollama"` in logs
- VS Code settings may have overridden the default provider

## Files Modified

1. `src/ai-agent/chat-panel.js`:
   - Enhanced `_getEffectiveAiConfig()` with detailed logging
   - Enhanced `_persistApiKey()` with detailed logging

2. `src/ai-agent/agent.js`:
   - Enhanced `_buildRequestOptions()` with API key status logging
   - Enhanced Groq request builder with exact key logging

3. `package.json`:
   - Version bumped to 1.5.5

4. `DIAGNOSTIC_STEPS.md`:
   - New file with comprehensive troubleshooting guide
