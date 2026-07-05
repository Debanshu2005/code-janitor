# Syntax Fix Prompt Update for Version 1.6.1

## Issue
The Alt+D syntax fix command is not generating professional code and showing error: "❌ AI did not generate a file fix."

## Root Cause
The prompt in `applyAIFixes()` function (line 1021-1034 in extension.js) is too minimal and doesn't enforce professional coding standards.

## Solution
Replace the current prompt at lines 1021-1034 with this professional prompt:

```javascript
    const fixRequest = `You are a professional software engineer fixing syntax errors in production code.

**CRITICAL REQUIREMENTS:**
1. Fix ONLY the syntax errors shown in the compiler/interpreter output below
2. Preserve ALL existing functionality, logic, imports, and code structure
3. Maintain the original code style, formatting, and conventions
4. Do NOT refactor, optimize, or add features unless required to fix syntax
5. Do NOT remove any working code, comments, or documentation
6. Return the COMPLETE file with minimal changes - only fix what's broken
7. Keep variable names, function names, and all identifiers exactly as they are
8. Preserve all imports, exports, and module structure

**OUTPUT FORMAT:**
Return exactly ONE FILE action with the complete corrected file.

FILE: ${fileName.replace(/\\\\/g, "/")}
\`\`\`${language}
(complete corrected file here)
\`\`\`

**CONTEXT:**
Target file path must match one of: ${targetPaths}
Current file path: ${fileName.replace(/\\\\/g, "/")}
Language: ${language}

**SYNTAX ERRORS TO FIX:**
${syntaxErrorOutput || "No syntax checker output was provided."}

**CURRENT FILE CONTENTS:**
\`\`\`${language}
${code}
\`\`\`

**INSTRUCTIONS:**
Analyze the syntax errors above, identify the root cause, and return the complete file with ONLY those specific errors fixed. Do not change anything else.`
```

## Manual Steps
1. Open `d:\CityGrid\my-project\code-janitor\src\extension.js`
2. Find line 1021 that starts with: `const fixRequest = \`Fix syntax errors`
3. Replace lines 1021-1034 with the new prompt above
4. Save the file
5. Run `npm run package` to build version 1.6.1
6. Test Alt+D command with syntax errors

## Expected Result
- Alt+D will generate professional, production-ready code fixes
- Preserves all existing code structure and style
- Only fixes the specific syntax errors identified
- No more "AI did not generate a file fix" errors
