# Version 1.5.8 - VS Code Crash Fix

## Issue Fixed
VS Code was crashing when entering a Groq API key and trying to chat.

## Root Cause
The `setProvider` message handler and `_persistApiKey` method were not wrapped in try-catch blocks, so any error during API key storage would crash the entire extension host process, taking VS Code down with it.

## Changes Made

### 1. Added try-catch to setProvider handler (chat-panel.js)
- Wrapped the entire setProvider logic in try-catch
- Added error logging
- Sends error message to chat panel instead of crashing
- Added console logs to track the flow

### 2. Added try-catch to _persistApiKey method (chat-panel.js)
- Wrapped API key persistence in try-catch
- Logs errors instead of crashing
- Re-throws error so caller knows it failed

### 3. Version bump to 1.5.8

## How to Use

1. **Reload VS Code** (Ctrl+Shift+P → "Reload Window")
2. **Open Code Janitor chat**
3. **Switch to Groq** (or any cloud provider)
4. **Enter your API key**
5. **If there's an error**, you'll see it in the chat panel instead of VS Code crashing

## Console Logs to Check

When entering an API key, you should see:
```
[ChatPanel] setProvider message received: groq
[ChatPanel] Persisting Groq API key...
[ChatPanel] Persisting API key for groq, length: XX, preview: gsk_xxx...
[ChatPanel] Stored in secrets: codeJanitor.ai.groq.apiKey
[ChatPanel] Verified groq key saved in config: true length: XX
```

If there's an error:
```
[ChatPanel] Error persisting API key for groq: <error message>
[ChatPanel] Error in setProvider: <error message>
```

And the chat panel will show:
```
❌ Failed to switch provider: <error message>
```

## Testing

1. **Test with Ollama** (should work without API key)
2. **Test with Groq** (enter valid API key)
3. **Test with invalid API key** (should show error, not crash)
4. **Check Developer Console** for error logs

## Known Issues

If VS Code still crashes, it might be due to:
1. **Corrupted VS Code secrets storage** - Try deleting `%APPDATA%\Code\User\globalStorage\storage.json`
2. **Corrupted settings.json** - Already fixed in previous version
3. **Extension conflict** - Disable other extensions and test

## Rollback

If this version causes issues, revert to 1.5.7 by:
1. Checking out the previous commit
2. Reloading VS Code
