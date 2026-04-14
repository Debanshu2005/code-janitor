# URGENT FIX: Commands Not Found - Step by Step Solution

## Current Problem
You're seeing: `command 'codeJanitor.fixCode' not found`

This means the extension is **NOT ACTIVATED** in VS Code.

## Root Cause
The extension needs to be either:
1. Properly installed as a VSIX package, OR
2. Running in Extension Development Host mode

Simply editing the files doesn't activate the extension in your current VS Code window.

---

## SOLUTION 1: Install as VSIX (Recommended for Daily Use)

### Step 1: Package the Extension
```bash
cd d:\CityGrid\my-project\code-janitor
npm run package
```

This creates a `.vsix` file (e.g., `code-janitor-1.2.9.vsix`)

### Step 2: Uninstall Old Version (if installed)
1. Press `Ctrl+Shift+X` to open Extensions panel
2. Search for "Code Janitor"
3. If found, click the gear icon → **Uninstall**
4. Press `Ctrl+Shift+P` → Type "Developer: Reload Window" → Press Enter

### Step 3: Install New VSIX
1. Press `Ctrl+Shift+P`
2. Type "Extensions: Install from VSIX"
3. Navigate to `d:\CityGrid\my-project\code-janitor\`
4. Select the `.vsix` file (e.g., `code-janitor-1.2.9.vsix`)
5. Click "Install"
6. Press `Ctrl+Shift+P` → Type "Developer: Reload Window" → Press Enter

### Step 4: Verify Installation
1. Press `Ctrl+Shift+X` to open Extensions
2. Search for "Code Janitor"
3. Should show as **Installed** and **Enabled**
4. Press `Ctrl+Shift+P` and type "Code Janitor"
5. You should see all 6 commands:
   - Code Janitor: Format Code
   - Code Janitor: Lint Code (ESLint)
   - Code Janitor: Live HTML/React Preview (Unsaved)
   - Code Janitor: Validate Frontend Dependencies
   - Code Janitor: Open AI Chat
   - Code Janitor: Visualize Codebase Graph

### Step 5: Test Commands
```
Alt+D          → Format Code
Alt+L          → Lint Code
Alt+P          → Live Preview
Alt+V          → Validate Frontend
Ctrl+Alt+C     → AI Chat
Ctrl+Alt+G     → Graphify
```

---

## SOLUTION 2: Run in Development Mode (For Testing/Development)

### Step 1: Open Extension Project
```bash
code d:\CityGrid\my-project\code-janitor
```

This opens the extension source code in VS Code.

### Step 2: Launch Extension Development Host
1. In the extension project window, press `F5`
2. OR: Press `Ctrl+Shift+D` → Click "Run Extension" → Press `F5`
3. A new VS Code window opens with title **"[Extension Development Host]"**

### Step 3: Test in Development Host Window
In the **NEW** window (Extension Development Host):
1. Open any project or file
2. Press `Ctrl+Shift+P` → Type "Code Janitor"
3. All commands should appear
4. Test with keybindings: `Alt+D`, `Ctrl+Alt+C`, etc.

### Step 4: Debug (if needed)
In the **ORIGINAL** window (where you pressed F5):
1. Press `Ctrl+Shift+I` to open Developer Tools
2. Go to "Console" tab
3. Look for: "✓ Code Janitor extension activated successfully!"
4. If you see errors, report them

---

## SOLUTION 3: Quick Check - Is Extension Installed?

### Check Current Installation
1. Press `Ctrl+Shift+X` (Extensions panel)
2. Search for "Code Janitor"
3. **If NOT found:** Extension is not installed → Use SOLUTION 1
4. **If found but disabled:** Click "Enable" button
5. **If found and enabled:** Try reloading window

### Force Reload
```
Ctrl+Shift+P → "Developer: Reload Window"
```

---

## Troubleshooting

### Issue: "npm run package" fails

**Error:** `vsce: command not found` or similar

**Fix:**
```bash
cd d:\CityGrid\my-project\code-janitor
npm install
npm run package
```

### Issue: VSIX installation fails

**Error:** "Extension is invalid" or similar

**Fix:**
1. Check if `package.json` is valid JSON:
   ```bash
   node -e "console.log(JSON.parse(require('fs').readFileSync('package.json')))"
   ```
2. If error, fix the JSON syntax
3. Re-run `npm run package`

### Issue: Extension activates but commands still not found

**Check Developer Console:**
1. Press `Ctrl+Shift+I`
2. Look for errors in Console tab
3. Common errors:
   - Module not found → Missing dependency
   - Syntax error → Check extension.js
   - Activation failed → Check activate() function

**Check Output Panel:**
1. Press `Ctrl+Shift+U` (Output panel)
2. Select "Extension Host" from dropdown
3. Look for activation errors

### Issue: F5 doesn't launch Extension Development Host

**Fix:**
1. Make sure you opened the extension folder: `code d:\CityGrid\my-project\code-janitor`
2. Check if `.vscode/launch.json` exists (I just created it)
3. Press `Ctrl+Shift+D` to open Run and Debug panel
4. Select "Run Extension" from dropdown
5. Press F5

---

## Which Solution Should You Use?

### Use SOLUTION 1 (Install VSIX) if:
- ✅ You want to use the extension in your daily work
- ✅ You want it available in all VS Code windows
- ✅ You're done developing/testing

### Use SOLUTION 2 (Development Mode) if:
- ✅ You're actively developing the extension
- ✅ You want to test changes quickly
- ✅ You need to debug with breakpoints
- ✅ You want to see console logs

---

## Expected Result

After following either solution, you should see:

### In Command Palette (Ctrl+Shift+P):
```
Code Janitor: Format Code
Code Janitor: Lint Code (ESLint)
Code Janitor: Live HTML/React Preview (Unsaved)
Code Janitor: Validate Frontend Dependencies
Code Janitor: Open AI Chat
Code Janitor: Visualize Codebase Graph
```

### Keybindings Working:
```
Alt+D          → Formats current file
Alt+L          → Lints JavaScript file
Alt+P          → Opens live preview
Alt+V          → Validates frontend dependencies
Ctrl+Alt+C     → Opens AI chat panel
Ctrl+Alt+G     → Opens Graphify visualization
```

### In Developer Console (Ctrl+Shift+I):
```
✓ Code Janitor extension is activating...
✓ Enhanced Live Preview command registered.
✓ AI Chat command registered.
✓ Graphify command registered.
✓ Code Janitor extension activated successfully!
```

---

## Still Not Working?

If you've tried both solutions and commands are still not found:

1. **Check VS Code version:**
   ```
   Help → About → Version should be >= 1.80.0
   ```

2. **Check Node.js version:**
   ```bash
   node --version
   # Should be >= 18
   ```

3. **Reinstall dependencies:**
   ```bash
   cd d:\CityGrid\my-project\code-janitor
   rm -rf node_modules
   npm install
   npm run package
   ```

4. **Check for conflicting extensions:**
   - Disable all other formatter/linter extensions
   - Reload window
   - Test again

5. **Report the issue with:**
   - VS Code version
   - Node.js version
   - Output from Developer Console (Ctrl+Shift+I)
   - Output from Extension Host (Ctrl+Shift+U → "Extension Host")
   - Steps you followed

---

## Quick Start (TL;DR)

**For Daily Use:**
```bash
cd d:\CityGrid\my-project\code-janitor
npm run package
# Then: Ctrl+Shift+P → "Extensions: Install from VSIX" → Select .vsix file
# Then: Ctrl+Shift+P → "Developer: Reload Window"
```

**For Development:**
```bash
code d:\CityGrid\my-project\code-janitor
# Then: Press F5
# Test in the new "[Extension Development Host]" window
```

---

**Next Step:** Choose SOLUTION 1 or SOLUTION 2 and follow the steps carefully.
