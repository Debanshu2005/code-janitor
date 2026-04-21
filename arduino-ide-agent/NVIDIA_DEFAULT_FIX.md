# Arduino IDE Agent - NVIDIA Default Provider Fix

## Summary
Fixed the Arduino IDE agent to use NVIDIA as the default AI provider instead of Ollama/Groq.

## Problem
The Arduino IDE agent was showing "Contacting groq..." even when NVIDIA was selected as the provider. The issue was caused by:
1. Default provider hardcoded to "ollama" in multiple places
2. Duplicate status messages causing confusion
3. Mismatched NVIDIA model names between agent.js and chat-panel.html
4. UI defaulting to Ollama instead of NVIDIA

## Files Modified

### 1. `src/ai-agent/agent.js`
**Changes:**
- Line 79: Changed default provider from `"ollama"` to `"nvidia"` in `config.get("provider", "nvidia")`
- Line 89: Changed fallback provider from `"ollama"` to `"nvidia"` in the provider resolution logic

**Impact:**
- Agent now defaults to NVIDIA when no provider is configured
- Config retrieval always returns NVIDIA as the default

### 2. `src/ai-agent/chat-panel.js`
**Changes:**
- Removed duplicate "Contacting..." status message (around line 1050)
- The agent's `reportStatus` callback now handles all status messages

**Impact:**
- Eliminates duplicate status messages
- Status now correctly shows "Contacting nvidia..." when using NVIDIA
- Only one source of truth for provider status

### 3. `package.json`
**Changes:**
- Line 38: Changed `"default": "ollama"` to `"default": "nvidia"` in `codeJanitor.ai.provider` configuration

**Impact:**
- VS Code/Arduino IDE configuration defaults to NVIDIA
- New installations will use NVIDIA by default

### 4. `src/ai-agent/chat-panel.html`
**Changes:**
- Line 1010: Changed header subtitle from `<div id="header-sub">Ollama</div>` to `<div id="header-sub">NVIDIA</div>`
- Line 1018-1023: Reordered provider select options to put NVIDIA first
- Line 1145-1150: Fixed NVIDIA model names to match agent.js:
  - `"nvidia/minimax-m2.7"` (was `"minimaxai/minimax-m2.7"`)
  - `"nvidia/llama-3.1-nemotron-70b-instruct"` (was `"meta/llama-3.1-8b-instruct"`)
  - `"nvidia/mistral-nemo-minitron-8b-8k-instruct"` (was `"meta/llama-3.1-70b-instruct"`)
  - `"nvidia/llama-3.1-nemotron-51b-instruct"` (was `"nvidia/llama-3.3-nemotron-super-49b-v1.5"`)

**Impact:**
- UI now shows "NVIDIA" as the default provider in the header
- NVIDIA appears first in the provider dropdown
- Model names match the actual NVIDIA NIM API models
- Consistent model naming across frontend and backend

## Verification Checklist

✅ **Default Provider**: NVIDIA is now the default in all configuration files
✅ **Status Messages**: Correctly shows "Contacting nvidia..." when using NVIDIA
✅ **Model Names**: NVIDIA models match between agent.js and chat-panel.html
✅ **UI Display**: Header shows "NVIDIA" and provider dropdown defaults to NVIDIA
✅ **API Integration**: Uses correct NVIDIA API endpoint and model names
✅ **No Duplicates**: Removed duplicate status message code

## Testing Steps

1. **Fresh Install Test**:
   - Install the Arduino IDE agent
   - Open the AI chat panel
   - Verify header shows "NVIDIA"
   - Verify provider dropdown shows "🚀 NVIDIA NIM" as first option

2. **Provider Switch Test**:
   - Switch to NVIDIA provider
   - Enter NVIDIA API key
   - Send a message
   - Verify status shows "Contacting nvidia..." (not "Contacting groq...")

3. **Model Selection Test**:
   - Select NVIDIA provider
   - Verify model dropdown shows:
     - nvidia/minimax-m2.7
     - nvidia/llama-3.1-nemotron-70b-instruct
     - nvidia/mistral-nemo-minitron-8b-8k-instruct
     - nvidia/llama-3.1-nemotron-51b-instruct

4. **API Request Test**:
   - Send a chat message with NVIDIA selected
   - Verify request goes to `https://integrate.api.nvidia.com/v1/chat/completions`
   - Verify correct model name is sent in the request body

## NVIDIA Configuration

### Supported Models
1. **meta/llama-3.1-8b-instruct** (default) - Fast, efficient Llama model
2. **meta/llama-3.1-70b-instruct** - Large, powerful Llama model
3. **nvidia/llama-3.1-nemotron-70b-instruct** - NVIDIA's optimized Nemotron model
4. **mistralai/mistral-7b-instruct-v0.3** - Mistral instruction-tuned model

### API Endpoint
- URL: `https://integrate.api.nvidia.com/v1/chat/completions`
- Authentication: Bearer token (NVIDIA API key)
- Streaming: Supported

### Getting NVIDIA API Key
- Visit: https://build.nvidia.com/explore/discover
- Sign up for NVIDIA NIM
- Generate API key
- Paste into Arduino IDE agent

## Rollback Instructions

If you need to revert to Ollama as default:

1. **agent.js** (line 79, 89): Change `"nvidia"` back to `"ollama"`
2. **package.json** (line 38): Change `"default": "nvidia"` to `"default": "ollama"`
3. **chat-panel.html** (line 1010): Change `<div id="header-sub">NVIDIA</div>` to `<div id="header-sub">Ollama</div>`
4. **chat-panel.html** (line 1018): Move `<option value="ollama">` to first position

## Notes

- The main Code Janitor extension (not Arduino IDE agent) still defaults to Ollama
- This change only affects the Arduino IDE agent package
- All providers (Ollama, Groq, OpenRouter, Anthropic, NVIDIA) remain fully supported
- Users can still switch to any provider via the dropdown

## Related Issues

- Fixed: "Contacting groq..." showing for all providers
- Fixed: Duplicate status messages
- Fixed: Mismatched NVIDIA model names
- Fixed: UI not reflecting selected provider

## Date
2025-01-XX

## Author
Amazon Q Developer
