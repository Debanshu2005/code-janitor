import re

file_path = r'd:\CityGrid\my-project\code-janitor\src\extension.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

old_prompt = r'''const fixRequest = `Fix syntax errors in the current \$\{language\} file only\.
Return exactly one FILE action for this file and include the complete corrected file contents\.
Do not remove unrelated code\. Do not return an empty file\.
Target file path must match one of: \$\{targetPaths\}

Current file path: \$\{fileName\.replace\(/\\\\/g, "/"\)\}

Current syntax-check output:
\$\{syntaxErrorOutput \|\| "No syntax checker output was provided\."\}

Current file contents:
\\`\\`\\`\$\{language\}
\$\{code\}
\\`\\`\\`'''

new_prompt = '''const fixRequest = `You are a professional software engineer fixing syntax errors in production code.

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
\\`\\`\\`${language}
(complete corrected file here)
\\`\\`\\`

**CONTEXT:**
Target file path must match one of: ${targetPaths}
Current file path: ${fileName.replace(/\\\\/g, "/")}
Language: ${language}

**SYNTAX ERRORS TO FIX:**
${syntaxErrorOutput || "No syntax checker output was provided."}

**CURRENT FILE CONTENTS:**
\\`\\`\\`${language}
${code}
\\`\\`\\`

**INSTRUCTIONS:**
Analyze the syntax errors above, identify the root cause, and return the complete file with ONLY those specific errors fixed. Do not change anything else.'''

content = re.sub(old_prompt, new_prompt, content, flags=re.MULTILINE)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Prompt replaced successfully!")
