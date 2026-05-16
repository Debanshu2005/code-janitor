# Code Janitor
![VS Code](https://img.shields.io/badge/VSCode-%3E%3D1.80-blue?logo=visual-studio-code)
![Arduino IDE](https://img.shields.io/badge/Arduino%20IDE-2.x-00979D?logo=arduino)
![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-green)

## Introduction
Code Janitor is a powerful extension available for both **VS Code** and **Arduino IDE 2.x** designed to enhance your coding experience with AI-powered tools for formatting, repairing, validating, and understanding code. It supports multiple programming languages including Python, JavaScript, Java, C/C++, Arduino, HTML, CSS, JSON, Markdown, SVG, Vue, and Svelte.

## Features

### Core Capabilities
- **AI-Powered Code Assistance**: Intelligent chat interface for debugging, code reviews, and formatting
- **Multi-Language Support**: Python, JavaScript, Java, C/C++, Arduino, HTML, CSS, JSON, Markdown, SVG, Vue, Svelte
- **Code Quality Tools**: Linting, validation, and performance analysis
- **Project Visualization**: Graphify project intelligence with interactive codebase graph visualization
- **Workspace Memory**: Tracks repository blueprint, change ledger, and hot files

### VS Code Extension
- **Advanced Editing Tools**: PATCH, APPLY_DIFF, INSERT_CONTENT, READ_FILES for precise code modifications
- **Review System**: SUBMIT_REVIEW_FINDINGS for formal code review diagnostics
- **Quality Analysis**: ANALYZE_FILE_QUALITY for automated code quality scans
- **GitHub Integration**: GITHUB_CONTEXT for repository, issue, and pull request context
- **Live Preview**: For HTML, React, Markdown, CSS, JSON, SVG, Vue, Svelte
- **Performance Monitoring**: PERFORMANCE: show for AI performance reports

### Arduino IDE 2.x Agent
- **Dedicated Arduino Chat Panel**: Accessible via `Code Janitor Arduino: Open Arduino AI Chat`
- **Source Control Panel**: Accessible via `Code Janitor Arduino: Open Source Control`
- **Graphify Visualization**: Accessible via `Code Janitor Arduino: Visualize Project Graph`
- **AI Provider Support**: Ollama, Groq, OpenRouter, Anthropic, NVIDIA

## Installation

### For VS Code
1. Search for "Code Janitor" in the VS Code extensions marketplace
2. Install the extension
3. Reload VS Code

### For Arduino IDE 2.x
1. Download the VSIX package from the releases page
2. Install via the Arduino IDE extension manager
3. Restart Arduino IDE

## Usage

### Basic Commands
- `Code Janitor: Open Chat` - Open the AI chat interface
- `Code Janitor: Format Document` - Format the current document
- `Code Janitor: Validate Frontend` - Validate frontend dependencies
- `Code Janitor: Preview` - Open a live preview of the current file

### Advanced Features
- **Graphify**: Run `GRAPHIFY: open` to visualize your project's architecture
- **Workspace Memory**: Check `graphify-out/WORKSPACE_MEMORY.md` for repository blueprint
- **Todo Tracking**: Use `UPDATE_TODO_LIST:` to manage multi-step tasks

## Configuration

Create a `.codejanitor` configuration file in your project root to customize behavior:

