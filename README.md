# Code Janitor
![VS Code](https://img.shields.io/badge/VSCode-%3E%3D1.80-blue?logo=visual-studio-code)
![Arduino IDE](https://img.shields.io/badge/Arduino%20IDE-2.x-00979D?logo=arduino)
![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-green)

## Introduction
Code Janitor is a powerful extension available for both **VS Code** and **Arduino IDE 2.x** designed to enhance your coding experience with AI-powered tools for formatting, repairing, validating, and understanding code. It supports multiple programming languages including Python, JavaScript, Java, C/C++, Arduino, HTML, CSS, JSON, Markdown, SVG, Vue, Svelte, and more.

Website: https://code-janitor-web.vercel.app/

---

## CLI Mode

Code Janitor also ships with a local CLI for batch cleanup outside the extension UI.

### Local Usage

```bash
node src/cli.js
node src/cli.js src --check
```

### Install As a Command

```bash
npm install
npm link

code-janitor . --check
code-janitor src/app.js
```

### CLI Options

- `--check` report files that would change without writing them
- `--write` apply fixes to disk (default)
- `--json` print the final report as JSON
- `--help` show usage information
- `--version` print the CLI version

Supported targets: one file or one directory. Supported extensions currently include JavaScript/TypeScript, Python, C/C++/Arduino, Java, and HTML.

---

## 🚀 VS Code Extension

### Key Features

1. **Code Formatting**: Format your code according to specified style guides or rules
2. **Manual Fixing**: Run manual fixing from Command Palette with `Code Janitor: Format Code`
3. **Auto-Correction**: Apply real-time auto-correction while typing for supported languages
4. **Live Preview**: Preview HTML, React, Markdown, CSS, JSON, SVG, Vue, Svelte and more in a live webview
5. **Frontend Dependency Validation**: Validate frontend dependencies for HTML, CSS, and JavaScript files
6. **AI Chat Panel**: Interact with the Code Janitor AI assistant
7. **Self-Healing Performance**: Automatically detects slow AI responses and optimizes settings
8. **Self-Diagnosing Errors**: Automatically detects FILE operation failures and attempts to fix them
9. **Workspace Scanning**: Scan your workspace and integrate with knowledge graph for better code suggestions
10. **Graphify**: Visualize your codebase as a graph to understand component relationships
11. **Edge Case Testing**: Automatically generate comprehensive edge cases for testing functions and classes
12. **Test Execution & Reporting**: Execute tests with detailed reports and coverage analysis
13. **Documentation Generation**: Automatically generate README, API docs, and contributing guides

### Installation

1. Open Visual Studio Code
2. Press `Ctrl + Shift + P` (Windows/Linux) or `Cmd + Shift + P` (Mac)
3. Type `Install Extension` and select it from the list
4. Search for `Code Janitor` in the search bar and install it

### Keyboard Shortcuts

- `Alt+D` - Format Code (applies code formatting and fixes)
- `Ctrl+Alt+C` - Open AI Chat Panel
- `Alt+P` - Live Preview
- `Alt+L` - Lint Code (ESLint)
- `Alt+V` - Validate Frontend Dependencies
- `Alt+B` - Beautify Code (advanced formatting)
- `Ctrl+Alt+G` - Visualize Codebase Graph (Graphify)

### Commands

1. **Format Code**: Use `Alt+D` or Command Palette → `Code Janitor: Format Code`
2. **AI Chat Panel**: Use `Ctrl+Alt+C` or Command Palette → `Code Janitor: Open AI Chat`
3. **Live Preview**: Use `Alt+P` or Command Palette → `Code Janitor: Live Preview`


   <img width="1920" height="1020" alt="Screenshot 2026-04-06 205439" src="https://github.com/user-attachments/assets/5620f974-e99d-4447-85e2-5c2ba09a14e6" />

   
4. **AI Chat Panel**: Use `Ctrl+Alt+C` or Command Palette → `Code Janitor: Open AI Chat`

   
   <img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/64887636-95ef-40c2-a41f-9dfa876eba93" />

   
5. **Graphify**: Use `Ctrl+Alt+G` or Command Palette → `Code Janitor: Graphify`
   
   <img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/2e7276ec-4fdf-4745-8fe3-83da20377be6" />

### AI Chat Features

- **Smart Code Editing**: PATCH format for targeted edits (1-20 lines), FILE format for larger changes
- **Pre-Edit Diagnostics**: Automatic file status checks before making changes
  - Git status detection for uncommitted changes
  - Syntax validation for code files
  - File existence and readability checks
- **Post-Edit Verification**: Automatic validation after code changes
  - Syntax checking for Python, Java, JavaScript/TypeScript
  - npm script execution (lint, typecheck, build, test)
  - Comprehensive error reporting
- **Security Features**:
  - Malicious content detection and flagging
  - End-to-end encryption for API communications
  - Secure credential storage
  - Command validation and sandboxing
- **Expanded Command Support**: 13 git commands, package managers (yarn, pnpm, pip), build tools (tsc, mvn, gradle, cargo, go, dotnet), testing frameworks (pytest, unittest)
- Syntax checking for JS, TS, Python, Java, C/C++, JSON, and HTML
- Code generation and refactoring with production-grade quality
- Bug fixing and debugging assistance
- Multiple AI providers: Ollama (local), Groq (fast, free), OpenRouter, Anthropic, NVIDIA
- **Web Search**: Search the web with DuckDuckGo (no API key required)
- **YouTube Search**: Search and watch YouTube videos directly in chat (no API key required)
  - Unlimited free searches
  - Videos embed and play inline
  - Powered by DuckDuckGo
- **Self-Healing**: Automatically detects slow models and switches to faster alternatives
- **Self-Diagnosing Errors**: Automatically detects FILE operation failures and attempts to fix them
- **Performance Monitoring**: View AI performance metrics with `Code Janitor: Show AI Performance Report`
   - Track response times
   - Monitor model performance
   - View auto-heal history
   - Get optimization recommendations
- **Edge Case Testing**: Generate comprehensive edge cases for functions and classes
  - Automatic boundary value analysis
  - Security test cases (XSS, SQL injection)
  - Multiple language support (JavaScript, Python, Java)
  - Test code generation in Jest, pytest, JUnit formats
- **Test Execution & Reporting**: Execute tests with detailed analysis
  - Framework auto-detection (Jest, Mocha, pytest, JUnit)
  - Comprehensive test reports with success rates
  - Edge case coverage tracking
  - Markdown and JSON report formats
- **Documentation Generation**: Automatically generate project documentation
  - README with features, installation, usage
  - API documentation for classes and functions
  - Contributing guides with best practices
  - Full documentation suite generation

For detailed information about testing and documentation features, see [TESTING_AND_DOCUMENTATION.md](TESTING_AND_DOCUMENTATION.md).

---

## 🤖 Arduino IDE Extension

### Code Janitor Arduino AI Agent

`Code Janitor Arduino AI Agent` is a standalone extension that brings the Code Janitor AI assistant into **Arduino IDE 2.x** and other compatible Theia / VS Code extension hosts.

This package is focused on AI chat, guided edits, and Arduino-specific features. It does not include the full command set from the main VS Code extension.

### Arduino IDE Features

- **AI Chat Panel**: Dedicated Arduino chat panel with `Code Janitor Arduino: Open Arduino AI Chat`
- **Smart Code Editing**: PATCH format for targeted edits, FILE format for complete rewrites
- **Pre-Edit & Post-Edit Checks**: Automatic validation before and after code changes
- **Multiple AI Providers**: Supports Ollama (local), Groq (fast, free), OpenRouter, Anthropic, and NVIDIA
- **Workspace Scanning**: Scans workspace for relevant context before answering
- **Structured Actions**: Generate `FILE`, `PATCH`, `MKDIR`, and `CMD` actions with safety checks
- **Model Persistence**: Preserves the last selected model per provider
- **Quick Actions**: Explain, review, fix, refactor, tests, and syntax scan
- **Source Control**: Built-in Git integration to collaborate with co-workers
  - View commit history with push status indicators
  - Stage, commit, push, and pull changes
  - Branch management and conflict resolution
  - Visual diff viewer
- **Web & YouTube Search**: Search the web and YouTube directly from chat
- **Mermaid Diagrams**: Generate and render flowcharts, sequence diagrams, and more
- **Session Management**: Multiple chat sessions with auto-titling and history compaction

### Installation (Arduino IDE)

1. Download the `.vsix` file from the releases
2. Open Arduino IDE 2.x
3. Go to File → Preferences → Additional Boards Manager URLs
4. Install the extension via the Extensions panel

Or install manually:
```bash
code --install-extension code-janitor-arduino-x.x.x.vsix
```

### Arduino IDE Commands

- `Code Janitor Arduino: Open Arduino AI Chat` - Open the AI chat panel
- `Code Janitor Arduino: Open Source Control` - Open Git panel

### Default Keybindings (Arduino IDE)

- `Ctrl+Alt+A` (Windows/Linux) - Open Arduino AI Chat
- `Ctrl+Alt+G` (Windows/Linux) - Open Source Control

### Arduino IDE Screenshot

<img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/7360f607-ec15-4be3-ac74-ea9d70d4485d" />

### Package Structure

```
arduino-ide-agent/
├── src/
│   ├── extension.js              # Extension activation entry
│   ├── ai-agent/
│   │   ├── chat-panel.js         # Webview bridge, command handling
│   │   ├── agent.js              # Prompt building, provider requests
│   │   └── chat-panel.html       # Chat UI
│   └── source-control/
│       ├── git-panel.js          # Git operations and UI logic
│       └── git-panel.html        # Source control UI
├── package.json                  # Extension manifest
└── README.md
```

---

## 🤝 Contributing

If you're interested in contributing to Code Janitor, feel free to check out the [GitHub repository](https://github.com/Debanshu2005/code-janitor) and submit a pull request.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/Debanshu2005/code-janitor.git
cd code-janitor

# Install dependencies
npm install

# For Arduino IDE extension
cd arduino-ide-agent
npm install
```

## 📄 License

Code Janitor is licensed under the MIT License. For more information, see the [LICENSE](LICENSE) file.

---

## 🔗 Links

- **Website**: https://code-janitor-web.vercel.app/
- **GitHub**: https://github.com/Debanshu2005/code-janitor
- **VS Code Marketplace**: [Code Janitor](https://marketplace.visualstudio.com/items?itemName=your-publisher.code-janitor)
- **Issues**: https://github.com/Debanshu2005/code-janitor/issues
