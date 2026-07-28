# Code Janitor
![VS Code](https://img.shields.io/badge/VSCode-%3E%3D1.80-blue?logo=visual-studio-code)
![Arduino IDE](https://img.shields.io/badge/Arduino%20IDE-2.x-00979D?logo=arduino)
![Node](https://img.shields.io/badge/Node-%3E%3D20-brightgreen?logo=node.js)
![CI](https://github.com/Debanshu2005/code-janitor/actions/workflows/ci.yml/badge.svg)
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
4. **Live Preview**: Preview HTML, multi-file static sites, package-based web apps, React, Markdown, CSS, JSON, SVG, Vue, Svelte and more
5. **Frontend Dependency Validation**: Validate frontend dependencies for HTML, CSS, and JavaScript files
6. **AI Chat Panel**: Interact with the Code Janitor AI assistant
7. **Self-Healing Performance**: Automatically detects slow AI responses and optimizes settings
8. **Self-Diagnosing Errors**: Automatically detects FILE operation failures and attempts to fix them
9. **Workspace Scanning**: Scan your workspace and integrate with knowledge graph for better code suggestions (significantly reduces AI token usage by providing targeted context instead of full file contents)
10. **Graphify**: Visualize your codebase as a graph to understand component relationships
11. **Edge Case Testing**: Automatically generate comprehensive edge cases for testing functions and classes
12. **Test Execution & Reporting**: Execute tests with detailed reports and coverage analysis
13. **Documentation Generation**: Automatically generate README, API docs, and contributing guides
14. **TODO List Management**: Track and manage TODO comments across your codebase with an interactive panel
15. **Shared Workspace Memory**: Persistent workspace context mirrored to `workspacememory.md` plus a machine-readable `workspace.json` manifest for multi-agent handoff
16. **Project Planner**: Time-based todo list with progress tracking, deadline monitoring, and stagnation rescue

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


  <img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/3c3721f1-9311-4c3a-8e0e-202660fd03a5" />


   
4. **AI Chat Panel**: Use `Ctrl+Alt+C` or Command Palette → `Code Janitor: Open AI Chat`

   
 <img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/755b2bd3-c9eb-4e1b-8333-871ebb340e82" />

   
5. **Graphify**: Use `Ctrl+Alt+G` or Command Palette → `Code Janitor: Graphify`
   
<img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/fb60120c-3574-43b9-85d3-aee1d3ca57d9" />


### AI Chat Features

- **Smart Code Editing**: PATCH format for targeted edits (1-20 lines), FILE format for larger changes
- **Pre-Edit Diagnostics**: Automatic file status checks before making changes
  - Git status detection for uncommitted changes (with automatic git repository detection)
  - Syntax validation for code files
  - File existence and readability checks
  - Smart path resolution to prevent targeting wrong files
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
- **Improved File Operations**: Enhanced FILE action processing with detailed logging and double-apply prevention
- **Performance Monitoring**: View AI performance metrics with `Code Janitor: Show AI Performance Report`
   - Track response times
   - Monitor model performance
   - View auto-heal history
   - Get optimization recommendations
   - Automatic detection of degraded models with fallback suggestions
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
- **TODO List Management**: Interactive TODO tracking panel
  - Scans workspace for TODO, FIXME, HACK, NOTE comments
  - Click to jump to TODO location in code
  - Filter by file, priority, or keyword
  - Mark TODOs as complete or add new ones
- **Shared Workspace Memory**: Persistent context ledger for multi-agent collaboration
  - Template-based or AI-rewritten workspace summaries
  - Mirrored to `workspacememory.md` at workspace root
  - Generates `workspace.json` at workspace root with structured repo metadata, file inventory, package details, Git status, and Graphify summaries
  - Configurable preferred provider
  - Enables seamless handoff between agents without rescanning
- **Project Planner**: AI-powered project management with progress tracking
  - Toggle planner mode with outcome, deadline, and stagnation settings
  - Generates time-based todo lists from project outcomes
  - Pinned progress bar in chat header
  - Automatic rescue briefs when progress stalls
  - Provider-backed plan regeneration without silent code edits
- **Provider-Specific Testing**: Configure dedicated AI providers for testing workflows
  - Separate provider for edge-case generation
  - Dedicated provider for test report review notes
  - Supports all configured providers including custom ones

### Live Preview

Code Janitor supports both static-file previews and dev-server previews.

For plain HTML projects, open the entry HTML file and run `Code Janitor: Live Preview`. CJ rewrites local resources so split files load correctly from the webview, including:

- CSS links
- JavaScript scripts
- images and `srcset`
- media sources, posters, icons, manifests, and preload links
- root-relative assets such as `/assets/logo.png`

CJ also refreshes the preview when related files are saved, so changes in sibling CSS, JS, or asset files can appear without reopening the preview.

For package-based apps such as Next.js, Vite, React, Vue, Svelte, Astro, Parcel, and Webpack projects, open `package.json` or a source file and run `Code Janitor: Live Preview`. CJ finds the nearest `package.json`, picks a `dev`, `start`, `serve`, or `preview` script, starts it in a VS Code terminal, and opens the local URL in VS Code's Simple Browser editor tab.

Common inferred dev-server ports:

- Vite: `http://localhost:5173`
- Next.js / Create React App: `http://localhost:3000`
- Astro: `http://localhost:4321`
- Parcel: `http://localhost:1234`
- Webpack: `http://localhost:8080`

If the Simple Browser opens before the dev server is ready, wait for the terminal to show that the server is ready, then refresh the browser tab. If dependencies are missing, run `npm install`, `pnpm install`, or `yarn install` first.

### AI Provider Rate Limiting

Code Janitor includes client-side rate limiting for cloud AI providers. It is designed for reliability rather than speed: normal single requests are sent immediately, while bursty retries are queued to avoid provider `429 Too Many Requests` errors.

By default, rate limiting applies to Groq, OpenRouter, Anthropic, NVIDIA NIM, and custom OpenAI-compatible providers. Local Ollama requests are not throttled.

Default settings:

```json
{
  "codeJanitor.ai.rateLimit.enabled": true,
  "codeJanitor.ai.rateLimit.requestsPerMinute": 20,
  "codeJanitor.ai.rateLimit.burst": 3,
  "codeJanitor.ai.rateLimit.maxWaitMs": 120000
}
```

- `enabled`: Turn cloud AI throttling on or off.
- `requestsPerMinute`: Maximum sustained request rate per provider.
- `burst`: Number of immediate requests allowed before CJ starts spacing calls out.
- `maxWaitMs`: Maximum time CJ will wait for a rate-limit slot before showing an error. Use `0` to wait without a cap.

CJ also honors provider cooldown headers such as `Retry-After` and `x-ratelimit-reset` after a `429` response. If you use a local OpenAI-compatible server as a custom provider, increase these limits or disable rate limiting for faster local iteration.

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
- **VS Code Marketplace**: [Code Janitor](https://marketplace.visualstudio.com/items?itemName=Debanshu2005.code-janitor)
- **Issues**: https://github.com/Debanshu2005/code-janitor/issues
