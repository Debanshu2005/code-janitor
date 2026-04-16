# Fixes Summary

## Issue 1: NVIDIA showing "Contacting Groq"

**Root Cause**: The status message correctly uses `${runtimeConfig.provider}`, but the provider value itself might not be updating correctly when switching providers.

**Location**: Both `src/ai-agent/agent.js` (line ~1009) and `arduino-ide-agent/src/ai-agent/agent.js` (line ~1009)

**Current Code** (CORRECT):
```javascript
reportStatus?.(`Contacting ${runtimeConfig.provider}...`)
```

**Actual Problem**: The provider switching logic might not be persisting correctly. Check:
1. Is the provider dropdown value being saved to settings?
2. Is `getConfig()` reading the correct provider from settings?
3. Is there a race condition where old config is cached?

**Debug Steps**:
1. Open VS Code Developer Tools (Help → Toggle Developer Tools)
2. Switch to NVIDIA provider
3. Check console logs for: `[CodeJanitor] Request config provider=nvidia`
4. If it shows `provider=groq`, the issue is in provider persistence

**Likely Fix**: The provider is being read from cache instead of fresh config. The Arduino agent has this code that might help:
```javascript
const configProvider = config.get("provider", "ollama")
const stateProvider = this.context
  ? this.context.globalState.get("codeJanitor.ai.provider", "")
  : ""
```

## Issue 2: Microphone Not Working

**Root Cause**: Web Speech API has strict requirements

**Requirements for Speech Recognition**:
1. **HTTPS or localhost** - Required for security
2. **Chromium-based browser** - Only Chrome, Edge, Safari support it (NOT Firefox)
3. **Microphone permissions** - User must grant permission
4. **Internet connection** - Speech recognition uses cloud services

**Current Implementation** (CORRECT):
- Both VS Code and Arduino agents have proper STT initialization
- Error handling is in place
- Mic button shows/hides based on browser support

**Why It Might Not Work**:

### VS Code Extension:
- VS Code webviews use Electron (Chromium-based) ✅
- Runs on localhost context ✅
- **Should work** - If not, check:
  - Microphone permissions in OS settings
  - VS Code has microphone access
  - No other app is using the microphone

### Arduino IDE:
- Arduino IDE 2.x uses Theia (Electron-based) ✅
- Runs on localhost context ✅
- **Should work** - If not, check:
  - Arduino IDE version (needs 2.0+)
  - Microphone permissions
  - Check browser console for errors

**Testing Steps**:
1. Click microphone button (🎤)
2. Check if browser prompts for microphone permission
3. If no prompt appears, check console for errors:
   ```
   Speech recognition not supported
   ```
4. If permission denied:
   ```
   Microphone access denied
   ```

**Manual Test**:
```javascript
// Run in browser console
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  console.log('✅ Speech Recognition supported');
} else {
  console.log('❌ Speech Recognition NOT supported');
}
```

## Issue 3: MiniMax M2.7 Speed Difference

**Root Cause**: VS Code agent does heavy workspace scanning before sending to AI

**VS Code Overhead**:
1. Workspace context preparation (10-30s on large projects)
2. Git status checks
3. Post-edit verification (syntax checks, npm scripts)
4. Longer prompts = slower AI response

**Arduino Agent** (Faster):
- Simpler, no workspace scanning
- No git integration
- No post-edit verification
- Shorter prompts

**Quick Fix for VS Code**:
Type `/fast` in chat to disable heavy context preparation

**Better Fix**:
Switch to faster NVIDIA models:
- `meta/llama-3.1-8b-instruct` (much faster)
- `mistralai/mistral-nemotron` (also faster)

## Verification Checklist

### Provider Display Issue:
- [ ] Check console logs show correct provider
- [ ] Verify settings.json has correct provider value
- [ ] Test provider switching multiple times
- [ ] Check if globalState is overriding config

### Microphone Issue:
- [ ] Verify Web Speech API support in console
- [ ] Check microphone permissions in OS
- [ ] Test in VS Code first (simpler environment)
- [ ] Check for console errors when clicking mic button
- [ ] Verify internet connection (required for speech recognition)

### Performance Issue:
- [ ] Compare prompt lengths between VS Code and Arduino
- [ ] Check if workspace scanning is running
- [ ] Test with `/fast` mode
- [ ] Try faster NVIDIA models

## Additional Notes

**Provider Persistence**: The Arduino agent uses both `config.get()` and `globalState.get()` to handle provider switching. The VS Code agent might need similar logic.

**Microphone Browser Compatibility**:
- ✅ Chrome/Chromium
- ✅ Edge
- ✅ Safari
- ❌ Firefox (no Web Speech API support)

**TTS (Text-to-Speech)** works in all modern browsers including Firefox.
