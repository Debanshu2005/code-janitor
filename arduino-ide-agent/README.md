# Code Janitor Arduino AI Agent

`Code Janitor Arduino AI Agent` is a standalone VSIX package that brings the Code Janitor chat assistant into Arduino IDE 2.x and other compatible Theia / VS Code extension hosts.

This package is focused on AI chat and guided edits. It does not include the full command set from the main `Code Janitor` VS Code extension.

## Features

- Opens a dedicated Arduino chat panel with `Code Janitor Arduino: Open Arduino AI Chat`
- Supports `ollama`, `groq`, `openrouter`, and `anthropic`
- Scans the workspace for relevant context before answering
- Can generate structured `FILE`, `MKDIR`, and `CMD` actions with safety checks
- Preserves the last selected model per provider
- Includes quick actions such as explain, review, fix, refactor, tests, and syntax scan

## Package Layout

- `src/extension.js`: Arduino extension activation entry
- `src/ai-agent/chat-panel.js`: webview bridge, command handling, and settings sync
- `src/ai-agent/agent.js`: prompt building, provider requests, parsing, and action safety
- `src/ai-agent/chat-panel.html`: chat UI

## Commands

- `Code Janitor Arduino: Open Arduino AI Chat`

Default keybinding:

- `Ctrl+Alt+A` on Windows/Linux
