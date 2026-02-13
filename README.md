# 🧹 Code Janitor - The VSCode Extension You Need

![VSCode Version](https://img.shields.io/badge/VSCode-%3E%3D1.80-blue?logo=visual-studio-code)
![Node Version](https://img.shields.io/badge/Node-%3E%3D18-brightgreen?logo=node.js)
![NPM Version](https://img.shields.io/badge/NPM-%3E%3D9-red?logo=npm)
![License](https://img.shields.io/badge/License-MIT-green)
![Version](https://img.shields.io/badge/Version-0.7.6-orange)

Code Janitor is a VSCode extension that automatically **analyzes, fixes, and formats code** for multiple programming languages, including Python, C/C++/Arduino, Java, HTML and JavaScript. It ensures your code is clean, consistent, and follows proper syntax conventions with intelligent auto-correction and real-time preview.

---

## 🔹 Features

### 1. **Real-Time Auto-Correction** ✨
- **Automatic syntax fixing** as you type
- **Smart indentation** correction
- **Configurable delay** and language support
- Works with Python, JavaScript, Java, C/C++, and HTML

### 2. **Smart HTML Fixer with Auto-Preview** 🔍
- **Detailed change tracking** with line numbers
- **Automatic preview** opens after fixes are applied
- **Document structure fixes** (DOCTYPE, HTML, HEAD, BODY)
- **Embedded CSS/JS formatting** within HTML files

### 3. **Advanced Live Preview System** 🚀 ENHANCED!
- **Real-time updates** as you type - no more Alt+P needed!
- **Multi-language support**: HTML, JS/TS, Python, C, Java with console output
- **Interactive React/JSX preview** with working functionality
- **Console output capture** for JavaScript execution and debugging
- **Automatic preview** opens beside editor when changes are made

### 4. **Frontend Dependency Validation** 🔍
- **Detects missing files** before saving (CSS, JS, images)
- **Auto-creates missing files** when requested
- **Validates imports** and links in HTML/CSS/JS
- **Prevents broken dependencies** in frontend projects

### 5. Multi-language Support
- **Python** (`.py` files)
  - Fixes indentation, missing colons, and common syntax issues.
  - Converts JavaScript syntax to Python (var/let/const, braces, boolean values).
  - Formats code using `autopep8` with intelligent fallback system.
- **C / C++ / Arduino** (`.c`, `.cpp`, `.h`, `.ino` files)
  - Fixes semicolons, braces, function structure, and MCU-specific syntax.
  - Formats code using `uncrustify`.
- **Java** (`.java` files)
  - Fixes indentation, missing semicolons, and common Java syntax issues.
- **JavaScript** (`.js`, `.jsx` files)
  - Fixes semicolons, braces, and common JS syntax issues.
  - Formats using standard JS conventions.
- **HTML** (`.html` files)
   - Fixes indentation issues.
   - Fixes syntax issues like missing closing tags.
- **React/JSX** (`.jsx`, `.tsx` files)
   - Live component preview with Babel compilation.
   - Interactive React development environment.

### 6. Automatic Fixing
- Runs **before saving a file**.
- Detects language automatically.
- Applies fixes without manual intervention.

### 7. Manual Command
- Run the **Code Janitor command** from the Command Palette:

### 8. Smart HTML Protection 🛡️ NEW!
- **Well-formed detection**: Automatically identifies correct HTML to prevent corruption
- **Balanced tag validation**: Checks tag structure before applying fixes
- **Minimal processing**: Only fixes actually broken HTML
- **Auto-preview**: Shows preview for all HTML changes

### 9. AI-Enhanced Syntax Fixing 🤖 OPTIONAL!
- **Intelligent validation**: AI validates rule-based fixes to prevent syntax breaking
- **Smart decision-making**: Uses rule-based fixes when correct, AI fixes when needed
- **Multi-language support**: Enhanced fixing for Python, JavaScript, and more
- **Seamless integration**: Works transparently with Alt+D keybinding
- **Optional feature**: Requires Ollama installation (see setup below)

## Installation (via npm)

```bash
npm install -g code-janitor
```

Or clone & install locally:

```bash
git clone https://github.com/Debanshu2005/code-janitor.git
cd code-janitor
npm install
```

---

## Usage

### Run CLI

```bash
code-janitor
```


- Instantly analyzes and fixes the active file.

### Enhanced JavaScript Fixer
- **Smart syntax cleanup**: Fixes trailing commas and malformed expressions
- **Prettier integration**: Professional formatting with configurable options
- **AST-based transformations**: Structural code improvements using Babel

### Intelligent Python Formatting
- **Three-stage approach**: Inline syntax fixes, JavaScript conversion, then autopep8 formatting
- **Smart detection**: Uses autopep8 only on clean Python code to prevent corruption
- **Advanced JavaScript conversion**: Handles try-catch-finally, arrow functions, complex braces
- **Edge case mastery**: Perfect conversion of 90%+ real-world JavaScript-to-Python scenarios
- **Fallback system**: Ensures code remains functional even if formatters fail

---

## 🔹 Installation (via VS Code)

1. Clone the repository:

```bash
git clone https://github.com/Debanshu2005/code-janitor.git
cd code-janitor
```

2. Open the project in VSCode.

3. Press F5 to launch the extension in a new VSCode window (Extension Development Host).

4. Install required formatters:

Python:

```bash
pip install autopep8
```


C/C++: Install uncrustify and ensure the path is correctly set in formatter-paths.js.

**Optional - AI Enhancement:**

```bash
# Install Ollama from https://ollama.ai
# Then pull a code model:
ollama pull codellama

# AI is enabled by default. To disable:
"codeJanitor.ai.enabled": false
```

**How AI Works:**
1. Rule-based fixer runs first (fast, reliable)
2. AI validates the fix and checks for issues
3. AI only intervenes if rule-based fix breaks syntax or misses errors
4. Best of both: speed of rules + intelligence of AI

---

## Usage

1. Manual Fix


2. Open a supported file in VSCode.


3. Press Ctrl+Shift+P → Code Janitor: Fix Code or press alt+D.


4. The file will be analyzed and automatically fixed.


5. Auto-fix on Save.


6. Open any supported file.


Save (Ctrl+S) and watch Code Janitor auto-correct issues before the save completes.

---

### Format specific languages

```bash
npm run format:js     # JavaScript
npm run format:java   # Java
npm run format:py     # Python
npm run format:c      # C/C++
```

---

## Examples

**Before:**

```c
#include <stdio.h>
int main() {
    printf("Hello world")
    return 0
}
```

**After Code Janitor:**

```c
#include <stdio.h>
int main() {
    printf("Hello world");
    return 0;
}
```

**Before:**

```python
def greet()
print("Hello World")
if True
print("Yes")
```

**After Code Janitor:**

```python
def greet():
    print("Hello World")
    if True:
        print("Yes")
```

**Before:**

```javascript
function greet()
console.log("Hello World")
```

**After Code Janitor:**

```javascript
function greet() {
    console.log("Hello World");
}
```

**Preview demo:**

![WhatsApp Image 2025-12-08 at 19 50 51_99396141](https://github.com/user-attachments/assets/f2830549-e5c0-4755-8f52-1bd64361485a)



---

## 🔹 Activation commands

-  **Alt+d** : To activate the formatter
-  **Alt+l** : To lint JavaScript code
-  **Alt+v** : To validate frontend dependencies
-  **Alt+p** : For HTML/React preview feature (now supports JSX/TSX)

## 🔹 Real-Time Auto-Correction

### How It Works
1. **Real-time Detection**: Monitors document changes as you type
2. **Debounced Processing**: Waits for you to stop typing (500ms by default)
3. **Line-by-Line Fixing**: Only processes changed lines for performance
4. **Context-Aware**: Uses surrounding code to determine proper indentation

### Auto-Correction Features
**Python**: Missing colons (`if True` → `if True:`), print statements (`print "hello"` → `print("hello")`), boolean values (`true` → `True`)

**JavaScript/Java/C++**: Missing semicolons (`let x = 5` → `let x = 5;`), proper indentation

### Configuration Settings
- `codeJanitor.autoCorrection.enabled` - Enable/disable real-time fixes (default: true)
- `codeJanitor.autoCorrection.delay` - Typing delay before correction (default: 500ms)
- `codeJanitor.autoCorrection.languages` - Languages to auto-correct (default: all supported)
  
---
## 🔹 Supported File Types

| Language          | Extensions / VSCode languageId                  |
| ----------------- | ----------------------------------------------- |
| Python            | `.py` / `python`                                |
| C / C++ / Arduino | `.c`, `.cpp`, `.h`, `.ino` / `c`, `cpp`         |
| Java              | `.java` / `java`                                |
| JavaScript        | `.js`, `.jsx` / `javascript`, `javascriptreact` |
| HTML              | `.html`                                         |
| React/JSX         | `.jsx`, `.tsx` / `javascriptreact`, `typescriptreact` |


---
## 🔹 Advanced Features

1. MCU-specific C fixes for STM32, AVR, and ESP32.

2. Consecutive block-level indentation fixes for Python.

3. Fallback formatting ensures code never breaks even if external formatters fail.

4. Detailed logs for applied fixes, warnings, and errors in the console.
   
### Examples

**Python Auto-Correction:**
```python
# You type:
def test()
    if True
        var x = true
        if x === 5 {
            return null
        } else {
            print "hello"
        }

# Auto-corrected to:
def test():
    if True:
        x = True
        if x == 5:
            return None
        else:
            print("hello")
```

**JavaScript Auto-Correction:**
```javascript
// You type:
function test() {
    let x = 5,;
    console.log(x);
    return x;
}

// Auto-corrected to:
function test() {
  let x = 5;
  console.log(x);
  return x;
}
```

**React/JSX Live Preview:**
```jsx
// You type in .jsx file:
function App() {
  return (
    <div>
      <h1>Hello React!</h1>
      <button onClick={() => alert('Clicked!')}>Click Me</button>
    </div>
  );
}

// Press Alt+P → Live interactive preview opens beside editor
// Button actually works and shows alert when clicked!
```

**HTML Auto-Correction with Preview:**
```html
<!-- You type: -->
<div>
<p>Hello world
<span>Test</span>

<!-- Auto-corrected to: -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Fixed Document</title>
</head>
<body>
  <div>
    <p>Hello world</p>
    <span>Test</span>
  </div>
</body>
</html>

<!-- Changes shown: -->
<!-- • Added DOCTYPE declaration -->
<!-- • Added HTML root element -->
<!-- • Added HEAD section with meta charset -->
<!-- • Wrapped content in BODY element -->
<!-- • Applied HTML formatting and indentation -->
<!-- Preview automatically opens beside editor -->
```

### Frontend Validation Examples

**Missing Files Detection:**
```html
<!-- Extension will warn if these files don't exist -->
<link rel="stylesheet" href="styles/main.css">
<script src="js/app.js"></script>
<img src="images/logo.png" alt="Logo">
```

**Auto-Fix Options:**
- **Create Files**: Automatically creates missing CSS/JS files
- **Warning Only**: Shows warning but doesn't create files
- **Validates**: CSS @imports, JS module imports, image sources

---
## Contributing

1. Fork → create branch → commit → push → PR
   
2. Ensure formatters & syntax fixes are consistent
   
3. Fork the repository.

4. Create a branch: git checkout -b feature/my-fix.

5. Make your changes.

6. Commit your work: git commit -m "Added feature / fixed bug".

7. Push to your branch: git push origin feature/my-fix.

8. Create a Pull Request.

---
## 🔹 Advanced Features

### Python Formatter Features
**Syntax Fixes**
- **Missing colons**: Automatically adds colons after `def`, `class`, `if`, `else`, `elif`, `for`, `while`, `try`, `except`, `finally`, `with`
- **Print statements**: Converts Python 2 style `print "text"` to `print("text")`
- **Indentation**: Intelligent block-level indentation with proper nesting
- **Class/method structure**: Correct indentation for methods within classes

**JavaScript to Python Conversion**
- **Keywords**: Removes `var`, `let`, `const`, `function`, `new`
- **Braces**: Converts `{` to `:` and removes `}`
- **Operators**: Changes `===` to `==`, `!==` to `!=`
- **Values**: Converts `true`/`false` to `True`/`False`, `null`/`undefined` to `None`

**Professional Formatting**
- **autopep8 integration**: Applied to clean Python code for PEP 8 compliance
- **Conditional formatting**: Only uses autopep8 when no JavaScript artifacts remain
- **Structure preservation**: Maintains code logic while improving style

### JavaScript Formatter Features
**Syntax Improvements**
- **Trailing comma fixes**: Removes problematic trailing commas
- **Arrow function fixes**: Corrects spacing in arrow functions
- **AST transformations**: Uses Babel for structural improvements
- **Smart cleanup**: Fixes malformed syntax patterns

### HTML Formatter Features
**Change Tracking**
- **Detailed logging**: Shows exactly what was fixed with line numbers
- **Document structure**: Adds missing DOCTYPE, HTML, HEAD, BODY elements
- **Embedded content**: Formats CSS and JavaScript within HTML

**Auto-Preview**
- **Automatic display**: Opens preview beside editor when changes are made
- **Non-intrusive**: Doesn't interfere with manual Alt+P preview
- **Smart detection**: Only shows preview when actual fixes are applied

## 🔹 What's New in v0.7.6

### 🖼️ Enhanced Image Support in Live Preview
- **Universal Image Format Support**: All image formats (PNG, JPG, GIF, SVG, WebP, BMP, ICO, TIFF) now display correctly in preview
- **Local File Path Resolution**: Automatic conversion of relative and absolute image paths to webview URIs
- **CSS Background Images**: Support for `background-image: url()` references in stylesheets
- **Workspace Resource Access**: Enhanced security with proper local resource root configuration

### 🔧 Bug Fixes
- Fixed broken image display in HTML live preview
- Improved webview security with proper resource access controls
- Enhanced path resolution for nested directory structures

## 🔹 What's New in v0.7.5

### 🚀 Enhanced Live Preview System
- **Real-Time Updates**: Live preview now updates automatically as you type without pressing Alt+P
- **Multi-Language Support**: Enhanced preview for HTML, JavaScript, TypeScript, Python, C, and Java
- **Console Output Capture**: JavaScript execution shows console output in preview
- **Advanced Module Integration**: Replaced basic preview with comprehensive live-preview system

### 🛡️ Smart HTML Fixer Protection
- **Well-Formed Detection**: Automatically detects already correct HTML to prevent corruption
- **Balanced Tag Checking**: Validates tag structure before applying aggressive fixes
- **Minimal Processing**: Only applies necessary changes to preserve existing correct code
- **Auto-Preview Enabled**: Shows preview for all HTML changes including formatting

### 🔧 JavaScript Fixer Improvements
- **Enhanced Typo Detection**: Fixed typo map to catch actual JavaScript typos
- **Better Semicolon Handling**: Improved problematic semicolon removal
- **AST Transformations**: Advanced structural code improvements using Babel

## 🔹 Acknowledgements
1. https://github.com/hhatto/autopep8 --> Python Code Formatter
2. https://github.com/uncrustify/uncrustify --> C/C++ code formatter
3. https://prettier.io/ --> JavaScript/HTML/CSS formatter
4. https://github.com/inikulin/parse5 --> HTML parser
5. VSCode API & Extension Documentation

---

## License

MIT License © Debanshu2005
