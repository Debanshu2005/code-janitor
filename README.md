# Code Janitor

![VS Code](https://img.shields.io/badge/VSCode-%3E%3D1.80-blue?logo=visual-studio-code)
![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-green)
![Version](https://img.shields.io/badge/Version-0.9.9-orange)

Code Janitor is a VS Code extension for fixing and formatting code with a mix of rule-based repair, formatting tools, and optional AI-powered assistance via Ollama, Groq, OpenRouter, or Anthropic.

> 📖 **[Full Setup Guide & Documentation → https://code-janitor-web.vercel.app](https://code-janitor-web.vercel.app)**

<img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/eca83cbb-b276-4e00-a332-f64a204a85f7" />

## Features

- Format and repair Python, JavaScript, Java, C/C++, Arduino, and HTML files.
- Run manual fixing from the Command Palette with `Code Janitor: Format Code`.
- Apply real-time auto-correction while typing for supported languages.
- Preview HTML, React, Markdown, CSS, JSON, SVG, Vue, Svelte and more in a live webview.
- Validate frontend dependencies for HTML, CSS, and JavaScript files.
- Open an AI chat panel for code-aware assistance.
- A setup guide will appear on first install to walk you through configuration.

## Supported Languages

| Language | Extensions / VS Code languageId |
| --- | --- |
| Python | `.py` / `python` |
| JavaScript | `.js`, `.jsx` / `javascript`, `javascriptreact` |
| Java | `.java` / `java` |
| C / C++ / Arduino | `.c`, `.cpp`, `.h`, `.ino` / `c`, `cpp` |
| HTML | `.html` / `html` |
| React / JSX | `.jsx`, `.tsx` / `javascriptreact`, `typescriptreact` |

## Commands

- `Code Janitor: Format Code`
- `Code Janitor: Lint Code (ESLint)`
- `Code Janitor: Live HTML/React Preview (Unsaved)`
- `Code Janitor: Validate Frontend Dependencies`
- `Code Janitor: Open AI Chat`

## Default Keybindings

- `Alt+D`: format code
- `Alt+L`: lint JavaScript
- `Alt+P`: open live preview

  <img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/683c0c4f-1b8b-41c1-86b4-ed2341b223e9" />

- `Alt+V`: validate frontend dependencies
- `Ctrl+Alt+C`: open AI chat

  <img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/1c7091f1-dc90-4739-8d59-549bf8c85639" />

## Installation

### From Marketplace

Search for **Code Janitor** in the VS Code Extensions panel (`Ctrl+Shift+X`) or visit the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Debanshu2005.code-janitor).

### From source

```bash
git clone https://github.com/Debanshu2005/code-janitor.git
cd code-janitor
npm install
```

Press `F5` in VS Code to launch the Extension Development Host.

## AI Integration

AI support is optional. Four providers are supported:

| Provider | Requires | Models |
| --- | --- | --- |
| **Ollama** | Local install | Any Ollama model |
| **Groq** | Free API key | llama-3.1, mixtral, gemma |
| **OpenRouter** | Free API key | 100+ models incl. free tier |
| **Anthropic** | Paid API key | Claude 3.5, Claude 3 Opus |

See the **[setup guide](https://code-janitor-web.vercel.app)** for step-by-step instructions on getting API keys and installing Ollama models.

### Recommended settings

```json
{
  "codeJanitor.ai.enabled": true,
  "codeJanitor.ai.provider": "ollama",
  "codeJanitor.ai.ollamaUrl": "http://localhost:11434",
  "codeJanitor.ai.model": "qwen2.5-coder:7b",
  "codeJanitor.ai.timeout": 90000
}
```

## Scripts

```bash
npm run lint
npm run lint:fix
npm run format:js
npm run format:html
npm run package
```

## Notes

- The extension entry point is [`src/extension.js`](./src/extension.js).
- Live preview logic is in [`src/live-preview.js`](./src/live-preview.js).
- Core fixers are in [`src/core/fixers`](./src/core/fixers).
- AI agent is in [`src/ai-agent`](./src/ai-agent).

## License

MIT License © Debanshu2005
