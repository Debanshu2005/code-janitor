import sys
import ast
import re
try:
    import autopep8
    HAS_AUTOPEP8 = True
except ImportError:
    HAS_AUTOPEP8 = False

try:
    import black
    HAS_BLACK = True
except ImportError:
    HAS_BLACK = False


def fix_indentation(code):
    """Fix indentation issues using improved algorithm"""
    lines = code.splitlines()
    fixed_lines = []
    indent_stack = [0]  # Stack to track nested indentation levels
    indent_size = 4
    
    for line in lines:
        stripped = line.strip()
        
        # Preserve empty lines and comments
        if not stripped or stripped.startswith('#'):
            fixed_lines.append(line)
            continue
            
        # Handle dedent keywords (same level as their opening statement)
        if re.match(r'^(elif|else|except|finally)\b', stripped):
            if len(indent_stack) > 1:
                indent_stack.pop()
        # Handle block-ending statements
        elif re.match(r'^(return|break|continue|pass|raise)\b', stripped):
            # These stay at current level but might end the block
            pass
            
        # Apply current indentation level
        current_indent = indent_stack[-1]
        proper_indent = ' ' * current_indent
        fixed_lines.append(proper_indent + stripped)
        
        # Handle indent increase for colon-ending statements
        if stripped.endswith(':') and not stripped.startswith('#'):
            new_indent = current_indent + indent_size
            indent_stack.append(new_indent)
        # Handle potential block endings
        elif re.match(r'^(return|break|continue|pass|raise)\b', stripped) and len(indent_stack) > 1:
            # Pop one level after these statements (they often end blocks)
            indent_stack.pop()
            
    return '\n'.join(fixed_lines)


def fix_syntax_errors(code):
    """Fix common syntax errors"""
    lines = code.splitlines()
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        
        # Skip empty lines and comments
        if not stripped or stripped.startswith('#'):
            continue
            
        # Fix missing colons for control structures
        if re.match(r'^(if|elif|else|def|class|for|while|try|except|finally|with|async\s+def)\b', stripped):
            if not stripped.endswith(':') and '#' not in stripped and not stripped.endswith('\\'):
                lines[i] = line.replace(stripped, stripped + ':')
        
        # Fix JavaScript/C-style syntax
        lines[i] = re.sub(r'^(\s*)(var|let|const|function)\s+', r'\1', lines[i])
        lines[i] = re.sub(r';\s*$', '', lines[i])  # Remove semicolons
        
        # Fix print statements (Python 2 to 3)
        lines[i] = re.sub(r'^(\s*)print\s+([^\(].+)$', r'\1print(\2)', lines[i])
        
        # Fix boolean and null values
        lines[i] = re.sub(r'\btrue\b', 'True', lines[i])
        lines[i] = re.sub(r'\bfalse\b', 'False', lines[i])
        lines[i] = re.sub(r'\bnull\b', 'None', lines[i])
        lines[i] = re.sub(r'\bundefined\b', 'None', lines[i])
        
        # Fix comparison operators
        lines[i] = re.sub(r'===', '==', lines[i])
        lines[i] = re.sub(r'!==', '!=', lines[i])
        lines[i] = re.sub(r'&&', ' and ', lines[i])
        lines[i] = re.sub(r'\|\|', ' or ', lines[i])
        
        # Fix common typos
        lines[i] = re.sub(r'\bpirnt\b', 'print', lines[i])
        lines[i] = re.sub(r'\bprnit\b', 'print', lines[i])
        lines[i] = re.sub(r'\bpritn\b', 'print', lines[i])
        lines[i] = re.sub(r'\bimprot\b', 'import', lines[i])
        lines[i] = re.sub(r'\bimoprt\b', 'import', lines[i])
        lines[i] = re.sub(r'\bretrun\b', 'return', lines[i])
        lines[i] = re.sub(r'\bretrn\b', 'return', lines[i])
        
        # Fix string quotes (normalize to double quotes)
        if "'" in lines[i] and '"' not in lines[i] and not lines[i].strip().startswith('#'):
            lines[i] = lines[i].replace("'", '"')
            
    return '\n'.join(lines)


def fix_advanced_syntax(code):
    """Fix advanced Python syntax issues"""
    lines = code.splitlines()
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        
        # Fix lambda syntax
        lines[i] = re.sub(r'\blambda\s*([^:]*?)\s*=>', r'lambda \1:', lines[i])
        
        # Fix list comprehensions with missing brackets
        if 'for' in stripped and 'in' in stripped and not any(x in stripped for x in ['[', '(', '{']):
            if not stripped.startswith(('for', 'if', 'while', 'def', 'class')):
                lines[i] = line.replace(stripped, f'[{stripped}]')
        
        # Fix missing parentheses in function calls
        func_pattern = r'\b(print|len|str|int|float|list|dict|set|tuple)\s+([^\(\n]+)$'
        if re.search(func_pattern, stripped) and not stripped.endswith(')'):
            lines[i] = re.sub(func_pattern, r'\1(\2)', lines[i])
            
        # Fix string formatting
        lines[i] = re.sub(r'%s', '{}', lines[i])
        lines[i] = re.sub(r'%d', '{}', lines[i])
        
    return '\n'.join(lines)

def run_janitor(code_str):
    """Main logic to fix Python syntax and indentation errors"""
    if not code_str.strip():
        return code_str
        
    current_code = code_str
    max_iterations = 3  # Prevent infinite loops
    
    for iteration in range(max_iterations):
        previous_code = current_code
        
        # Stage 1: Fix basic syntax errors
        current_code = fix_syntax_errors(current_code)
        
        # Stage 2: Fix advanced syntax
        current_code = fix_advanced_syntax(current_code)
        
        # Stage 3: Fix indentation
        current_code = fix_indentation(current_code)
        
        # Stage 4: Use autopep8 if available
        if HAS_AUTOPEP8:
            try:
                current_code = autopep8.fix_code(current_code, options={"aggressive": 2})
            except Exception:
                pass  # Continue with manual fixes if autopep8 fails
        
        # Check if we've reached a stable state
        if current_code == previous_code:
            break
    
    # Stage 5: Final validation and Black formatting
    if HAS_BLACK:
        try:
            # Test if code is parseable
            ast.parse(current_code)
            # If parseable, format with Black
            current_code = black.format_str(current_code, mode=black.Mode())
        except (SyntaxError, IndentationError):
            # If still not parseable, try emergency fixes
            try:
                current_code = emergency_fix(current_code)
                ast.parse(current_code)  # Test again
            except Exception:
                pass  # Return best effort
        except Exception:
            pass  # Keep current code if Black fails
    else:
        # If Black not available, validate and apply emergency fixes if needed
        try:
            ast.parse(current_code)
        except (SyntaxError, IndentationError):
            current_code = emergency_fix(current_code)
    
    return current_code

def emergency_fix(code):
    """Last resort fixes for severely broken code"""
    lines = code.splitlines()
    fixed_lines = []
    
    for line in lines:
        stripped = line.strip()
        
        # Skip obviously broken lines
        if not stripped or stripped.startswith('#'):
            fixed_lines.append(line)
            continue
            
        # Ensure basic Python structure
        if stripped and not stripped.endswith(':') and any(kw in stripped for kw in ['if', 'def', 'class', 'for', 'while']):
            if not any(op in stripped for op in ['=', '(', ')', '[', ']']):
                stripped += ':'
                
        # Add basic indentation if completely missing
        if line == stripped:  # No indentation at all
            fixed_lines.append('    ' + stripped if fixed_lines and fixed_lines[-1].strip().endswith(':') else stripped)
        else:
            fixed_lines.append(line)
            
    return '\n'.join(fixed_lines)


if __name__ == "__main__":
    try:
        # Read all code from standard input
        input_code = sys.stdin.read()
        
        # Run the fixer logic
        fixed_code = run_janitor(input_code)
        
        # Write the fixed code to standard output
        sys.stdout.write(fixed_code)
    except Exception as e:
        # If anything fails, output the original code
        sys.stderr.write(f"Error: {e}\n")
        sys.stdout.write(input_code if 'input_code' in locals() else "")
