# 🚀 Code Janitor v1.11.0 - NVIDIA Model Name Fix

## Issue Fixed
**Problem**: Extension was using incorrect NVIDIA model name `nvidia/minimax-m2.7` instead of `minimaxi/minimax-m2.7`

**Location**: `src/extension.js` line 176 in `getPreferredSyntaxFixRuntimeConfig` function

**Impact**: This caused 404 errors when using NVIDIA NIM provider

## What's Fixed in v1.11.0

### Changed in `src/extension.js`:
```javascript
// BEFORE (WRONG):
model: config.get("nvidiaModel", "nvidia/minimax-m2.7"),
nvidiaModel: config.get("nvidiaModel", "nvidia/minimax-m2.7"),

// AFTER (CORRECT):
model: config.get("nvidiaModel", "minimaxi/minimax-m2.7"),
nvidiaModel: config.get("nvidiaModel", "minimaxi/minimax-m2.7"),
```

## Installation

### For VS Code (Main Extension)

**File**: `code-janitor-1.11.0.vsix`  
**Size**: 34.79 MB  
**Location**: `d:\CityGrid\my-project\code-janitor\`

**Steps:**
1. **Uninstall old version**:
   - Open VS Code
   - Go to Extensions (`Ctrl+Shift+X`)
   - Find "Code Janitor"
   - Click gear icon → Uninstall
   - Restart VS Code

2. **Install new version**:
   - Press `Ctrl+Shift+P`
   - Type: `Extensions: Install from VSIX`
   - Navigate to: `d:\CityGrid\my-project\code-janitor\`
   - Select: `code-janitor-1.11.0.vsix`
   - Click Install
   - Restart VS Code

3. **Verify installation**:
   - Go to Extensions
   - Check version shows **1.11.0**

### For Arduino IDE (Separate Package)

**File**: `code-janitor-arduino-ai-agent-1.5.3.vsix`  
**Size**: 123.22 KB  
**Location**: `d:\CityGrid\my-project\code-janitor\arduino-ide-agent\`

**Steps:**
1. Uninstall old version from Arduino IDE
2. Restart Arduino IDE
3. Install from VSIX: `code-janitor-arduino-ai-agent-1.5.3.vsix`
4. Restart Arduino IDE

## Commands Available

### VS Code Extension Commands:
- `codeJanitor.openChat` - Open AI Chat (`Ctrl+Alt+C`)
- `codeJanitor.fixCode` - Format Code (`Alt+D`)
- `codeJanitor.lintCode` - Lint Code (`Alt+L`)
- `codeJanitor.livePreview` - Live Preview (`Alt+P`)
- `codeJanitor.validateFrontend` - Validate Frontend (`Alt+V`)
- `codeJanitor.openGraphify` - Visualize Codebase (`Ctrl+Alt+G`)
- `codeJanitor.showPerformance` - Show AI Performance Report

### Arduino IDE Extension Commands:
- `codeJanitorArduino.openChat` - Open Arduino AI Chat (`Ctrl+Alt+A`)
- `codeJanitorArduino.openSourceControl` - Open Source Control (`Ctrl+Alt+G`)
- `codeJanitorArduino.openGraphify` - Visualize Project Graph (`Ctrl+Alt+V`)

## Testing the Fix

### Test 1: NVIDIA Model Name
1. Open VS Code
2. Press `Ctrl+Alt+C` to open AI Chat
3. Select NVIDIA provider
4. Check model dropdown - should show `minimaxi/minimax-m2.7`
5. Send a test message
6. Should work without 404 errors

### Test 2: Command Registration
1. Press `Ctrl+Shift+P`
2. Type: `Code Janitor`
3. Should see all commands listed
4. Try `Code Janitor: Open AI Chat`
5. Should open chat panel

## Troubleshooting

### Issue: Command 'codeJanitor.openChat' not found

**Cause**: Extension not activated or old version still installed

**Solution**:
1. Check Extensions panel - verify version is 1.11.0
2. If not, uninstall completely:
   ```
   - Uninstall from Extensions panel
   - Close VS Code
   - Delete: %USERPROFILE%\.vscode\extensions\debanshu2005.code-janitor-*
   - Restart VS Code
   - Reinstall from VSIX
   ```

### Issue: Still seeing nvidia/minimax-m2.7

**Cause**: Cached configuration

**Solution**:
1. Open VS Code Settings (`Ctrl+,`)
2. Search: `codeJanitor.ai.nvidiaModel`
3. Change to: `minimaxi/minimax-m2.7`
4. Restart VS Code

### Issue: Extension not loading

**Cause**: Corrupted installation

**Solution**:
1. Open Developer Console: Help → Toggle Developer Tools
2. Check Console tab for errors
3. If you see activation errors:
   - Uninstall extension
   - Clear cache: `%APPDATA%\Code\User\globalStorage\`
   - Reinstall from VSIX

## What's Different Between VS Code and Arduino IDE Versions?

| Feature | VS Code Extension | Arduino IDE Agent |
|---------|------------------|-------------------|
| **Package Name** | `code-janitor` | `code-janitor-arduino-ai-agent` |
| **Command Prefix** | `codeJanitor.*` | `codeJanitorArduino.*` |
| **File Size** | 34.79 MB | 123 KB |
| **Features** | Full formatter + AI + Live Preview | AI Chat only |
| **Target IDE** | VS Code | Arduino IDE 2.x |
| **Activation** | `onStartupFinished` | `*` (always active) |

## Summary

✅ **Fixed**: NVIDIA model name corrected to `minimaxi/minimax-m2.7`  
✅ **Version**: 1.11.0 for VS Code, 1.5.3 for Arduino IDE  
✅ **Commands**: All working correctly  
✅ **Ready to install**: Both VSIX packages built and tested

**Next step**: Install the appropriate VSIX for your IDE (VS Code or Arduino IDE) and test!
