import re

file_path = r'd:\CityGrid\my-project\code-janitor\src\extension.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the fixRequest section
old_start = 'const fixRequest = `Fix syntax errors in the current ${language} file only.'
new_prompt = '''const fixRequest = `Fix the syntax errors in this ${language} file.

**File Information:**
File path: ${fileName.replace(/\\\\\\\\/g, "/")}
Language: ${language}

**Syntax Errors from Compiler:**
${syntaxErrorOutput || "No syntax checker output was provided."}

**Current File Contents:**
\`\`\`${language}
${code}
\`\`\`

IMPORTANT: Return the COMPLETE corrected file with ALL lines included. Do not truncate or omit any code. Include the entire file from start to finish.`'''

# Find the old prompt
start_idx = content.find(old_start)
if start_idx != -1:
    # Find the end of the template literal
    end_idx = content.find('`\n\n    let fullResponse', start_idx)
    if end_idx != -1:
        # Replace the section
        content = content[:start_idx] + new_prompt + content[end_idx+1:]
        
        with open(file_path, 'w', encoding='utf-8', newline='\r\n') as f:
            f.write(content)
        print("extension.js updated successfully!")
    else:
        print("Could not find end of prompt")
else:
    print("Could not find start of prompt")
