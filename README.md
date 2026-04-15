# Code Janitor
![VS Code](https://img.shields.io/badge/VSCode-%3E%3D1.80-blue?logo=visual-studio-code)
![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-green)

## Introduction
Code Janitor is a VS Code extension designed to enhance the coding experience by providing tools for formatting, repairing, and validating code. It supports multiple programming languages including Python, JavaScript, Java, C/C++, Arduino, HTML, CSS, JSON, Markdown, SVG, Vue, Svelte, and more.

Website for the extension: https://code-janitor-web.vercel.app/

### Key Features

1. **Code Formatting**: Code Janitor can format your code according to the specified style guide or rules.
2. **Manual Fixing**: You can run manual fixing from the Command Palette with `Code Janitor: Format Code`.
3. **Auto-Correction**: Apply real-time auto-correction while typing for supported languages.
4. **Live Preview**: Preview HTML, React, Markdown, CSS, JSON, SVG, Vue, Svelte and more in a live webview.
5. **Frontend Dependency Validation**: Validate frontend dependencies for HTML, CSS, and JavaScript files.
6. **AI Chat Panel**: Open an AI chat panel to interact with the Code Janitor AI assistant.
7. **Self-Healing Performance**: Automatically detects slow AI responses and optimizes settings for better performance.
8. **Self-Diagnosing Errors**: When FILE operations fail, automatically detects the cause, explains what's blocking it, and attempts to fix it.
9. **Workspace Scanning and Knowledge Graph Integration**: Scan your workspace and integrate with a knowledge graph to provide better code suggestions and insights.
10. **Graphify**: Visualize your codebase as a graph to better understand the relationships between different components.

### Install
To install Code Janitor, follow these steps:

1. Open Visual Studio Code.
2. Press `Ctrl + Shift + P` (Windows/Linux) or `Cmd + Shift + P` (Mac).
3. Type `Install Extension` and select it from the list.
4. Search for `Code Janitor` in the search bar and install it.

### Usage

**Keyboard Shortcuts:**

- `Alt+D` - Format Code (applies code formatting and fixes)
- `Ctrl+Alt+C` - Open AI Chat Panel
- `Alt+P` - Live Preview
- `Alt+L` - Lint Code (ESLint)
- `Alt+V` - Validate Frontend Dependencies
- `Ctrl+Alt+G` - Visualize Codebase Graph (Graphify)

**Commands:**

1. **Format Code**: Use `Alt+D` or Command Palette → `Code Janitor: Format Code`
2. **AI Chat Panel**: Use `Ctrl+Alt+C` or Command Palette → `Code Janitor: Open AI Chat`
3. **Live Preview**: Use `Alt+P` or Command Palette → `Code Janitor: Live Preview`
4. **Graphify**: Use `Ctrl+Alt+G` or Command Palette → `Code Janitor: Graphify`
`Code Janitor: Live Preview`

   <img width="1920" height="1020" alt="Screenshot 2026-04-06 205439" src="https://github.com/user-attachments/assets/5620f974-e99d-4447-85e2-5c2ba09a14e6" />

**AI Chat Features:**
- Syntax checking for JS, TS, Python, Java, C/C++, JSON, and HTML
- Code generation and refactoring
- Bug fixing and debugging assistance
- Multiple AI providers: Ollama (local), Groq (fast, free), OpenRouter, Anthropic, NVIDIA
- **Self-Healing**: Automatically detects slow models and switches to faster alternatives

4. **AI Chat Panel**: Use `Ctrl+Alt+C` or Command Palette → `Code Janitor: Open AI Chat`
   <img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/64887636-95ef-40c2-a41f-9dfa876eba93" />

5. **Performance Monitoring**: View AI performance metrics with `Code Janitor: Show AI Performance Report`
   - Track response times
   - Monitor model performance
   - View auto-heal history
   - Get optimization recommendations
   



# Code Janitor Arduino AI Agent

`Code Janitor Arduino AI Agent` is a standalone VSIX package that brings the Code Janitor chat assistant into Arduino IDE 2.x and other compatible Theia / VS Code extension hosts.

Website for the package: https://code-janitor-web.vercel.app/

This package is focused on AI chat and guided edits. It does not include the full command set from the main `Code Janitor` VS Code extension.

## Features

- Opens a dedicated Arduino chat panel with `Code Janitor Arduino: Open Arduino AI Chat`
- Supports `ollama`, `groq`, `openrouter`, and `anthropic`
- Scans the workspace for relevant context before answering
- Can generate structured `FILE`, `MKDIR`, and `CMD` actions with safety checks
- Preserves the last selected model per provider
- Includes quick actions such as explain, review, fix, refactor, tests, and syntax scan
- Source control. Use git to collaborate with co-workers.

<img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/7360f607-ec15-4be3-ac74-ea9d70d4485d" />


## Package Layout

- `src/extension.js`: Arduino extension activation entry
- `src/ai-agent/chat-panel.js`: webview bridge, command handling, and settings sync
- `src/ai-agent/agent.js`: prompt building, provider requests, parsing, and action safety
- `src/ai-agent/chat-panel.html`: chat UI

## Commands

- `Code Janitor Arduino: Open Arduino AI Chat`

Default keybinding:

- `Ctrl+Alt+A` on Windows/Linux




### Contributing

If you're interested in contributing to Code Janitor, feel free to check out the [GitHub repository](https://github.com/Debanshu2005/code-janitor) and submit a pull request.

## License

Code Janitor is licensed under the MIT License. For more information, see the [LICENSE](LICENSE) file.
