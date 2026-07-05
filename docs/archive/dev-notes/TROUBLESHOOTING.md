# Troubleshooting: Commands Not Found

## Issue
All Code Janitor commands (`codeJanitor.fixCode`, `codeJanitor.lintCode`, `codeJanitor.livePreview`, `codeJanitor.validateFrontend`, `codeJanitor.openChat`, `codeJanitor.openGraphify`) are not found after reloading the extension.

## Root Cause
The extension activation events were not explicitly including the commands, which can cause VS Code to not register them properly on startup.

## Solution Applied
Added explicit activation events to `package.json`:

```json
"activationEvents": [
  "onStartupFinished",
  "onCommand:codeJanitor.fixCode",
  "onCommand:codeJanitor.lintCode",
  "onCommand:codeJanitor.livePreview",
  "onCommand:codeJanitor.validateFrontend",
  "onCommand:codeJanitor.openChat",
  "onCommand:codeJanitor.openGraphify"
]
```

## Steps to Fix

### Option 1: Reload Window (Quick Fix)
1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type "Developer: Reload Window"
3. Press Enter
4. Try the commands again

### Option 2: Reinstall Extension (Recommended)
1. **Uninstall the current extension:**
   - Press `Ctrl+Shift+X` to open Extensions
   - Find "Code Janitor"
   - Click the gear icon → Uninstall
   - Reload VS Code

2. **Repackage the extension:**
   ```bash
   cd d:\CityGrid\my-project\code-janitor
   npm run package
   ```

3. **Install the new VSIX:**
   - Press `Ctrl+Shift+P`
   - Type "Extensions: Install from VSIX"
   - Select the newly created `.vsix` file
   - Reload VS Code

### Option 3: Run in Development Mode
1. Open the extension folder in VS Code:
   ```bash
   code d:\CityGrid\my-project\code-janitor
   ```

2. Press `F5` to launch Extension Development Host

3. In the new window, test the commands:
   - `Ctrl+Shift+P` → "Code Janitor: Format Code"
   - `Ctrl+Shift+P` → "Code Janitor: Open AI Chat"

## Verification

After applying the fix, verify ALL commands work:

1. **Test Format Code:**
   - Open any supported file (.js, .py, .java, .c, .cpp, .html)
   - Press `Alt+D` or run "Code Janitor: Format Code"
   - Should format the file

2. **Test Lint Code:**
   - Open a JavaScript file
   - Press `Alt+L` or run "Code Janitor: Lint Code (ESLint)"
   - Should show linting issues in Problems panel

3. **Test Live Preview:**
   - Open an HTML, React, Markdown, CSS, JSON, SVG, Vue, or Svelte file
   - Press `Alt+P` or run "Code Janitor: Live HTML/React Preview (Unsaved)"
   - Should open live preview panel

4. **Test Frontend Validation:**
   - Open an HTML, CSS, or JS file
   - Press `Alt+V` or run "Code Janitor: Validate Frontend Dependencies"
   - Should validate dependencies

5. **Test AI Chat:**
   - Press `Ctrl+Alt+C` or run "Code Janitor: Open AI Chat"
   - Should open the AI chat panel

6. **Test Graphify:**
   - Press `Ctrl+Alt+G` or run "Code Janitor: Visualize Codebase Graph"
   - Should open the codebase visualization panel

## Debug Commands

If commands still don't work, check the Developer Console:

1. Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac)
2. Go to the "Console" tab
3. Look for errors related to "Code Janitor"
4. Check if you see "✓ Code Janitor extension activated successfully!"

## Common Issues

### Issue: Extension not activating
**Symptom:** No console message "✓ Code Janitor extension activated successfully!"

**Fix:**
- Check if there are syntax errors in extension.js
- Run: `node -c src\extension.js`
- If errors found, fix them and reload

### Issue: Commands registered but not working
**Symptom:** Commands appear in Command Palette but show "command not found"

**Fix:**
- The activation events were missing
- This has been fixed in package.json
- Reinstall the extension (Option 2 above)

### Issue: Keybindings not working
**Symptom:** `Alt+D` or `Ctrl+Alt+C` don't trigger commands

**Fix:**
- Check for keybinding conflicts
- Press `Ctrl+K Ctrl+S` to open Keyboard Shortcuts
- Search for "codeJanitor"
- Verify keybindings are registered

## Files Modified

- `package.json`: Added explicit activation events for commands

## Next Steps

1. Try Option 1 (Reload Window) first
2. If that doesn't work, try Option 2 (Reinstall Extension)
3. If still not working, check Developer Console for errors
4. Report any errors you find

## Contact

If the issue persists, provide:
- VS Code version
- Extension version
- Developer Console errors
- Steps to reproduce
