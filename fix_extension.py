import re

file_path = r'd:\CityGrid\my-project\code-janitor\src\extension.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the fixRequest prompt
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

new_prompt = '''const fixRequest = `Fix the syntax errors in this ${language} file.

**File Information:**
File path: ${fileName.replace(/\\\\/g, "/")}
Language: ${language}

**Syntax Errors from Compiler:**
${syntaxErrorOutput || "No syntax checker output was provided."}

**Current File Contents:**
\\`\\`\\`${language}
${code}
\\`\\`\\`

IMPORTANT: Return the COMPLETE corrected file with ALL lines included. Do not truncate or omit any code. Include the entire file from start to finish.'''

content = re.sub(old_prompt, new_prompt, content, flags=re.MULTILINE)

with open(file_path, 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(content)

print("extension.js updated successfully!")
