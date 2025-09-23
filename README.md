# Code Janitor 🧩

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Code Janitor** is a multi-language **syntax autocorrect & formatter** for C, Java, Python, and JavaScript. It fixes missing semicolons, unbalanced braces, and common syntax issues, including embedded C MCU-specific corrections (STM32, AVR, ESP32).

---

## Features

* Cross-language syntax fixing
* MCU-specific corrections for Embedded C
* Auto-add missing semicolons and balance braces
* CLI tool and npm package
* Uses popular formatters:

  * JavaScript → Prettier
  * Java → google-java-format
  * Python → Black
  * C/C++ → Uncrustify

---

## Installation

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

---

## Contributing

1. Fork → create branch → commit → push → PR
2. Ensure formatters & syntax fixes are consistent

---

## License

MIT License © Debanshu2005
