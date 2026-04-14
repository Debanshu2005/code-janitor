# URGENT FIX: Provider Stuck on Groq

## The Problem
Your VS Code settings have `"codeJanitor.ai.provider": "groq"` hardcoded, which overrides everything.

## Quick Fix (Choose ONE):

### Option 1: Use the /ollama Command (EASIEST)

1. **Reload VS Code** (press F5 or Ctrl+Shift+P → "Reload Window")
2. Open Code Janitor AI Chat
3. Type: `/ollama`
4. Press Enter
5. Wait for "Provider forced to Ollama. Reloading..."
6. Try sending "hi" again

### Option 2: Edit Settings Manually

1. Press `Ctrl+Shift+P` (Command Palette)
2. Type: "Preferences: Open User Settings (JSON)"
3. Press Enter
4. Look for this line:
   ```json
   "codeJanitor.ai.provider": "groq",
   ```
5. Change it to:
   ```json
   "codeJanitor.ai.provider": "ollama",
   ```
6. Save the file (Ctrl+S)
7. Reload VS Code (Ctrl+Shift+P → "Reload Window")
8. Try sending "hi" again

### Option 3: Delete the Setting (Let it use default)

1. Press `Ctrl+Shift+P` (Command Palette)
2. Type: "Preferences: Open User Settings (JSON)"
3. Press Enter
4. Look for this line:
   ```json
   "codeJanitor.ai.provider": "groq",
   ```
5. **DELETE the entire line** (including the comma)
6. Save the file (Ctrl+S)
7. Reload VS Code (Ctrl+Shift+P → "Reload Window")
8. Try sending "hi" again

## How to Verify It Worked

After the fix, send "hi" in the chat and check the console logs:

**Before (WRONG):**
```
[ChatPanel] Base config from agent: {provider: 'groq', ...}
[Agent] Groq request - API key: (EMPTY!)
```

**After (CORRECT):**
```
[ChatPanel] Base config from agent: {provider: 'ollama', ...}
[Agent] Building request for provider: ollama
```

## Why This Happened

VS Code has THREE levels of settings:
1. **Default** (from package.json) → "ollama"
2. **User Settings** (your settings.json) → "groq" ← THIS IS OVERRIDING
3. **Workspace Settings** (workspace .vscode/settings.json)

Your User Settings have `provider: "groq"` which overrides the default "ollama".

## After the Fix

Once you're on Ollama:
- ✅ No API key needed
- ✅ Works offline
- ✅ Free
- ✅ No 401 errors

If you want to use Groq later:
1. Get API key from https://console.groq.com/keys
2. Use the dropdown in chat to switch to Groq
3. Enter the API key when prompted
