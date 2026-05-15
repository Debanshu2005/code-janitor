const path = require("path");
const fs = require("fs-extra");

class FormatterPaths {
  static _findFirstExistingPath(paths) {
    return paths.find((candidate) => fs.existsSync(candidate)) || null;
  }

  static getUncrustifyPath() {
    const exeName =
      process.platform === "win32" ? "uncrustify.exe" : "uncrustify";
    const exePath = this._findFirstExistingPath([
      path.join(__dirname, "..", "..", "formatters", "uncrustify", "bin", exeName),
      path.join(__dirname, "fixers", "uncrustify-0.81.0_f-win64", "bin", exeName)
    ]);
    if (exePath) return exePath;
    return "uncrustify"; // fallback to system PATH
  }

  static getJavaFormatterPath() {
    const jarPath = this._findFirstExistingPath([
      path.join(__dirname, "fixers", "google-java-format-1.28.0-all-deps.jar"),
      path.join(
        __dirname,
        "..",
        "..",
        "formatters",
        "google-java-format",
        "google-java-format.jar"
      )
    ]);
    if (jarPath) return jarPath;
    return "google-java-format"; // fallback
  }

  static getPythonPath() {
    const exePath = this._findFirstExistingPath([
      process.platform === "win32"
        ? path.join(
            __dirname,
            "..",
            "..",
            "formatters",
            "python-formatters",
            "venv",
            "Scripts",
            "python.exe"
          )
        : path.join(
            __dirname,
            "..",
            "..",
            "formatters",
            "python-formatters",
            "venv",
            "bin",
            "python3"
          )
    ]);
    if (exePath) return exePath;
    return "python3"; // fallback
  }

  static getBlackPath() {
    // Black module inside the portable Python environment
    return "-m black";
  }

  static getAutopep8Path() {
    const autopep8Path = this._findFirstExistingPath([
      process.platform === "win32"
        ? path.join(
            __dirname,
            "..",
            "..",
            "formatters",
            "python-formatters",
            "venv",
            "Scripts",
            "autopep8.exe"
          )
        : path.join(
            __dirname,
            "..",
            "..",
            "formatters",
            "python-formatters",
            "venv",
            "bin",
            "autopep8"
          )
    ]);

    if (autopep8Path) {
      return autopep8Path;
    }

    // Fallback to system autopep8
    return "autopep8";
  }

  static getPrettierPath() {
    // Node bundled Prettier CLI
    try {
      return require.resolve("prettier/bin-prettier.js");
    } catch (err) {
      return "prettier"; // fallback
    }
  }

  static getPrettierModule() {
    // Cache the result to avoid repeated require.resolve calls
    if (!this._prettierModulePath) {
      try {
        this._prettierModulePath = require.resolve("prettier");
      } catch (err) {
        try {
          const formatterPath = path.join(
            __dirname,
            "..",
            "..",
            "formatters",
            "prettier",
            "node_modules",
            "prettier"
          );
          this._prettierModulePath = require.resolve(formatterPath);
        } catch (err2) {
          this._prettierModulePath = null;
        }
      }
    }
    return this._prettierModulePath;
  }

  // 🔥 New: HTML uses Prettier, so just point to Prettier path
  static getHtmlFormatterPath() {
    return this.getPrettierPath();
  }
}

module.exports = FormatterPaths;
