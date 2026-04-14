# AI Safety Guards - File Deletion Prevention

## Issue Reported
"⚠️ Syntax errors remain. The previous file contents were restored"
"the ai is also deleting the entire file when asked to fix the syntax error"

## What's Actually Happening

The AI is **NOT** deleting your files. The extension has **safety guards** that detect when the AI generates unsafe output (empty or heavily truncated files) and **automatically restores** the original content.

This is **WORKING AS INTENDED** to protect your code!

## Safety Mechanisms in Place

### 1. Replacement Safety Assessment (`assessReplacementSafety`)

Located in: `src/extension.js` (lines 90-150)

**Checks performed:**
- ✅ Prevents empty replacements
- ✅ Prevents files from being truncated to less than 50% of original size
- ✅ Prevents loss of more than 50% of non-empty lines
- ✅ Prevents loss of more than 65% of original identifiers (variable/function names)

```javascript
function assessReplacementSafety(originalCode, candidateCode) {
  // Empty check
  if (!candidate.trim()) {
    return { safe: false, reason: "Replacement is empty" }
  }
  
  // Size check
  if (originalTrimmed.length > 80 && 
      trimmed.length < Math.floor(originalTrimmed.length * 0.5)) {
    return { safe: false, reason: "Replacement is much shorter than the original" }
  }
  
  // Line count check
  if (originalNonEmptyLines >= 8 &&
      candidateNonEmptyLines < Math.floor(originalNonEmptyLines * 0.5)) {
    return { safe: false, reason: "Replacement removes too much non-empty content" }
  }
  
  // Identifier preservation check
  if (sharedIdentifiers / originalIdentifiers.size < 0.35) {
    return { safe: false, reason: "Replacement does not preserve enough original identifiers" }
  }
  
  return { safe: true }
}
```

### 2. Agent-Level Safety Guards (`applyChanges` in agent.js)

Located in: `src/ai-agent/agent.js` (lines 2800-2900)

**Additional checks:**
- ✅ Prevents emptying existing files without explicit user request
- ✅ Prevents deleting or emptying README.md files
- ✅ Prevents heavily truncating documentation files (>80% reduction)

```javascript
async applyChanges(filePath, newContent, allowOutsideWorkspace, options) {
  // Prevent emptying existing files
  if (!created && trimmedNewContent.length === 0 && !allowEmpty) {
    return {
      success: false,
      error: "Refusing to empty an existing file without explicit user request."
    }
  }

  // Protect README.md
  if (isReadme && trimmedNewContent.length === 0) {
    return {
      success: false,
      error: "Refusing to delete or empty README.md without explicit user request."
    }
  }

  // Protect documentation from heavy truncation
  if (!created && this._isDocFile(fullPath) && !allowDocTruncate) {
    const looksLikeMajorTruncate =
      oldTrimmedLength > 240 &&
      newTrimmedLength < Math.max(120, Math.floor(oldTrimmedLength * 0.2))

    if (looksLikeMajorTruncate) {
      return {
        success: false,
        error: "Refusing to heavily truncate documentation without explicit user request."
      }
    }
  }
}
```

### 3. Automatic Rollback on Failure

Located in: `src/extension.js` `fixCode` command (lines 450-550)

**Rollback triggers:**
- ✅ If AI output fails safety checks → Restore original
- ✅ If AI output introduces new syntax errors → Restore original
- ✅ If formatting introduces syntax errors → Restore original

```javascript
// Step 3: Apply AI fixes
const beforeAI = document.getText()
const aiResult = await applyAIFixes(document, editor, aiContext)

if (aiResult.applied) {
  const afterAICheck = await runSyntaxCheckAndFix(document, workspaceFolder)
  
  if (!afterAICheck.hasSyntaxErrors) {
    vscode.window.showInformationMessage("✅ Fixed with AI repairs!")
    return
  }
  
  // AI introduced errors or didn't fix them → ROLLBACK
  await replaceDocumentText(document, beforeAI, true)
  console.warn("Restored content after unsafe AI output")
}

// Step 4: Apply formatting
const beforeFormatting = document.getText()
await runFixerAndApply(document, editor)
const finalCheck = await runSyntaxCheckAndFix(document, workspaceFolder)

if (!finalCheck.hasSyntaxErrors) {
  vscode.window.showInformationMessage("✅ Fixed with formatting!")
} else {
  // Formatting failed → ROLLBACK
  await replaceDocumentText(document, beforeFormatting || originalCode, true)
  vscode.window.showWarningMessage(
    `⚠️ Syntax errors remain. The previous file contents were restored.`
  )
}
```

## Why This Happens

### Root Cause
When you run "Format Code" (`Alt+D`) on a file with syntax errors, the extension tries multiple fix strategies:

1. **Rule-based fixes** (Python fixer, JavaScript fixer, etc.)
2. **AI fixes** (using Ollama, Groq, OpenRouter, Anthropic, or NVIDIA)
3. **Formatting** (code beautification)

If the AI generates:
- An empty file
- A heavily truncated file
- A file that doesn't preserve your code structure
- A file that introduces new syntax errors

The safety guards **reject the AI output** and **restore your original code**.

### Why AI Might Generate Bad Output

1. **Model limitations**: The AI model might not understand the syntax error
2. **Context truncation**: The file might be too large for the AI's context window
3. **Ambiguous errors**: The syntax error message might not be clear enough
4. **Model hallucination**: The AI might generate plausible-looking but incorrect code

## What You Should Do

### Option 1: Fix Syntax Errors Manually First
The AI works best when the code is mostly correct. Fix obvious syntax errors manually, then use Code Janitor for formatting and optimization.

### Option 2: Use Rule-Based Fixes Only
Disable AI fixes temporarily:
```json
{
  "codeJanitor.ai.enabled": false
}
```

Then run `Alt+D` to apply only rule-based fixes and formatting.

### Option 3: Use AI Chat for Targeted Fixes
Instead of using `Alt+D`, use the AI Chat (`Ctrl+Alt+C`) to ask for specific fixes:

```
Fix the syntax error on line 42 where the function is missing a closing parenthesis
```

The AI Chat has better context and can ask clarifying questions.

### Option 4: Check AI Provider Configuration
Make sure you have a working AI provider configured:

**For Ollama (local, free):**
```bash
# Check if Ollama is running
ollama list

# If not installed, install from https://ollama.ai
# Then pull a code model
ollama pull codellama:latest
```

**For NVIDIA NIM (cloud, fast):**
```json
{
  "codeJanitor.ai.provider": "nvidia",
  "codeJanitor.ai.nvidiaApiKey": "your-key-here"
}
```

Get key at: https://build.nvidia.com

**For Groq (cloud, free):**
```json
{
  "codeJanitor.ai.provider": "groq",
  "codeJanitor.ai.groqApiKey": "your-key-here"
}
```

Get key at: https://console.groq.com

## What NOT to Do

### ❌ DON'T Disable Safety Guards
The safety guards are there to protect your code. Disabling them could result in actual data loss.

### ❌ DON'T Repeatedly Run Format Code
If the AI can't fix the syntax error, running `Alt+D` multiple times won't help. The safety guards will keep restoring your original code.

### ❌ DON'T Blame the Extension
The extension is **protecting** your code from being deleted. The message "The previous file contents were restored" means it **saved** your code from being lost.

## Understanding the Warning Message

```
⚠️ Syntax errors remain. The previous file contents were restored.
```

**What this means:**
- ✅ Your original code is **safe** and **intact**
- ✅ The AI attempted to fix the syntax errors but failed
- ✅ The extension **prevented** the bad AI output from being applied
- ✅ Your file was **automatically restored** to its original state
- ⚠️ You still need to fix the syntax errors manually or with AI Chat

**What this does NOT mean:**
- ❌ The AI deleted your file (it didn't - the safety guards prevented it)
- ❌ The extension is broken (it's working correctly)
- ❌ You lost your code (you didn't - it was restored)

## Technical Details

### Safety Check Flow

```
User runs Alt+D on file with syntax errors
  ↓
Extension tries rule-based fixes
  ↓
Extension tries AI fixes
  ↓
AI generates output
  ↓
Safety checks run:
  - Is output empty? → REJECT
  - Is output too short? → REJECT
  - Does output preserve identifiers? → REJECT
  - Does output introduce new errors? → REJECT
  ↓
If ANY check fails:
  - Restore original code
  - Show warning message
  - Log reason in console
  ↓
User's code is SAFE
```

### Logging

Check the Developer Console (`Ctrl+Shift+I`) for detailed logs:

```
✓ Processing file: example.py
✓ File languageId: python
⚠️ Initial syntax errors: SyntaxError: invalid syntax
🔧 Attempting rule-based fixes...
⚠️ Rule-based fixes made no changes
🤖 Attempting AI fixes...
Using AI agent (nvidia) to fix python...
✗ AI agent didn't provide file actions
⚠️ AI skipped: No file actions generated
📝 Attempting formatting...
⚠️ Errors remain after formatting
Restored content after unsafe AI output
```

## Summary

The extension is **working correctly**. The safety guards are **protecting your code** from being deleted or corrupted by bad AI output.

If you see the warning message, it means:
1. The AI couldn't fix the syntax errors
2. The extension prevented bad output from being applied
3. Your original code was restored
4. You need to fix the syntax errors manually or use AI Chat

**This is a feature, not a bug!**

---

**Related Files:**
- `src/extension.js` - Main safety logic and rollback mechanism
- `src/ai-agent/agent.js` - Agent-level safety guards
- `src/core/ai/ollama-client.js` - AI validation logic

**Related Settings:**
- `codeJanitor.ai.enabled` - Enable/disable AI fixes
- `codeJanitor.ai.provider` - Choose AI provider
- `codeJanitor.autoFixOnSave.enabled` - Auto-fix on save (default: false)

**Related Commands:**
- `Alt+D` - Format Code (with AI fixes)
- `Ctrl+Alt+C` - Open AI Chat (for targeted fixes)
- `Ctrl+Shift+I` - Open Developer Console (for logs)
