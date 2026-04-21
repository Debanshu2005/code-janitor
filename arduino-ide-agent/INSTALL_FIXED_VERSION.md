# 🚀 INSTALL FIXED ARDUINO IDE AGENT - Version 1.5.2

## ✅ What's Fixed in This Version

1. **NVIDIA Model Name**: Corrected to `minimaxi/minimax-m2.7` (was incorrectly `nvidia/minimax-m2.7`)
2. **Provider Status Messages**: Now correctly shows "Contacting nvidia..." / "Contacting groq..." etc. based on selected provider

## 📦 Package Location

**File**: `d:\CityGrid\my-project\code-janitor\arduino-ide-agent\code-janitor-arduino-ai-agent-1.5.2.vsix`

**Size**: 122.97 KB  
**Version**: 1.5.2  
**Built**: Just now with all fixes verified

## 🔧 Installation Steps

### Step 1: Uninstall Old Version (IMPORTANT!)

1. Open **Arduino IDE 2.x**
2. Click **Extensions** icon in left sidebar (or press `Ctrl+Shift+X`)
3. Search for "Code Janitor Arduino"
4. Click the **gear icon** ⚙️ next to the extension
5. Select **Uninstall**
6. **Restart Arduino IDE** (close and reopen)

### Step 2: Install New Version

1. Open **Arduino IDE 2.x**
2. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
3. Type: `Extensions: Install from VSIX`
4. Press Enter
5. Navigate to: `d:\CityGrid\my-project\code-janitor\arduino-ide-agent\`
6. Select: `code-janitor-arduino-ai-agent-1.5.2.vsix`
7. Click **Install**
8. **Restart Arduino IDE** (close and reopen)

### Step 3: Verify Installation

1. Open Arduino IDE
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "Code Janitor Arduino"
4. Verify version shows **1.5.2**

## 🧪 Testing the Fixes

### Test 1: NVIDIA Model Name ✅

1. Press `Ctrl+Alt+A` to open Arduino AI Chat
2. In the header, select **"🚀 NVIDIA NIM"** from provider dropdown
3. Check the model dropdown next to it
4. **Expected**: Should show `minimaxi/minimax-m2.7` (NOT `nvidia/minimax-m2.7`)
5. Enter your NVIDIA API key if prompted
6. Send a test message: "Hello"
7. **Expected**: Should work without 404 errors

### Test 2: Provider Status Messages ✅

**Test with NVIDIA:**
1. Select provider: **NVIDIA NIM**
2. Send message: "test"
3. **Expected**: Status should show "Contacting nvidia..."

**Test with Groq:**
1. Select provider: **Groq (cloud)**
2. Send message: "test"
3. **Expected**: Status should show "Contacting groq..."

**Test with OpenRouter:**
1. Select provider: **OpenRouter**
2. Send message: "test"
3. **Expected**: Status should show "Contacting openrouter..."

**Test with Anthropic:**
1. Select provider: **Anthropic (Claude)**
2. Send message: "test"
3. **Expected**: Status should show "Contacting anthropic..."

**Test with Ollama:**
1. Select provider: **Ollama (local)**
2. Send message: "test"
3. **Expected**: Status should show "Contacting ollama..."

## 🔍 Verification Commands

Run these in PowerShell to verify the VSIX contains the fixes:

```powershell
# Check NVIDIA model name in VSIX
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('d:\CityGrid\my-project\code-janitor\arduino-ide-agent\code-janitor-arduino-ai-agent-1.5.2.vsix')
$entry = $zip.Entries | Where-Object { $_.FullName -eq 'extension/src/ai-agent/agent.js' }
$stream = $entry.Open()
$reader = New-Object System.IO.StreamReader($stream)
$content = $reader.ReadToEnd()
$reader.Close()
$stream.Close()
$zip.Dispose()

# Should output: minimaxi/minimax-m2.7
$content -match 'minimaxi/minimax-m2.7'
```

## ⚠️ Troubleshooting

### Issue: Still seeing old behavior after installation

**Solution 1: Clear Extension Cache**
```powershell
# Close Arduino IDE first, then run:
Remove-Item -Recurse -Force "$env:APPDATA\Code\User\globalStorage\Debanshu2005.code-janitor-arduino-ai-agent"
```
Then restart Arduino IDE.

**Solution 2: Hard Reload**
1. Open Arduino IDE
2. Press `Ctrl+Shift+P`
3. Type: `Developer: Reload Window`
4. Press Enter

**Solution 3: Check Developer Console**
1. In Arduino IDE, go to: **Help → Toggle Developer Tools**
2. Check Console tab for errors
3. Look for any messages about the extension loading

### Issue: Extension not showing in Extensions list

**Solution**: Arduino IDE might be caching the old version
1. Close Arduino IDE completely
2. Delete: `%APPDATA%\Code\User\extensions\debanshu2005.code-janitor-arduino-ai-agent-*`
3. Reinstall the VSIX following Step 2 above

### Issue: "Cannot find module" error

**Solution**: The extension path might be incorrect
1. Uninstall the extension
2. Restart Arduino IDE
3. Reinstall from VSIX
4. Restart Arduino IDE again

## 📝 What Changed

### Files Modified:
- `src/ai-agent/agent.js` - Fixed NVIDIA model name and provider status
- `src/ai-agent/chat-panel.html` - Fixed NVIDIA model name in UI
- `package.json` - Fixed NVIDIA model name in config, bumped version to 1.5.2

### Code Changes:

**1. NVIDIA_MODELS constant (agent.js, line 48)**
```javascript
// BEFORE:
"nvidia/minimax-m2.7"

// AFTER:
"minimaxi/minimax-m2.7"  ✅
```

**2. _prepareRuntimeConfig method (agent.js, line 118)**
```javascript
// BEFORE:
return config  // Lost provider field

// AFTER:
return { ...config }  // ✅ Preserves all fields
```

## ✅ Success Checklist

After installation, verify:
- [ ] Extension version shows 1.5.2
- [ ] NVIDIA model dropdown shows `minimaxi/minimax-m2.7`
- [ ] Status messages show correct provider name
- [ ] No 404 errors when using NVIDIA
- [ ] Provider switching works correctly

## 🎉 You're Done!

The extension is now fixed and ready to use. Both issues should be resolved:
- ✅ Correct NVIDIA model name
- ✅ Correct provider status messages

If you still experience issues, check the Troubleshooting section above or open the Developer Console to see detailed error messages.
