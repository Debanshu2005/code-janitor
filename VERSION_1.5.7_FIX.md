# Version 1.5.7 - AUTOMATIC 401 ERROR FIX

## What This Version Does

This version **automatically detects and fixes** the 401 error by:

1. **On Chat Panel Open**: Checks if you're using a cloud provider (Groq/OpenRouter/Anthropic/NVIDIA) without an API key
2. **Automatic Switch**: If no API key is found, it automatically switches to Ollama (local, no key needed)
3. **Before Every Request**: Double-checks the provider and API key, forces Ollama if needed
4. **Logs Everything**: Shows exactly what's happening in the console

## How to Use

### Step 1: Reload VS Code
- Press `F5` or `Ctrl+Shift+P` → "Reload Window"

### Step 2: Open Code Janitor Chat
- Press `Ctrl+Alt+C` or use Command Palette → "Code Janitor: Open AI Chat"

### Step 3: Watch the Console (Optional)
- Help → Toggle Developer Tools → Console tab
- You should see:
  ```
  [ChatPanel] No Groq API key found, forcing provider to ollama
  ```
  OR
  ```
  [ChatPanel] CRITICAL: Groq selected but no API key! Forcing to ollama
  ```

### Step 4: Send a Message
- Type "hi" and press Enter
- Should work without 401 error!

## What You'll See

### In the Chat Panel:
- Status: "Preparing fast reply..."
- Status: "Contacting ollama..." (NOT "Contacting groq...")
- Response from the AI

### In the Console:
```
[ChatPanel] Base config from agent: {provider: 'ollama', ...}
[Agent] Building request for provider: ollama
```

## If You Still Get 401 Error

This means Ollama is not running. Fix:

1. Open a terminal
2. Run: `ollama serve`
3. You should see: "Ollama is running on http://localhost:11434"
4. Try sending "hi" again

## If You Want to Use Groq/OpenRouter/etc.

1. Get an API key from the provider:
   - Groq: https://console.groq.com/keys
   - OpenRouter: https://openrouter.ai/keys
   - Anthropic: https://console.anthropic.com/settings/keys
   - NVIDIA: https://build.nvidia.com/

2. In Code Janitor chat:
   - Use the provider dropdown to select your provider
   - Enter the API key when prompted
   - Wait for "Provider switched to..." message

3. The extension will now use that provider with your API key

## Technical Details

### Changes Made:

1. **chat-panel.js - show() method**:
   - Added check on panel open
   - Forces provider to ollama if cloud provider has no API key

2. **chat-panel.js - _getEffectiveAiConfig() method**:
   - Added check before every request
   - Forces provider to ollama if cloud provider has no API key
   - Updates VS Code settings to persist the change

3. **Logging**:
   - Shows "CRITICAL: <provider> selected but no API key! Forcing to ollama"
   - Shows effective provider being used

### Why This Works:

The 401 error happens because:
- Your VS Code settings have `provider: "groq"`
- But you don't have a Groq API key
- So it sends an empty Authorization header → 401 Unauthorized

This fix:
- Detects the missing API key
- Automatically switches to Ollama (which doesn't need a key)
- Updates your settings so it persists

## Version History

- **1.5.4**: Reverted default provider to ollama
- **1.5.5**: Added debug logging
- **1.5.6**: Added /ollama command
- **1.5.7**: **AUTOMATIC FIX** - No manual intervention needed!
