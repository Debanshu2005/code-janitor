#  Code Janitor - VSCode Extension

![VSCode Version](https://img.shields.io/badge/VSCode-%3E%3D1.80-blue?logo=visual-studio-code)
![Node Version](https://img.shields.io/badge/Node-%3E%3D18-brightgreen?logo=node.js)
![NPM Version](https://img.shields.io/badge/NPM-%3E%3D9-red?logo=npm)
![License](https://img.shields.io/badge/License-MIT-green)

Code Janitor is a VSCode extension that automatically **analyzes, fixes, and formats code** for multiple programming languages, including Python, C/C++/Arduino, Java, and JavaScript. It ensures your code is clean, consistent, and follows proper syntax conventions.

---

##  Features

### 1. Multi-language Support
- **Python** (`.py` files)
  - Fixes indentation, missing colons, and common syntax issues.
  - Formats code using `black`.
- **C / C++ / Arduino** (`.c`, `.cpp`, `.h`, `.ino` files)
  - Fixes semicolons, braces, function structure, and MCU-specific syntax.
  - Formats code using `uncrustify`.
- **Java** (`.java` files)
  - Fixes indentation, missing semicolons, and common Java syntax issues.
- **JavaScript** (`.js`, `.jsx` files)
  - Fixes semicolons, braces, and common JS syntax issues.
  - Formats using standard JS conventions.

### 2. Automatic Fixing
- Runs **before saving a file**.
- Detects language automatically.
- Applies fixes without manual intervention.

### 3. Manual Command
- Run the **Code Janitor command** from the Command Palette:


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

### Fallback Fixing
- If primary formatters fail (`black` or `uncrustify`), the extension applies **basic syntax and formatting fixes** to keep your code functional.

---

##  Installation (via VS Code)

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
pip install black
```


C/C++: Install uncrustify and ensure the path is correctly set in formatter-paths.js.

---

## Usage

1. Manual Fix


2. Open a supported file in VSCode.


3. Press Ctrl+Shift+P → Code Janitor: Fix Code or press alt+D/alt+S (any one)


4. The file will be analyzed and automatically fixed.


5. Auto-fix on Save


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

## Example

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


---
##  Supported File Types

| Language          | Extensions / VSCode languageId                  |
| ----------------- | ----------------------------------------------- |
| Python            | `.py` / `python`                                |
| C / C++ / Arduino | `.c`, `.cpp`, `.h`, `.ino` / `c`, `cpp`         |
| Java              | `.java` / `java`                                |
| JavaScript        | `.js`, `.jsx` / `javascript`, `javascriptreact` |


---
##  Advanced Features

1. MCU-specific C fixes for STM32, AVR, and ESP32.

2. Consecutive block-level indentation fixes for Python.

3. Fallback formatting ensures code never breaks even if external formatters fail.

4. Detailed logs for applied fixes, warnings, and errors in the console.
   
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
##  Acknowledgements
1. https://github.com/psf/black --> Python Code Formatter
   
2. https://github.com/uncrustify/uncrustify --> C/C++ code formatter
   
3. VSCode API & Extension Documentation

---

## License

MIT License © Debanshu2005
