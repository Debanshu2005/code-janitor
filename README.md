# Code Janitor

![VS Code](https://img.shields.io/badge/VSCode-%3E%3D1.80-blue?logo=visual-studio-code)
![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-green)
![Version](https://img.shields.io/badge/Version-0.9.0-orange)

Code Janitor is a VS Code extension for fixing and formatting code with a mix of rule-based repair, formatting tools, and optional Ollama-powered AI fallback.

## Features

- Format and repair Python, JavaScript, Java, C/C++, Arduino, and HTML files.
- Run manual fixing from the Command Palette with `Code Janitor: Format Code`.
- Apply real-time auto-correction while typing for supported languages.
- Preview HTML and React files in a live webview.
- Validate frontend dependencies for HTML, CSS, and JavaScript files.
- Open an AI chat panel for code-aware assistance.

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
- `Alt+V`: validate frontend dependencies
- `Ctrl+Alt+C`: open AI chat

## Installation

### From source

```bash
git clone https://github.com/Debanshu2005/code-janitor.git
cd code-janitor
npm install
```

Press `F5` in VS Code to launch the Extension Development Host.

## AI Integration

AI support is optional and uses Ollama.

Recommended settings:

```json
{
  "codeJanitor.ai.enabled": true,
  "codeJanitor.ai.ollamaUrl": "http://localhost:11434",
  "codeJanitor.ai.model": "qwen2.5-coder:1.5b",
  "codeJanitor.ai.timeout": 90000
}
```

AI is used as a fallback when rule-based fixing cannot safely produce a valid result.

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

## License

MIT License © Debanshu2005
