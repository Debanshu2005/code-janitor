# Codebase Knowledge Graph Report

Generated: 2026-05-17T09:25:23.499Z

## Overview

- **Total Files**: 152
- **Total Dependencies**: 179
- **Communities**: 36

## God Nodes (High Connectivity)

These files are central to the codebase architecture. Changes here affect many other files.

### src/extension.js

- **Type**: javascript
- **Lines**: 1686
- **Incoming Dependencies**: 0
- **Outgoing Dependencies**: 24
- **Total Connections**: 24

### src/ai-agent/chat-panel.js

- **Type**: javascript
- **Lines**: 8359
- **Incoming Dependencies**: 2
- **Outgoing Dependencies**: 14
- **Total Connections**: 16

### src/ai-agent/tools/index.js

- **Type**: javascript
- **Lines**: 161
- **Incoming Dependencies**: 3
- **Outgoing Dependencies**: 13
- **Total Connections**: 16

### src/ai-agent/tools/tool-registry.js

- **Type**: javascript
- **Lines**: 863
- **Incoming Dependencies**: 3
- **Outgoing Dependencies**: 12
- **Total Connections**: 15

### src/ai-agent/agent.js

- **Type**: javascript
- **Lines**: 7871
- **Incoming Dependencies**: 6
- **Outgoing Dependencies**: 7
- **Total Connections**: 13

### src/ai-agent/tools/generate-edge-cases.js

- **Type**: javascript
- **Lines**: 1002
- **Incoming Dependencies**: 5
- **Outgoing Dependencies**: 3
- **Total Connections**: 8

### src/ai-agent/tools/list-code-definition-names.js

- **Type**: javascript
- **Lines**: 778
- **Incoming Dependencies**: 8
- **Outgoing Dependencies**: 0
- **Total Connections**: 8

### src/utils/vscode-shim.js

- **Type**: javascript
- **Lines**: 136
- **Incoming Dependencies**: 8
- **Outgoing Dependencies**: 0
- **Total Connections**: 8

### src/ai-agent/workspace-memory.js

- **Type**: javascript
- **Lines**: 2215
- **Incoming Dependencies**: 2
- **Outgoing Dependencies**: 5
- **Total Connections**: 7

### src/cli.js

- **Type**: javascript
- **Lines**: 354
- **Incoming Dependencies**: 2
- **Outgoing Dependencies**: 5
- **Total Connections**: 7

## Directory Structure

### .

- **Files**: 25
- **Types**: javascript, python, json, html

### .tmp-vsix-100/extension

- **Files**: 1
- **Types**: json

### .tmp-vsix-100/extension/src/ai-agent

- **Files**: 3
- **Types**: javascript, html

### .tmp-vsix-100/extension/src

- **Files**: 1
- **Types**: javascript

### .tmp-vsix-100/extension/src/images

- **Files**: 1
- **Types**: asset

### .vscode

- **Files**: 3
- **Types**: json

### arduino-ide-agent

- **Files**: 1
- **Types**: json

### arduino-ide-agent/src/ai-agent

- **Files**: 5
- **Types**: javascript, html, asset

### arduino-ide-agent/src/ai-agent/__tests__

- **Files**: 2
- **Types**: javascript

### arduino-ide-agent/src

- **Files**: 1
- **Types**: javascript

### arduino-ide-agent/src/graphify

- **Files**: 1
- **Types**: javascript

### arduino-ide-agent/src/images

- **Files**: 1
- **Types**: asset

### arduino-ide-agent/src/source-control

- **Files**: 2
- **Types**: html, javascript

### arduino-ide-agent/src/utils

- **Files**: 1
- **Types**: javascript

### bin

- **Files**: 1
- **Types**: javascript

### formatters/prettier

- **Files**: 2
- **Types**: json

### js

- **Files**: 1
- **Types**: javascript

### scripts

- **Files**: 3
- **Types**: javascript

### src

- **Files**: 7
- **Types**: javascript

### src/ai-agent

- **Files**: 14
- **Types**: javascript, html, asset

### src/ai-agent/tools

- **Files**: 14
- **Types**: javascript

### src/ai-agent/tools/__tests__

- **Files**: 11
- **Types**: javascript

### src/ai-agent/__tests__

- **Files**: 9
- **Types**: javascript

### src/core/ai

- **Files**: 1
- **Types**: javascript

### src/core

- **Files**: 7
- **Types**: javascript, python

### src/core/fixer

- **Files**: 1
- **Types**: javascript

### src/core/fixers

- **Files**: 9
- **Types**: javascript, python

### src/core/__tests__

- **Files**: 5
- **Types**: javascript

### src/graphify

- **Files**: 3
- **Types**: javascript

### src/graphify/__tests__

- **Files**: 2
- **Types**: javascript

### src/images

- **Files**: 1
- **Types**: asset

### src/self-healing

- **Files**: 2
- **Types**: javascript

### src/self-healing/__tests__

- **Files**: 2
- **Types**: javascript

### src/utils

- **Files**: 4
- **Types**: javascript

### src/__tests__

- **Files**: 4
- **Types**: javascript

### styles

- **Files**: 1
- **Types**: stylesheet

## Architecture Insights

When answering architecture questions:

1. **Start with God Nodes**: These files (extension.js, chat-panel.js, index.js) are architectural anchors
2. **Follow Dependencies**: Use the dependency graph to understand data flow
3. **Community Boundaries**: Each directory represents a logical module

## Usage

Before searching raw files, consult this report to understand:
- Which files are most important
- How modules connect
- Where to find specific functionality
