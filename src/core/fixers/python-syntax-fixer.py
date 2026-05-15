#!/usr/bin/env python3
"""
Standalone Python Syntax Fixer
Fixes common Python syntax errors and indentation issues without external dependencies.
"""

import sys
import ast
import re


def fix_indentation(code):
    """Fix indentation issues using proper Python indentation rules"""
    lines = code.splitlines()
    fixed_lines = []
    indent_stack = [0]  # Stack to track indentation levels
    indent_size = 4  # Standard Python indentation

    for line_num, line in enumerate(lines):
        stripped = line.strip()

        # Skip empty lines and comments
        if not stripped or stripped.startswith("#"):
            fixed_lines.append(line)
            continue

        # Determine expected indentation level
        current_indent = len(line) - len(line.lstrip())

        # Handle dedent keywords
        if re.match(r"^(elif|else|except|finally)\b", stripped):
            # These should be at the same level as their corresponding if/try
            if len(indent_stack) > 1:
                indent_stack.pop()
        elif re.match(r"^(return|break|continue|pass|raise)\b", stripped):
            # These can be at current level, no change needed
            pass

        # Apply current indentation level
        target_indent = indent_stack[-1]
        proper_line = " " * target_indent + stripped
        fixed_lines.append(proper_line)

        # Handle indent keywords
        if stripped.endswith(":"):
            # Increase indentation for next block
            new_indent = target_indent + indent_size
            indent_stack.append(new_indent)
        elif re.match(r"^(return|break|continue|pass|raise)\b", stripped):
            # These might end a block, but we'll handle it contextually
            pass

    return "\n".join(fixed_lines)


def fix_missing_colons(code):
    """Add missing colons after control structures"""
    lines = code.splitlines()

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Check for control structures that need colons
        if re.match(
            r"^(if|elif|else|def|class|for|while|try|except|finally|with)\b", stripped
        ):
            if not stripped.endswith(":") and "#" not in stripped:
                # Add colon at the end
                lines[i] = line.rstrip() + ":"

    return "\n".join(lines)


def fix_print_statements(code):
    """Convert Python 2 print statements to Python 3 function calls"""
    # Match print statements that are not already function calls
    pattern = r"^(\s*)print\s+([^\(\n].*)$"

    def replace_print(match):
        indent = match.group(1)
        content = match.group(2).strip()
        return f"{indent}print({content})"

    return re.sub(pattern, replace_print, code, flags=re.MULTILINE)


def fix_boolean_values(code):
    """Fix JavaScript-style boolean values to Python"""
    # Fix boolean literals
    code = re.sub(r"\btrue\b", "True", code)
    code = re.sub(r"\bfalse\b", "False", code)
    code = re.sub(r"\bnull\b", "None", code)
    code = re.sub(r"\bundefined\b", "None", code)

    return code


def fix_operators(code):
    """Fix JavaScript-style operators to Python"""
    # Fix comparison operators
    code = re.sub(r"===", "==", code)
    code = re.sub(r"!==", "!=", code)

    # Fix logical operators
    code = re.sub(r"\b&&\b", " and ", code)
    code = re.sub(r"\b\|\|\b", " or ", code)
    code = re.sub(r"\b!\b", " not ", code)

    return code


def remove_js_keywords(code):
    """Remove JavaScript keywords that don't belong in Python"""
    lines = code.splitlines()

    for i, line in enumerate(lines):
        # Remove var, let, const, function keywords
        lines[i] = re.sub(r"^(\s*)(var|let|const|function)\s+", r"\1", line)

        # Remove semicolons at end of lines
        lines[i] = re.sub(r";\s*$", "", lines[i])

    return "\n".join(lines)


def fix_string_quotes(code):
    """Normalize string quotes (optional enhancement)"""
    # Convert single quotes to double quotes for consistency
    # This is a simple implementation - a full parser would be more robust
    lines = code.splitlines()

    for i, line in enumerate(lines):
        # Skip lines that are comments
        if line.strip().startswith("#"):
            continue

        # Simple quote conversion (doesn't handle all edge cases)
        if "'" in line and '"' not in line:
            lines[i] = line.replace("'", '"')

    return "\n".join(lines)


def validate_syntax(code):
    """Check if the code has valid Python syntax"""
    try:
        ast.parse(code)
        return True, None
    except SyntaxError as e:
        return False, str(e)
    except Exception as e:
        return False, str(e)


def fix_python_syntax(code):
    """Main function to fix Python syntax errors"""
    if not code.strip():
        return code

    original_code = code
    current_code = code

    # Apply fixes in order
    fixes = [
        remove_js_keywords,
        fix_boolean_values,
        fix_operators,
        fix_print_statements,
        fix_missing_colons,
        fix_indentation,
    ]

    for fix_func in fixes:
        try:
            current_code = fix_func(current_code)
        except Exception:
            # If any fix fails, continue with the current state
            continue

    # Validate the result
    is_valid, error = validate_syntax(current_code)

    if not is_valid:
        # If still invalid, try a more aggressive indentation fix
        try:
            current_code = fix_indentation(current_code)
            is_valid, _ = validate_syntax(current_code)
        except Exception:
            pass

    # If we still can't fix it, return the best attempt
    return current_code if current_code.strip() else original_code


def main():
    """Main entry point for the script"""
    try:
        # Read input from stdin
        input_code = sys.stdin.read()

        # Fix the code
        fixed_code = fix_python_syntax(input_code)

        # Output the result
        sys.stdout.write(fixed_code)

    except Exception as e:
        # If anything goes wrong, output the original input
        sys.stderr.write(f"Error in python-syntax-fixer: {e}\n")
        try:
            sys.stdout.write(input_code)
        except:
            sys.stdout.write("")


if __name__ == "__main__":
    main()
