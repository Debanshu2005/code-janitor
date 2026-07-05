# Why AI Can't Fix Code - Diagnostic Guide

## Problem
The AI is not generating FILE actions when asked to fix syntax errors, resulting in:
```
✗ AI agent didn't provide file actions
⚠️ AI skipped: No file actions generated
```

## Root Causes

### 1. Path Matching Failure
The AI generates a FILE action, but the path doesn't match what the extension expects.

**Example:**
```
AI generates:  FILE: example.py
Extension expects one of:
  - d:/CityGrid/my-project/code-janitor/example.py (absolute)
  - example.py (basename)
  - src/example.py (relative to workspace)
```

If the AI uses `./example.py` or `/example.py`, it won't match!

### 2. AI Model Not Following Instructions
Some AI models are better at structured output than others.

**Model Performance:**
- ✅ **NVIDIA Minimax M2.7** - Good at structured output
- ✅ **Claude Sonnet 3.5** - Excellent at following instructions
- ⚠️ **Ollama CodeLlama** - Sometimes generates explanations instead
- ⚠️ **Groq Llama 3.1 8B** - May need explicit examples

### 3. Prompt Not Clear Enough
The current prompt might not be explicit enough about the exact format required.

### 4. AI Provider Not Configured
If Ollama isn't running or API keys aren't set, the AI can't respond at all.

## Diagnostic Steps

### Step 1: Check Developer Console
Press `Ctrl+Shift+I` and look for these logs:

**Good signs:**
```
Using AI agent (nvidia) to fix python...
✓ AI agent provided fix
✅ Fixed with AI repairs!
```

**Bad signs:**
```
✗ AI agent didn't provide file actions
⚠️ AI skipped: No file actions generated
Rejected AI output for example.py: Replacement is empty
```

### Step 2: Check AI Provider
```bash
# For Ollama
ollama list
# Should show: codellama:latest

# Test Ollama
curl http://localhost:11434/api/tags
```

### Step 3: Check API Keys
Open VS Code Settings (`Ctrl+,`) and search for "Code Janitor AI":
- `codeJanitor.ai.provider` - Should be set to your provider
- `codeJanitor.ai.nvidiaApiKey` - If using NVIDIA
- `codeJanitor.ai.groqApiKey` - If using Groq
- `codeJanitor.ai.anthropicApiKey` - If using Anthropic

### Step 4: Test with AI Chat
Instead of `Alt+D`, try using AI Chat (`Ctrl+Alt+C`):

```
Fix the syntax error in example.py on line 10
```

If AI Chat works but `Alt+D` doesn't, the issue is with the prompt format.

## Solutions

### Solution 1: Use Better AI Model

**Option A: NVIDIA NIM (Recommended)**
```json
{
  "codeJanitor.ai.provider": "nvidia",
  "codeJanitor.ai.nvidiaApiKey": "nvapi-xxx",
  "codeJanitor.ai.model": "nvidia/minimax-m2.7"
}
```
Get key at: https://build.nvidia.com

**Option B: Anthropic Claude**
```json
{
  "codeJanitor.ai.provider": "anthropic",
  "codeJanitor.ai.anthropicApiKey": "sk-ant-xxx",
  "codeJanitor.ai.model": "claude-3-5-sonnet-20241022"
}
```
Get key at: https://console.anthropic.com

**Option C: Groq (Free)**
```json
{
  "codeJanitor.ai.provider": "groq",
  "codeJanitor.ai.groqApiKey": "gsk_xxx",
  "codeJanitor.ai.model": "llama-3.1-70b-versatile"
}
```
Get key at: https://console.groq.com

### Solution 2: Fix Path Matching

The issue might be that the AI is using a path format that doesn't match. Let me check the actual path matching logic...

**Current logic:**
```javascript
const pathCandidates = getDocumentPathCandidates(document, workspaceFolder)
// Returns: Set([
//   "d:/CityGrid/my-project/code-janitor/example.py",  // absolute
//   "example.py",                                       // basename
//   "src/example.py"                                    // relative
// ])

const fileAction = result.actions.find(
  (a) =>
    a.type === "file" &&
    a.path &&
    pathCandidates.has(a.path.replace(/\\\\/g, "/"))
)
```

**Problem:** If AI returns `./example.py` or `/example.py`, it won't match!

**Fix:** Make path matching more flexible.

### Solution 3: Use AI Chat Instead

The AI Chat has better context and can ask clarifying questions:

1. Press `Ctrl+Alt+C`
2. Type: "Fix syntax errors in the current file"
3. AI will analyze and provide fixes
4. Review and apply changes

### Solution 4: Fix Manually First

If the syntax error is simple (missing colon, parenthesis, etc.), fix it manually first. Then use `Alt+D` for formatting and optimization.

## Improved Prompt (For Developers)

The current prompt in `applyAIFixes` is:

```javascript
const fixRequest = `Fix syntax errors in the current ${language} file only.
Return exactly one FILE action for this file and include the complete corrected file contents.
Do not remove unrelated code. Do not return an empty file.
Target file path must match one of: ${targetPaths}

Current file path: ${fileName.replace(/\\\\/g, "/")}

Current syntax-check output:
${syntaxErrorOutput || "No syntax checker output was provided."}

Current file contents:
\`\`\`${language}
${code}
\`\`\``
```

**Improvements needed:**
1. Add explicit example of expected output format
2. Make path matching more flexible
3. Add retry logic if AI doesn't follow format
4. Use better model by default

## Recommended Fix (Code Changes)

I'll create an improved version of `applyAIFixes` that:
1. Uses more flexible path matching
2. Adds explicit output format example
3. Retries with simpler prompt if first attempt fails
4. Logs more diagnostic information

Would you like me to implement these improvements?

## Temporary Workaround

Until the fix is implemented, use this workflow:

1. **For simple syntax errors:** Fix manually
2. **For complex errors:** Use AI Chat (`Ctrl+Alt+C`)
3. **For formatting:** Use `Alt+D` on files without syntax errors

## Why Safety Guards Trigger

Even if the AI generates a FILE action, it might be rejected by safety guards if:

1. **Empty or too short:** AI generated incomplete code
2. **Missing identifiers:** AI removed too many variable/function names
3. **Wrong language:** AI generated code in wrong language
4. **Introduces new errors:** AI's fix creates new syntax errors

These are **good things** - they protect your code!

## Next Steps

1. Check which AI provider you're using
2. Verify API keys are configured
3. Try using AI Chat instead of Alt+D
4. Check Developer Console for detailed error messages
5. Consider switching to NVIDIA NIM or Claude for better results

---

**Related Files:**
- `src/extension.js` - `applyAIFixes` function (line 950-1050)
- `src/ai-agent/agent.js` - AI agent chat logic
- `AI_SAFETY_GUARDS.md` - Safety mechanism documentation

**Related Settings:**
- `codeJanitor.ai.enabled` - Enable/disable AI
- `codeJanitor.ai.provider` - Choose provider
- `codeJanitor.ai.model` - Choose model
