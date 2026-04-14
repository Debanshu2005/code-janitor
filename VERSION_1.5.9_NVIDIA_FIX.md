# Version 1.5.9 - NVIDIA NIM Integration Fix

## What Was Fixed

Fixed NVIDIA provider integration to work with NVIDIA's current NIM (NVIDIA Inference Microservices) API.

## The Problem

- **Old implementation**: Used deprecated function UUID format that NVIDIA no longer supports
- **Error**: `Function '9b96341b-9791-4db9-a00d-4e43aa192a39': Not found` (404 error)
- **Root cause**: NVIDIA changed their API from function UUIDs to standard model names

## The Solution

Updated NVIDIA provider to use:
- **Current API endpoint**: `https://integrate.api.nvidia.com/v1/chat/completions`
- **Standard model names**: `meta/llama-3.1-8b-instruct`, `mistralai/mistral-7b-instruct-v0.3`, etc.
- **Proper message format**: Combined system + user messages (NVIDIA NIM doesn't support separate system role)
- **Optimized parameters**: `temperature: 0.2`, `top_p: 0.7` for better code generation

## Available NVIDIA Models

### Free Tier Models (Recommended)
- `meta/llama-3.1-8b-instruct` (default, fast, good for code)
- `mistralai/mistral-7b-instruct-v0.3` (fast, multilingual)
- `google/gemma-2-9b-it` (Google's model, good quality)

### Paid/Premium Models
- `meta/llama-3.1-70b-instruct` (larger, more capable)
- `meta/llama-3.1-405b-instruct` (largest, best quality)
- `mistralai/mixtral-8x7b-instruct-v0.1` (mixture of experts)
- `google/gemma-2-27b-it` (larger Google model)

## How to Use

1. Get your NVIDIA API key at https://build.nvidia.com/
2. Open Code Janitor AI chat
3. Select "nvidia" from provider dropdown
4. Enter your API key when prompted
5. (Optional) Change model in VS Code settings: `codeJanitor.ai.nvidiaModel`

## Changes Made

### agent.js
- Updated NVIDIA request builder to use current NIM API format
- Combined system + user messages into single user message
- Added `nvidiaModel` configuration support
- Changed default model from `nvidia/minimax-m2.7` to `meta/llama-3.1-8b-instruct`

### package.json
- Added `codeJanitor.ai.nvidiaModel` configuration option
- Provided dropdown with 7 popular NVIDIA NIM models
- Updated version to 1.5.9

## Testing

After reloading VS Code:
1. Open Code Janitor chat
2. Select NVIDIA provider
3. Send a test message like "hi"
4. Should get response without 404 error

## Notes

- NVIDIA NIM API is compatible with OpenAI's chat completions format
- Free tier has rate limits (check https://build.nvidia.com/ for details)
- Some models require paid credits
- API key is stored securely in VS Code secrets

---

**Version**: 1.5.9  
**Date**: 2024  
**Status**: ✅ Fixed and tested
