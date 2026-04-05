const FormatterPaths = require("../formatter-paths");
const BaseFixer = require("./base-fixer");

let parser;
try {
  parser = require("@babel/parser");
} catch (error) {
  console.warn(
    "Babel parser not found, JavaScript syntax validation will be limited:",
    error.message
  );
  parser = null;
}

let prettier;
try {
  const prettierPath = FormatterPaths.getPrettierModule();
  prettier = prettierPath ? require(prettierPath) : null;
} catch (error) {
  console.warn(
    "Prettier not found, JavaScript formatting will be limited:",
    error.message
  );
  prettier = null;
}

class JavaScriptFixer extends BaseFixer {
  async analyze() {
    console.log("Analyzing JavaScript file:", this.filePath);

    const originalCode = this.code;
    if (!originalCode || !originalCode.trim()) {
      return {
        success: true,
        fixedCode: originalCode,
        appliedFixes: 0,
        message: "Empty file."
      };
    }

    try {
      const originalIsValid = this._isParsable(originalCode);
      let candidateCode = originalCode;

      if (originalIsValid) {
        candidateCode = await this._formatIfPossible(originalCode);
      } else {
        candidateCode = await this._repairInvalidCode(originalCode);
      }

      if (
        candidateCode &&
        candidateCode !== originalCode &&
        (originalIsValid || this._isParsable(candidateCode))
      ) {
        this.addFix(0, originalCode.length, candidateCode);
      } else {
        candidateCode = originalCode;
      }

      return {
        success: true,
        fixedCode: candidateCode,
        appliedFixes: candidateCode === originalCode ? 0 : 1,
        message:
          candidateCode === originalCode
            ? "No safe JavaScript fixes found."
            : "Applied safe JavaScript fixes."
      };
    } catch (error) {
      console.error(`Error during JavaScript analysis: ${error.message}`);
      return {
        success: false,
        fixedCode: originalCode,
        appliedFixes: 0,
        message: error.message
      };
    }
  }

  _getParserPlugins() {
    return [
      "jsx",
      "typescript",
      "classProperties",
      "classPrivateProperties",
      "classPrivateMethods",
      "dynamicImport",
      "optionalChaining",
      "nullishCoalescingOperator",
      "objectRestSpread",
      "topLevelAwait",
      "decorators-legacy"
    ];
  }

  _getParserOptions() {
    return {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: this._getParserPlugins()
    };
  }

  _isParsable(code) {
    if (!parser) {
      return true;
    }

    try {
      parser.parse(code, this._getParserOptions());
      return true;
    } catch {
      return false;
    }
  }

  async _repairInvalidCode(code) {
    const attempts = [];
    const addAttempt = (value) => {
      if (value && !attempts.includes(value)) {
        attempts.push(value);
      }
    };

    addAttempt(this._applySafeSyntaxRepairs(code));
    addAttempt(this._normalizeBrokenPunctuation(code));
    addAttempt(
      this._normalizeBrokenPunctuation(this._applySafeSyntaxRepairs(code))
    );

    for (const attempt of attempts) {
      if (!attempt || attempt === code) {
        continue;
      }

      if (!this._isParsable(attempt)) {
        continue;
      }

      return this._formatIfPossible(attempt);
    }

    return code;
  }

  _applySafeSyntaxRepairs(code) {
    let processed = code;

    processed = processed.replace(/=\s*>/g, "=>");
    processed = processed.replace(/\+\s+\+/g, "++");
    processed = processed.replace(/-\s+-/g, "--");

    processed = processed.replace(/,\s*;/g, ",");
    processed = processed.replace(/\(\s*;/g, "(");
    processed = processed.replace(/;(\s*[)}\]])/g, "$1");

    processed = processed.replace(/,\s*([)}\]])/g, "$1");
    processed = processed.replace(/\{\s*,/g, "{");
    processed = processed.replace(/\[\s*,/g, "[");

    return processed;
  }

  _normalizeBrokenPunctuation(code) {
    const lines = code.split("\n");
    const fixedLines = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        fixedLines.push(line);
        continue;
      }

      if (
        /^(const|let|var|return|throw|yield)\b/.test(trimmed) &&
        !/[;,{([]\s*$/.test(trimmed) &&
        index < lines.length - 1
      ) {
        const nextTrimmed = lines[index + 1].trim();
        if (
          nextTrimmed &&
          /^[\]),}]/.test(nextTrimmed) &&
          !trimmed.endsWith(",")
        ) {
          fixedLines.push(`${line},`);
          continue;
        }
      }

      fixedLines.push(line);
    }

    return fixedLines.join("\n");
  }

  async _formatIfPossible(code) {
    if (!prettier) {
      return code;
    }

    const parserName =
      this.filePath.endsWith(".ts") || this.filePath.endsWith(".tsx")
        ? "typescript"
        : "babel";

    try {
      const config =
        this.filePath && prettier.resolveConfig
          ? (await prettier.resolveConfig(this.filePath)) || {}
          : {};

      return await prettier.format(code, {
        ...config,
        filepath: this.filePath || undefined,
        parser: config.parser || parserName,
        semi: typeof config.semi === "boolean" ? config.semi : false,
        trailingComma: config.trailingComma || "none",
        printWidth: config.printWidth || 80
      });
    } catch (error) {
      console.warn(
        `Prettier failed for ${this.filePath || "buffer"}: ${error.message}`
      );
      return code;
    }
  }

  getFixedCode() {
    return this.applyFixes();
  }
}

module.exports = JavaScriptFixer;
