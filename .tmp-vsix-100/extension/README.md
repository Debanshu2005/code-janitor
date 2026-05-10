# Code Janitor Arduino AI Agent

This directory is a standalone AI-agent extension package for Arduino IDE 2.x (Theia/VS Code extension compatible builds).

## What this package does

- Adds the command `Code Janitor Arduino: Open Arduino AI Chat`.
- Reuses the Code Janitor AI chat engine in a separate extension package.
- Keeps this Arduino-targeted package isolated from the main Code Janitor extension.
- Provides full internet connectivity status with visual indicators (Online/Offline/Checking)
- Includes Speech-to-Text (STT) functionality with microphone input and real-time transcription
- Offers Text-to-Speech (TTS) capabilities with adjustable speech rate and smart text cleaning
- Supports NVIDIA AI integration with multiple NVIDIA NIM models

## Directory layout

- `package.json`: Extension manifest for Arduino-targeted package.
- `src/extension.js`: Entry point that registers the chat command.
- `src/ai-agent/*`: AI panel + agent logic copied from Code Janitor.

## Build VSIX

From repository root:

```powershell
cd arduino-ide-agent
npm run package
```

This generates a `.vsix` file in `arduino-ide-agent`.

## Install in Arduino IDE 2.x

1. Close Arduino IDE.
2. Copy the generated `.vsix` into your Arduino IDE plugins directory (`%USERPROFILE%\.arduinoIDE\plugins` on Windows, `~/.arduinoIDE/plugins` on Linux/macOS).
3. Reopen Arduino IDE.
4. Open Command Palette and run `Code Janitor Arduino: Open Arduino AI Chat`.

## Notes

- Arduino IDE plugin support varies by version/build. If your build does not load third-party VSIX plugins, use this package in VS Code or a Theia-based build that supports plugins.
- AI provider settings are under `codeJanitor.ai.*` in settings.
