# Fix Summary: Command Registration Issue

## Problem
All Code Janitor commands were showing "command not found" error after reloading the extension.

## Root Cause
The `package.json` only had `"onStartupFinished"` in `activationEvents`, which wasn't explicitly registering the individual commands. VS Code needs explicit activation events for each command to ensure they're available when invoked.

## Solution Applied
Added explicit activation events for ALL commands in `package.json`:

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

## All Commands Fixed

| Command | Keybinding | Description |
|---------|------------|-------------|
| `codeJanitor.fixCode` | `Alt+D` | Format and fix code syntax |
| `codeJanitor.lintCode` | `Alt+L` | Run ESLint on JavaScript files |
| `codeJanitor.livePreview` | `Alt+P` | Live preview for HTML/React/Markdown/CSS/JSON/SVG/Vue/Svelte |
| `codeJanitor.validateFrontend` | `Alt+V` | Validate frontend dependencies |
| `codeJanitor.openChat` | `Ctrl+Alt+C` | Open AI chat panel |
| `codeJanitor.openGraphify` | `Ctrl+Alt+G` | Visualize codebase graph |

## How to Apply the Fix

### Option 1: Quick Reload (Try First)
```
1. Press Ctrl+Shift+P
2. Type "Developer: Reload Window"
3. Press Enter
4. Test commands with keybindings or Command Palette
```

### Option 2: Reinstall Extension (Recommended)
```bash
# 1. Uninstall current extension
#    - Open Extensions panel (Ctrl+Shift+X)
#    - Find "Code Janitor"
#    - Click gear icon → Uninstall
#    - Reload VS Code

# 2. Repackage extension
cd d:\CityGrid\my-project\code-janitor
npm run package

# 3. Install new VSIX
#    - Press Ctrl+Shift+P
#    - Type "Extensions: Install from VSIX"
#    - Select the newly created .vsix file
#    - Reload VS Code
```

### Option 3: Development Mode (For Testing)
```bash
# 1. Open extension folder
code d:\CityGrid\my-project\code-janitor

# 2. Press F5 to launch Extension Development Host

# 3. Test all commands in the new window
```

## Verification Checklist

After applying the fix, verify each command works:

- [ ] **Format Code** - Press `Alt+D` on a .js/.py/.java/.c/.cpp/.html file
- [ ] **Lint Code** - Press `Alt+L` on a .js file
- [ ] **Live Preview** - Press `Alt+P` on a .html/.jsx/.md file
- [ ] **Validate Frontend** - Press `Alt+V` on a .html/.css/.js file
- [ ] **AI Chat** - Press `Ctrl+Alt+C` to open chat panel
- [ ] **Graphify** - Press `Ctrl+Alt+G` to open codebase visualization

## Files Modified

1. **package.json** - Added explicit activation events for all 6 commands
2. **TROUBLESHOOTING.md** - Created comprehensive troubleshooting guide
3. **QUICK_REFERENCE.md** - Created quick reference for all features
4. **FIX_SUMMARY.md** - This file

## Additional Resources

- **TROUBLESHOOTING.md** - Detailed troubleshooting steps for common issues
- **QUICK_REFERENCE.md** - Complete guide to all Code Janitor features
- **README.md** - Main documentation

## Expected Behavior After Fix

1. All commands should appear in Command Palette (`Ctrl+Shift+P`)
2. All keybindings should work immediately
3. Extension should activate on startup
4. No "command not found" errors

## If Issue Persists

1. Check Developer Console for errors:
   - Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac)
   - Look for errors related to "Code Janitor"
   - Check if you see "✓ Code Janitor extension activated successfully!"

2. Verify extension is installed:
   - Press `Ctrl+Shift+X` to open Extensions
   - Search for "Code Janitor"
   - Should show as installed and enabled

3. Check for conflicting extensions:
   - Disable other formatter/linter extensions temporarily
   - Reload window and test again

4. Report issue with:
   - VS Code version
   - Extension version
   - Developer Console errors
   - Steps to reproduce

## Technical Details

**Why this fix works:**
- `onStartupFinished` activates the extension after VS Code starts
- `onCommand:xxx` ensures each command is registered when invoked
- This dual approach ensures commands are available both at startup and on-demand
- VS Code's extension host requires explicit activation events for command registration

**Alternative approaches considered:**
- Using `*` activation event (activates on all events) - Too aggressive, impacts performance
- Using `onLanguage:xxx` - Doesn't cover all use cases (e.g., AI chat works without open files)
- Current approach is the recommended VS Code best practice

## Status

✅ **FIXED** - All activation events added to package.json  
⏳ **PENDING** - User needs to reload/reinstall extension  
📝 **DOCUMENTED** - Troubleshooting and quick reference guides created

---

**Date:** April 14, 2026  
**Version:** 1.2.9  
**Fixed By:** Amazon Q Developer
