# Code Janitor

![VS Code](https://img.shields.io/badge/VS Code-%3E%3D1.80-blue?logo=visual-studio-code)
![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-green)


## Introduction

Code Janitor is a VS Code extension designed to enhance the coding experience by providing tools for formatting, repairing, and validating code. It supports multiple programming languages including Python, JavaScript, Java, C/C++, Arduino, HTML, CSS, JSON, Markdown, SVG, Vue, Svelte, and more.

### Key Features

1. **Code Formatting**: Code Janitor can format your code according to the specified style guide or rules.
2. **Manual Fixing**: You can run manual fixing from the Command Palette with `Code Janitor: Format Code`.
3. **Auto-Correction**: Apply real-time auto-correction while typing for supported languages.
4. **Live Preview**: Preview HTML, React, Markdown, CSS, JSON, SVG, Vue, Svelte and more in a live webview.
5. **Frontend Dependency Validation**: Validate frontend dependencies for HTML, CSS, and JavaScript files.
6. **AI Chat Panel**: Open an AI chat panel to interact with the Code Janitor AI assistant.

### Installation

To install Code Janitor, follow these steps:

1. Close Visual Studio Code.
2. Copy the `.vsix` file from the `arduino-ide-agent` directory into your Arduino IDE plugins directory (`%USERPROFILE%\.arduinoIDE\plugins` on Windows, `~/.arduinoIDE/plugins` on Linux/macOS).
3. Reopen Visual Studio Code.

### Usage

1. **Format Code**: Open a file in Visual Studio Code and press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac). Type `Code Janitor: Format Code` and select it from the list.
2. **Manual Fixing**: Run manual fixing from the Command Palette with `Code Janitor: Format Code`.
3. **Auto-Correction**: Apply real-time auto-correction while typing for supported languages.
4. **Live Preview**: Open a file in Visual Studio Code and press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac). Type `Code Janitor: Live Preview` and select it from the list.
5. **Frontend Dependency Validation**: Open a file in Visual Studio Code and press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac). Type `Code Janitor: Validate Dependencies` and select it from the list.
6. **AI Chat Panel**: Open an AI chat panel by pressing `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac). Type `Code Janitor: Open AI Chat` and select it from the list.

### Additional Notes

- Code Janitor is compatible with Visual Studio Code 1.80 and later versions.
- The extension uses a mix of rule-based repair, formatting tools, and optional AI-powered assistance via Ollama, Groq, OpenRouter, or Anthropic.
- The AI chat panel allows you to interact with the Code Janitor AI assistant for more advanced features.

### Contributing

If you are interested in contributing to Code Janitor, feel free to open an issue or submit a pull request. We welcome your contributions to enhance the extension and improve its functionality.

## License

Code Janitor is licensed under the MIT License. See the `LICENSE` file for details.

## Support

For support, please visit our [GitHub repository](https://github.com/Debanshu2005/code-janitor) or contact us at debanshu2005@example.com.

---

This detailed README provides a comprehensive overview of Code Janitor's features, installation instructions, usage tips, additional notes, and contributing guidelines.