const path = require("path");

// Try to find parse5 from multiple locations
let parse5;
try {
  parse5 = require("parse5");
} catch (e1) {
  try {
    parse5 = require(
      path.join(__dirname, "..", "..", "..", "node_modules", "parse5")
    );
  } catch (e2) {
    console.warn("parse5 not found, HTML parsing will be limited");
    parse5 = null;
  }
}

const FormatterPaths = require("../formatter-paths");

// Use FormatterPaths to get prettier module
let prettier;
try {
  const prettierPath = FormatterPaths.getPrettierModule();
  if (prettierPath) {
    prettier = require(prettierPath);
  } else {
    prettier = null;
  }
} catch (error) {
  console.warn(
    "prettier not found, HTML formatting will be limited:",
    error.message
  );
  prettier = null;
}

class HtmlFixer {
  constructor(code, filePath = "") {
    this.code = code;
    this.filePath = filePath;
    this.fixedCode = null;
    this.fixes = [];
    this.vscode = null;

    // Try to get VSCode API if available
    try {
      this.vscode = require("vscode");
    } catch (e) {
      // VSCode API not available (CLI mode)
    }
  }

  // Show preview if changes were made
  async showPreviewIfNeeded(result) {
    if (
      result.shouldShowPreview &&
      this.vscode &&
      this.filePath.endsWith(".html")
    ) {
      try {
        const uri = this.vscode.Uri.file(this.filePath);
        await this.vscode.commands.executeCommand("vscode.open", uri, {
          preview: true,
          viewColumn: this.vscode.ViewColumn.Beside
        });
      } catch (error) {
        console.warn("Could not show preview:", error.message);
      }
    }
    return result;
  }

  // BaseFixer methods (Kept)
  addFix(start, end, text) {
    this.fixes.push({ range: [start, end], text });
  }

  applyFixes() {
    let newCode = this.fixedCode || this.code;
    for (let i = this.fixes.length - 1; i >= 0; i--) {
      const { range, text } = this.fixes[i];
      newCode = newCode.slice(0, range[0]) + text + newCode.slice(range[1]);
    }
    return newCode;
  }

  async saveFile(content) {
    this.fixedCode = content;
    return content;
  }

  // Helper for async regex replacement (Kept)
  async replaceAsync(str, regex, asyncFn) {
    const promises = [];
    str.replace(regex, (match, ...args) => {
      const promise = asyncFn(match, ...args);
      promises.push(promise);
      return match;
    });
    const data = await Promise.all(promises);
    return str.replace(regex, () => data.shift());
  }

  // Check if HTML is already well-formed
  isWellFormedHtml(html) {
    const trimmed = html.trim();

    // If it's a complete document, check basic structure
    if (
      trimmed.includes("<!DOCTYPE") &&
      trimmed.includes("<html") &&
      trimmed.includes("</html>")
    ) {
      return this.hasBalancedTags(trimmed);
    }

    // If it's a fragment, check if tags are balanced
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      return this.hasBalancedTags(trimmed);
    }

    // If it's just text content, it's fine as is
    if (!trimmed.includes("<")) {
      return true;
    }

    return false;
  }

  // Check if HTML tags are balanced
  hasBalancedTags(html) {
    const stack = [];
    const voidTags = [
      "br",
      "hr",
      "img",
      "input",
      "meta",
      "link",
      "area",
      "base",
      "col",
      "embed",
      "source",
      "track",
      "wbr"
    ];

    // Simple regex to find tags
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    let match;

    while ((match = tagRegex.exec(html)) !== null) {
      const tagName = match[1].toLowerCase();
      const isClosing = match[0].startsWith("</");
      const isSelfClosing = match[0].endsWith("/>");

      if (voidTags.includes(tagName) || isSelfClosing) {
        continue; // Skip void and self-closing tags
      }

      if (isClosing) {
        if (stack.length === 0 || stack.pop() !== tagName) {
          return false; // Unmatched closing tag
        }
      } else {
        stack.push(tagName);
      }
    }

    return stack.length === 0; // All tags should be closed
  }

  async analyze() {
    try {
      let code = this.code;
      const original = code;
      const changeLog = [];

      // Check if HTML is already well-formed before making changes
      if (this.isWellFormedHtml(code)) {
        console.log(
          "HTML appears to be well-formed, applying minimal fixes only"
        );

        // Only apply formatting if prettier is available
        if (prettier) {
          try {
            const formatted = await prettier.format(code, {
              parser: "html",
              htmlWhitespaceSensitivity: "css",
              printWidth: 80
            });

            if (formatted !== code) {
              changeLog.push("Applied HTML formatting and indentation");
              this.fixedCode = formatted;
              await this.saveFile(formatted);

              return {
                success: true,
                formatted,
                changes: { formatting: true },
                changeLog,
                originalLength: original.length,
                formattedLength: formatted.length,
                shouldShowPreview: true // Enable auto-preview for formatting changes
              };
            }
          } catch (error) {
            console.warn(
              "Prettier formatting failed on well-formed HTML:",
              error.message
            );
          }
        }

        // Return original if no changes needed
        return {
          success: true,
          formatted: code,
          changes: {},
          changeLog: [],
          originalLength: original.length,
          formattedLength: code.length,
          shouldShowPreview: false
        };
      }

      if (!parse5) {
        console.warn("parse5 not available, using basic HTML fixes");
        const basicFixed = this.applyBasicHtmlFixes(code);
        this.fixedCode = basicFixed;
        await this.saveFile(basicFixed);

        if (original !== basicFixed) {
          changeLog.push("Applied basic HTML indentation fixes");
        }

        return {
          success: true,
          formatted: basicFixed,
          changes: { basic: true },
          changeLog,
          originalLength: original.length,
          formattedLength: basicFixed.length,
          shouldShowPreview: changeLog.length > 0
        };
      }

      // Track document structure changes
      const originalHasDoctype = /<!DOCTYPE\s+html>/i.test(code);
      const originalHasHtml = /<html[\s>]/i.test(code);
      const originalHasHead = /<head[\s>]/i.test(code);
      const originalHasBody = /<body[\s>]/i.test(code);

      code = this.wrapInDocumentStructure(code);

      if (!originalHasDoctype && /<!DOCTYPE\s+html>/i.test(code)) {
        changeLog.push("Added DOCTYPE declaration");
      }
      if (!originalHasHtml && /<html[\s>]/i.test(code)) {
        changeLog.push("Added HTML root element");
      }
      if (!originalHasHead && /<head[\s>]/i.test(code)) {
        changeLog.push("Added HEAD section with meta charset");
      }
      if (!originalHasBody && /<body[\s>]/i.test(code)) {
        changeLog.push("Wrapped content in BODY element");
      }

      const document = parse5.parse(code, { sourceCodeLocationInfo: true });
      const fixes = this.fixNodeChildren(document, changeLog);
      const repaired = parse5.serialize(document);

      // Fix embedded content and track changes
      const finalCode = await this.fixEmbeddedContentWithParsing(
        repaired,
        changeLog
      );

      // Format final HTML with Prettier
      let formatted = finalCode;
      if (prettier) {
        try {
          const prettierFormatted = await prettier.format(finalCode, {
            parser: "html",
            htmlWhitespaceSensitivity: "css",
            printWidth: 80
          });
          if (prettierFormatted !== finalCode) {
            changeLog.push("Applied HTML formatting and indentation");
            formatted = prettierFormatted;
          }
        } catch (error) {
          console.warn("Prettier HTML formatting failed:", error.message);
          formatted = finalCode;
        }
      }

      this.fixedCode = formatted;
      await this.saveFile(formatted);

      return {
        success: true,
        formatted,
        changes: fixes,
        changeLog,
        originalLength: original.length,
        formattedLength: formatted.length,
        shouldShowPreview: changeLog.length > 0
      };
    } catch (err) {
      console.error("Error fixing HTML:", err);

      // Try basic fixes as fallback
      try {
        const basicFixed = this.applyBasicHtmlFixes(original);
        const changeLog = [
          "Applied basic HTML fixes (advanced parsing failed)"
        ];

        return {
          success: true,
          formatted: basicFixed,
          changes: { basic: true, error: err.message },
          changeLog,
          originalLength: original.length,
          formattedLength: basicFixed.length,
          shouldShowPreview: false,
          warning:
            "HTML Syntax Error: The code could not be fully repaired. Visual preview may be broken."
        };
      } catch (basicErr) {
        return {
          success: false,
          error: err.message,
          warning:
            "HTML Syntax Error: The code could not be fully repaired. Visual preview may be broken."
        };
      }
    }
  }

  // --- Embedded Content Fixes (Updated JS with Pre-Cleanup) ---

  async fixEmbeddedContentWithParsing(html, changeLog = []) {
    let cssFixed = false;
    let jsFixed = false;

    // 1. Fix CSS in style tags
    html = await this.replaceAsync(
      html,
      /<style[^>]*>([\s\S]*?)<\/style>/gi,
      async (match, cssContent) => {
        const fixedCSS = await this.fixCSSWithParsing(cssContent);
        if (fixedCSS !== cssContent) {
          cssFixed = true;
        }
        return match.replace(cssContent, fixedCSS);
      }
    );

    if (cssFixed) {
      changeLog.push("Fixed and formatted CSS in <style> tags");
    }

    // 2. Fix JavaScript in script tags
    html = await this.replaceAsync(
      html,
      /<script[^>]*>([\s\S]*?)<\/script>/gi,
      async (match, jsContent) => {
        if (
          !match.includes(" src=") &&
          !match.includes('type="module"') &&
          !match.includes("type='module'")
        ) {
          const fixedJS = await this.fixJavaScriptWithParsing(jsContent);
          if (fixedJS !== jsContent) {
            jsFixed = true;
          }
          return match.replace(jsContent, fixedJS);
        }
        return match;
      }
    );

    if (jsFixed) {
      changeLog.push("Fixed and formatted JavaScript in <script> tags");
    }

    return html;
  }

  // Basic HTML fixes without parse5
  applyBasicHtmlFixes(html) {
    let fixed = html;

    // Basic indentation fix
    const lines = fixed.split("\n");
    let indentLevel = 0;
    const indentedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";

      if (trimmed.startsWith("</")) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      const indented = "  ".repeat(indentLevel) + trimmed;

      if (
        trimmed.startsWith("<") &&
        !trimmed.startsWith("</") &&
        !trimmed.endsWith("/>") &&
        !this.isVoidElementTag(trimmed)
      ) {
        indentLevel++;
      }

      return indented;
    });

    return indentedLines.join("\n");
  }

  // Helper to get line number information
  getLineNumber(node) {
    if (node.sourceCodeLocation && node.sourceCodeLocation.startLine) {
      return ` (line ${node.sourceCodeLocation.startLine})`;
    }
    return "";
  }

  isVoidElementTag(tagLine) {
    const voidTags = ["br", "hr", "img", "input", "meta", "link"];
    return voidTags.some((tag) => tagLine.includes(`<${tag}`));
  }

  // NEW: Robust CSS fixing using Prettier (Kept)
  async fixCSSWithParsing(css) {
    if (!prettier) {
      console.warn("prettier not available, returning original CSS");
      return css;
    }

    try {
      const fixedCSS = await prettier.format(css, {
        parser: "css",
        printWidth: 80
      });
      return fixedCSS.trim();
    } catch (error) {
      console.warn(
        "Prettier CSS formatting failed. Returning original content.",
        error.message
      );
      return css;
    }
  }

  // UPDATED: Robust JavaScript fixing using Prettier with PRE-CLEANUP
  async fixJavaScriptWithParsing(js) {
    // --- Aggressive Pre-Cleanup Stage ---
    // Target the highly damaged code where semicolons break syntax before parsing.
    let cleanedJS = js.trim();

    // 1. Remove semicolons directly followed by a newline, or following a comma.
    // This addresses the common Folium errors like 'arg,' and '; newline'.
    cleanedJS = cleanedJS.replace(/,\s*;/g, ",");
    cleanedJS = cleanedJS.replace(/;(\s*\n)/g, "$1");

    // 2. Remove semicolons directly following an open parenthesis or closing parenthesis/brace.
    // This fixes errors like 'L.map(', and, '});'.
    cleanedJS = cleanedJS.replace(/\(\s*;/g, "(");
    cleanedJS = cleanedJS.replace(/;(\s*[\)\}])/g, "$1");

    if (!prettier) {
      console.warn("prettier not available, returning pre-cleaned JS");
      return cleanedJS;
    }

    // --- Safe Prettier Formatting Stage ---
    try {
      // Prettier formats the now minimally valid code correctly.
      const fixedJS = await prettier.format(cleanedJS, {
        parser: "babel",
        printWidth: 80
      });
      return fixedJS.trim();
    } catch (error) {
      console.warn(
        "Prettier JS formatting failed. Returning pre-cleaned content.",
        error.message
      );
      // Fall back to the pre-cleaned version if Prettier fails.
      return cleanedJS;
    }
  }

  // --- HTML Structure Fixes (Kept) ---

  wrapInDocumentStructure(html) {
    let wrapped = html.trim();
    const hasDoctype = /<!DOCTYPE\s+html>/i.test(wrapped);
    const hasHtmlTag = /<html[\s>]/i.test(wrapped);
    const hasHeadTag = /<head[\s>]/i.test(wrapped);
    const hasBodyTag = /<body[\s>]/i.test(wrapped);

    const isFullDocument = hasDoctype && hasHtmlTag && hasHeadTag && hasBodyTag;
    const isPartialFragment = !hasHtmlTag && !hasBodyTag;

    console.log("Document, analysis:", {
      hasDoctype,
      hasHtmlTag,
      hasHeadTag,
      hasBodyTag,
      isFullDocument,
      isPartialFragment
    });

    if (isPartialFragment) {
      console.log("Wrapping partial HTML in document structure");
      wrapped = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Fixed Document</title>
</head>
<body>
${wrapped}
</body>
</html>`;
    }

    return wrapped;
  }

  fixNodeChildren(
    node,
    changeLog = [],
    fixes = { addedClosures: 0, fixedVoidElements: 0, fixedNesting: 0 }
  ) {
    if (!node.childNodes || !Array.isArray(node.childNodes)) {
      return fixes;
    }

    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      this.fixNodeChildren(child, changeLog, fixes);

      if (child.tagName && !this.isVoidElement(child.tagName)) {
        if (child.childNodes && this.hasUnclosedText(child)) {
          fixes.addedClosures++;
          const lineInfo = this.getLineNumber(child);
          changeLog.push(
            `Fixed unclosed <${child.tagName}> element${lineInfo}`
          );
        }
      }

      if (child.tagName && this.isVoidElement(child.tagName)) {
        if (child.childNodes && child.childNodes.length > 0) {
          fixes.fixedVoidElements++;
          const lineInfo = this.getLineNumber(child);
          changeLog.push(
            `Removed invalid content from void <${child.tagName}> element${lineInfo}`
          );
          child.childNodes = [];
        }
      }

      const nestingFix = this.fixNestingIssues(node, child, i);
      if (nestingFix) {
        fixes.fixedNesting++;
        const lineInfo = this.getLineNumber(child);
        changeLog.push(
          `Fixed invalid nesting: <${child.tagName}> inside <${node.tagName}>${lineInfo}`
        );
      }
    }

    return fixes;
  }

  hasUnclosedText(node) {
    if (node.childNodes) {
      for (const child of node.childNodes) {
        if (child.nodeName === "#text" && child.value) {
          const text = child.value.trim();
          if (text.includes("<") || text.includes(">")) {
            return true;
          }
        }
      }
    }
    return false;
  }

  isVoidElement(tagName) {
    const voidElements = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "source",
      "track",
      "wbr"
    ]);
    return voidElements.has(tagName.toLowerCase());
  }

  fixNestingIssues(parent, child, index) {
    if (!child.tagName || !parent.tagName) {
      return false;
    }

    const childTag = child.tagName.toLowerCase();
    const parentTag = parent.tagName.toLowerCase();
    const invalidNesting = this.checkInvalidNesting(parentTag, childTag);

    if (invalidNesting) {
      console.warn(`Invalid, nesting: <${childTag}> inside <${parentTag}>`);
      return true;
    }

    return false;
  }

  checkInvalidNesting(parentTag, childTag) {
    const nestingRules = {
      ul: ["li"],
      ol: ["li"],
      table: ["thead", "tbody", "tfoot", "tr"],
      thead: ["tr"],
      tbody: ["tr"],
      tfoot: ["tr"],
      tr: ["th", "td"]
    };

    if (nestingRules[parentTag]) {
      return !nestingRules[parentTag].includes(childTag);
    }

    return false;
  }
}

module.exports = HtmlFixer;
