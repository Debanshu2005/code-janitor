# Diagnostic Steps for 401 Error

## Issue Summary
- Getting 401 errors on all providers (Ollama, Groq, OpenRouter, etc.)
- Default provider should be "ollama" but showing as "groq"

## Root Cause Analysis

The 401 error has TWO possible causes:

### 1. VS Code Settings Override
Your VS Code user settings may have overridden the default provider from "ollama" to "groq".

**To check:**
1. Open VS Code Settings (Ctrl+,)
2. Search for: `codeJanitor.ai.provider`
3. Check what value is shown
4. If it says "groq", change it to "ollama"
5. Reload VS Code

### 2. Invalid or Missing API Keys
If using cloud providers (Groq, OpenRouter, Anthropic, NVIDIA), the API key must be valid.

## Step-by-Step Fix

### Step 1: Reset to Ollama (Local, No API Key Needed)

1. **Open VS Code Settings** (File → Preferences → Settings or Ctrl+,)

2. **Search for**: `codeJanitor.ai.provider`

3. **Set to**: `ollama`

4. **Verify Ollama is running**:
   - Open terminal
   - Run: `ollama serve`
   - Should see: "Ollama is running on http://localhost:11434"

5. **Test with /ping command**:
   - Open Code Janitor AI Chat
   - Type: `/ping`
   - Should see: "✅ Ollama is running at http://localhost:11434"

### Step 2: If Using Cloud Providers

If you want to use Groq/OpenRouter/Anthropic/NVIDIA:

1. **Get a valid API key** from the provider:
   - Groq: https://console.groq.com/keys
   - OpenRouter: https://openrouter.ai/keys
   - Anthropic: https://console.anthropic.com/settings/keys
   - NVIDIA: https://build.nvidia.com/

2. **Copy the ENTIRE key** (including any prefix like `gsk_` for Groq)

3. **In Code Janitor chat**:
   - Switch to the provider (dropdown at top)
   - Paste the API key when prompted
   - Wait for "Provider switched to..." message

4. **Verify the key was saved**:
   - Open Developer Tools (Help → Toggle Developer Tools)
   - Go to Console tab
   - Look for logs:
     ```
     [ChatPanel] Persisting API key for groq, length: XX, preview: gsk_xxxxxx...
     [ChatPanel] Verified groq key saved in config: true length: XX
     ```

5. **Send a test message**:
   - Type: "hello"
   - Check console for:
     ```
     [Agent] Groq request - API key: gsk_xxxxxx... (length: XX)
     ```
   - If it shows "(EMPTY!)", the key wasn't saved correctly

### Step 3: Clear Old Settings (Nuclear Option)

If nothing works, reset all Code Janitor settings:

1. Open VS Code Settings (Ctrl+,)
2. Click the "Open Settings (JSON)" icon (top right)
3. Find and DELETE all lines starting with `"codeJanitor.ai.`
4. Save the file
5. Reload VS Code
6. Open Code Janitor chat - it will use defaults (ollama)

## Expected Behavior

### With Ollama (Default)
- ✅ No API key needed
- ✅ Works offline
- ✅ Free
- ⚠️ Requires Ollama installed and running (`ollama serve`)
- ⚠️ Slower than cloud providers

### With Cloud Providers (Groq/OpenRouter/etc.)
- ⚠️ Requires valid API key
- ✅ Faster than local
- ✅ No local installation needed
- ⚠️ Requires internet connection
- ⚠️ May have rate limits or costs

## Debug Logs to Share

If still getting 401 errors, share these console logs:

1. **When entering API key**:
   ```
   [ChatPanel] Persisting API key for <provider>, length: XX, preview: xxx...
   [ChatPanel] Verified <provider> key saved: true/false
   ```

2. **When sending message**:
   ```
   [ChatPanel] Base config from agent: { provider: "xxx", hasGroqKey: true/false }
   [ChatPanel] Retrieved API keys: { groq: "xxx..." }
   [Agent] Building request for provider: xxx
   [Agent] API key status: { groq: "xxx... (length: XX)" }
   ```

3. **The actual error message** from the chat panel

## Common Mistakes

1. ❌ **Copying API key with extra spaces or quotes** → Use `_sanitizeApiKey()` (already implemented)
2. ❌ **Using expired or revoked API key** → Generate a new key
3. ❌ **Ollama not running** → Run `ollama serve` in terminal
4. ❌ **VS Code settings override** → Check settings.json for `codeJanitor.ai.provider`
5. ❌ **Wrong provider selected** → Dropdown should match your API key provider
