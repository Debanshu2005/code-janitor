# Code Janitor - Quick Reference Guide

## All Commands & Keybindings

### 1. Format Code
**Command:** `Code Janitor: Format Code`  
**Keybinding:** `Alt+D`  
**Supported Files:** .js, .jsx, .py, .java, .c, .cpp, .h, .ino, .html  
**Description:** Formats and fixes syntax errors in your code using rule-based and AI-powered fixes.

**Usage:**
```
1. Open a supported file
2. Press Alt+D
3. Code will be automatically formatted and fixed
```

---

### 2. Lint Code (ESLint)
**Command:** `Code Janitor: Lint Code (ESLint)`  
**Keybinding:** `Alt+L`  
**Supported Files:** .js, .jsx  
**Description:** Runs ESLint on JavaScript files and shows issues in the Problems panel.

**Usage:**
```
1. Open a JavaScript file
2. Press Alt+L
3. Check the Problems panel for linting issues
```

---

### 3. Live Preview
**Command:** `Code Janitor: Live HTML/React Preview (Unsaved)`  
**Keybinding:** `Alt+P`  
**Supported Files:** .html, .jsx, .md, .css, .json, .svg, .vue, .svelte  
**Description:** Opens a live preview panel that updates in real-time as you type (no need to save).

**Usage:**
```
1. Open an HTML, React, Markdown, CSS, JSON, SVG, Vue, or Svelte file
2. Press Alt+P
3. Preview panel opens on the right
4. Edit your code and see changes instantly
```

**Features:**
- Real-time preview without saving
- Supports React JSX with Babel transpilation
- Markdown rendering
- CSS live preview
- JSON formatting
- SVG visualization
- Vue and Svelte component preview

---

### 4. Validate Frontend Dependencies
**Command:** `Code Janitor: Validate Frontend Dependencies`  
**Keybinding:** `Alt+V` (only when HTML/CSS/JS file is open)  
**Supported Files:** .html, .css, .js, .jsx, .tsx  
**Description:** Validates that all referenced files (CSS, JS, images) exist and offers to create missing files.

**Usage:**
```
1. Open an HTML, CSS, or JS file
2. Press Alt+V
3. If missing dependencies are found, choose to create them
```

**What it checks:**
- CSS files referenced in `<link>` tags
- JavaScript files referenced in `<script>` tags
- Image files referenced in `<img>` tags
- External resources

---

### 5. Open AI Chat
**Command:** `Code Janitor: Open AI Chat`  
**Keybinding:** `Ctrl+Alt+C` (Windows/Linux) or `Cmd+Alt+C` (Mac)  
**Description:** Opens the AI chat panel for code assistance, debugging, refactoring, and more.

**Usage:**
```
1. Press Ctrl+Alt+C
2. AI chat panel opens
3. Ask questions, request code edits, debug issues, etc.
```

**Supported AI Providers:**
- **Ollama** (local, free) - Default: qwen2.5-coder:1.5b
- **Groq** (cloud, free) - Fast inference with Llama models
- **OpenRouter** (cloud, paid) - 100+ models including Qwen, DeepSeek, Gemini
- **Anthropic** (cloud, paid) - Claude Opus, Sonnet, Haiku
- **NVIDIA NIM** (cloud, paid) - Minimax, Nemotron models

**Chat Modes:**
- `/fast` - Quick responses with minimal context
- `/heavy` - Deep analysis with full workspace context
- `/scan` - Scan and analyze entire workspace

**Quick Actions:**
- Explain code
- Review code
- Fix bugs
- Refactor code
- Generate tests
- Syntax scan

**Special Commands:**
- `Show me the codebase graph` - Opens Graphify visualization
- `Scan workspace` - Analyzes entire codebase
- `Fix syntax errors` - Runs syntax check on all files

---

### 6. Visualize Codebase Graph
**Command:** `Code Janitor: Visualize Codebase Graph`  
**Keybinding:** `Ctrl+Alt+G` (Windows/Linux) or `Cmd+Alt+G` (Mac)  
**Description:** Opens an interactive graph visualization of your codebase structure.

**Usage:**
```
1. Press Ctrl+Alt+G
2. Graphify panel opens with interactive graph
3. Double-click nodes to open files
4. Explore dependencies and architecture
```

**Features:**
- Interactive node-based visualization
- Hierarchical clustering by directory
- God nodes detection (highly connected files)
- Architecture insights
- Auto-generates GRAPH_REPORT.md
- Creates agent config files for Claude, Cursor, Gemini, etc.

**Graph Actions:**
- Double-click node → Open file
- Drag nodes → Rearrange layout
- Zoom in/out → Mouse wheel
- Pan → Click and drag background

---

## Configuration Settings

Access settings: `Ctrl+,` → Search "Code Janitor"

### Auto-Correction Settings
```json
{
  "codeJanitor.autoCorrection.enabled": false,  // Real-time auto-correction
  "codeJanitor.autoCorrection.delay": 500,      // Delay before auto-fix (ms)
  "codeJanitor.autoCorrection.languages": [     // Supported languages
    "python", "javascript", "java", "c", "cpp", "html"
  ]
}
```

### Auto-Fix on Save
```json
{
  "codeJanitor.autoFixOnSave.enabled": false  // Auto-fix when saving files
}
```

### AI Settings
```json
{
  "codeJanitor.ai.enabled": true,
  "codeJanitor.ai.provider": "ollama",  // ollama, groq, openrouter, anthropic, nvidia
  "codeJanitor.ai.model": "qwen2.5-coder:1.5b",
  "codeJanitor.ai.ollamaUrl": "http://localhost:11434",
  "codeJanitor.ai.timeout": 90000
}
```

### API Keys (for cloud providers)
```json
{
  "codeJanitor.ai.groqApiKey": "",        // Get at https://console.groq.com
  "codeJanitor.ai.openrouterApiKey": "",  // Get at https://openrouter.ai
  "codeJanitor.ai.anthropicApiKey": "",   // Get at https://console.anthropic.com
  "codeJanitor.ai.nvidiaApiKey": ""       // Get at https://build.nvidia.com
}
```

---

## Supported Languages

### Code Formatting & Fixing
- **Python** (.py) - Syntax fixes, indentation, print statements, boolean values
- **JavaScript** (.js, .jsx) - ESLint integration, formatting
- **Java** (.java) - Syntax validation, formatting
- **C/C++** (.c, .cpp, .h, .ino) - Embedded C fixer, Arduino support
- **HTML** (.html) - Tag validation, dependency checking, formatting

### Live Preview
- **HTML** (.html) - Full HTML preview with CSS/JS
- **React** (.jsx) - JSX transpilation with Babel
- **Markdown** (.md) - Rendered markdown preview
- **CSS** (.css) - Live CSS preview
- **JSON** (.json) - Formatted JSON view
- **SVG** (.svg) - SVG visualization
- **Vue** (.vue) - Vue component preview
- **Svelte** (.svelte) - Svelte component preview

### Linting
- **JavaScript** (.js, .jsx) - ESLint with configurable rules

---

## Workflow Examples

### Example 1: Fix Python Syntax Errors
```
1. Open Python file with syntax errors
2. Press Alt+D
3. Code Janitor applies:
   - Rule-based fixes (missing colons, print statements)
   - AI fixes (if Ollama/cloud provider is configured)
   - Formatting
4. File is automatically saved with fixes
```

### Example 2: Live HTML Development
```
1. Create new HTML file
2. Press Alt+P to open live preview
3. Type HTML code
4. See changes instantly in preview panel
5. Press Alt+V to validate dependencies
6. Create missing CSS/JS files if needed
```

### Example 3: AI-Assisted Refactoring
```
1. Open file you want to refactor
2. Press Ctrl+Alt+C to open AI chat
3. Type: "Refactor this code to use async/await"
4. AI analyzes code and suggests changes
5. Review and apply changes
6. AI can run post-edit verification (lint, typecheck, build, test)
```

### Example 4: Codebase Exploration
```
1. Press Ctrl+Alt+G to open Graphify
2. Explore interactive graph visualization
3. Identify god nodes (highly connected files)
4. Double-click nodes to open files
5. Read GRAPH_REPORT.md for architecture insights
```

### Example 5: Syntax Scan Entire Project
```
1. Press Ctrl+Alt+C to open AI chat
2. Click "Syntax Scan" action chip
3. AI scans all .js, .jsx, .ts, .tsx, .py, .java files
4. Reports syntax errors with file paths
5. Fix errors using Alt+D on each file
```

---

## Troubleshooting

### Commands Not Found
If you see "command 'codeJanitor.xxx' not found":
1. Press `Ctrl+Shift+P` → "Developer: Reload Window"
2. If still not working, reinstall the extension:
   ```bash
   cd d:\CityGrid\my-project\code-janitor
   npm run package
   ```
3. Install the new .vsix file via Command Palette

### AI Chat Not Working
- **Ollama:** Make sure Ollama is running (`ollama serve`)
- **Groq/OpenRouter/Anthropic/NVIDIA:** Add API key in settings
- Check Developer Console (`Ctrl+Shift+I`) for errors

### Live Preview Not Updating
- Make sure you're editing the file (not just viewing)
- Check if the file type is supported
- Reload the preview panel

### Format Code Not Working
- Check if file type is supported
- Look for syntax errors in Developer Console
- Try disabling auto-fix on save if it conflicts

---

## Tips & Tricks

1. **Use Fast Mode for Quick Questions:** Type `/fast` in AI chat for quick responses
2. **Use Heavy Mode for Complex Edits:** Type `/heavy` for deep workspace analysis
3. **Combine Features:** Use Live Preview + AI Chat together for rapid development
4. **Keyboard Shortcuts:** Learn the keybindings to speed up your workflow
5. **Graphify for Onboarding:** Use Graphify when joining a new project to understand architecture
6. **Syntax Scan Before Commit:** Run syntax scan to catch errors before committing

---

## Resources

- **Website:** https://code-janitor-web.vercel.app
- **GitHub:** https://github.com/Debanshu2005/code-janitor
- **Issues:** https://github.com/Debanshu2005/code-janitor/issues
- **License:** MIT

---

## Version

Current Version: **1.2.9**

Last Updated: April 2026
