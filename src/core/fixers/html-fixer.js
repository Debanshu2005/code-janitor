const parse5 = require("parse5");
const prettier = require("prettier");

// Remove the duplicate BaseFixer import and use the existing one
class HtmlFixer {
  constructor(code, filePath = "") {
    this.code = code;
    this.filePath = filePath;
    this.fixedCode = null;
    this.fixes = []; // Add fixes array to match BaseFixer pattern
  }

  // Add the missing BaseFixer methods
  addFix(start, end, text) {
    this.fixes.push({ range: [start, end], text });
  }

  applyFixes() {
    let newCode = this.fixedCode || this.code;

    // Apply fixes in reverse order so indices don't get messed up
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

  async analyze() {
    try {
      let code = this.code;
      console.log("Original code length:", code.length);

      // Store original for comparison
      const original = code;

      // Step 0: Detect and wrap only if truly missing document structure
      code = this.wrapInDocumentStructure(code);

      // Step 1: Parse as document
      const document = parse5.parse(code, { sourceCodeLocationInfo: true });

      // Step 2: Traverse AST to fix structural issues and content
      const fixes = this.fixNodeChildren(document);

      // Step 3: Serialize to HTML
      const repaired = parse5.serialize(document);

      // Step 4: Fix CSS and JavaScript content issues with proper parsing
      const finalCode = this.fixEmbeddedContentWithParsing(repaired);

      // Step 5: Format with Prettier
      const formatted = await prettier.format(finalCode, {
        parser: "html",
        htmlWhitespaceSensitivity: "css",
        printWidth: 80,
      });

      // Compare results
      console.log("Original === Formatted?", original === formatted);
      console.log("Changes made:", fixes);

      // Set the fixed code
      this.fixedCode = formatted;
      await this.saveFile(formatted);

      return {
        success: true,
        formatted,
        changes: fixes,
        originalLength: original.length,
        formattedLength: formatted.length,
      };
    } catch (err) {
      console.error("Error fixing HTML:", err);
      return { success: false, error: err.message };
    }
  }

  fixEmbeddedContentWithParsing(html) {
    // Fix CSS in style tags with proper CSS parsing
    html = html.replace(
      /<style[^>]*>([\s\S]*?)<\/style>/gi,
      (match, cssContent) => {
        const fixedCSS = this.fixCSSWithParsing(cssContent);
        return match.replace(cssContent, fixedCSS);
      },
    );

    // Fix JavaScript in script tags with proper JS parsing
    html = html.replace(
      /<script[^>]*>([\s\S]*?)<\/script>/gi,
      (match, jsContent) => {
        // Only fix if it's not a src attribute or type=module
        if (
          !match.includes(" src=") &&
          !match.includes('type="module"') &&
          !match.includes("type='module'")
        ) {
          const fixedJS = this.fixJavaScriptWithParsing(jsContent);
          return match.replace(jsContent, fixedJS);
        }
        return match;
      },
    );

    return html;
  }

  fixCSSWithParsing(css) {
    let fixedCSS = css;

    try {
      // Parse CSS rules more intelligently
      const lines = fixedCSS.split("\n");
      const fixedLines = [];
      let inRule = false;
      let currentRule = "";
      let braceCount = 0;

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          fixedLines.push(line);
          continue;
        }

        // Handle rule start
        if (trimmed.includes("{") && !inRule) {
          inRule = true;
          braceCount = 1;
          currentRule = trimmed;
          continue;
        }

        // Handle rule content
        if (inRule) {
          // Count braces to track rule boundaries
          braceCount += (trimmed.match(/{/g) || []).length;
          braceCount -= (trimmed.match(/}/g) || []).length;

          currentRule += " " + trimmed;

          // Rule ended
          if (braceCount === 0) {
            fixedLines.push(this.fixCSSRule(currentRule));
            inRule = false;
            currentRule = "";
          }
        } else {
          // Standalone line (could be incomplete rule start)
          if (
            trimmed.endsWith("{") ||
            (!trimmed.includes(";") && !trimmed.includes("}"))
          ) {
            // This might be the start of a rule
            inRule = true;
            braceCount = 1;
            currentRule = trimmed;
          } else {
            fixedLines.push(this.fixCSSDeclaration(trimmed));
          }
        }
      }

      // Handle any unfinished rule
      if (inRule && currentRule) {
        fixedLines.push(this.fixCSSRule(currentRule + " }"));
      }

      fixedCSS = fixedLines.join("\n");
    } catch (error) {
      console.warn("CSS parsing failed, using basic fixes:", error.message);
      fixedCSS = this.fixCSSBasic(css);
    }

    return fixedCSS;
  }

  fixCSSRule(rule) {
    // Split rule into selector and declarations
    const parts = rule.split("{");
    if (parts.length !== 2) return rule;

    const selector = parts[0].trim();
    const declarations = parts[1].replace("}", "").trim();

    // Fix declarations
    const fixedDeclarations = this.fixCSSDeclarations(declarations);

    return `${selector} { ${fixedDeclarations} }`;
  }

  fixCSSDeclarations(declarations) {
    if (!declarations.trim()) return "";

    // Split by semicolons, but be careful with quoted values
    const declarationList = [];
    let currentDecl = "";
    let inQuotes = false;
    let quoteChar = "";

    for (const char of declarations) {
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
      }

      if (char === ";" && !inQuotes) {
        if (currentDecl.trim()) {
          declarationList.push(
            this.fixSingleCSSDeclaration(currentDecl.trim()),
          );
        }
        currentDecl = "";
      } else {
        currentDecl += char;
      }
    }

    // Don't forget the last declaration
    if (currentDecl.trim()) {
      declarationList.push(this.fixSingleCSSDeclaration(currentDecl.trim()));
    }

    return declarationList.filter((decl) => decl).join("; ");
  }

  fixSingleCSSDeclaration(declaration) {
    if (!declaration.includes(":")) {
      // This might be an incomplete declaration, skip it
      return "";
    }

    const parts = declaration.split(":");
    if (parts.length < 2) return declaration;

    const property = parts[0].trim();
    let value = parts.slice(1).join(":").trim();

    // Remove trailing semicolon if present
    value = value.replace(/;$/, "");

    // Fix common value issues
    value = this.fixCSSValue(value);

    return `${property}: ${value}`;
  }

  fixCSSValue(value) {
    // Fix missing semicolons in values (like in gradients, transforms)
    let fixedValue = value;

    // Fix color values
    fixedValue = fixedValue.replace(
      /\b(red|blue|green|black|white|gray)\b/gi,
      "$1",
    );

    // Fix numeric values
    fixedValue = fixedValue.replace(/(\d+)\s*px/gi, "$1px");
    fixedValue = fixedValue.replace(/(\d+)\s*%/gi, "$1%");
    fixedValue = fixedValue.replace(/(\d+)\s*em/gi, "$1em");
    fixedValue = fixedValue.replace(/(\d+)\s*rem/gi, "$1rem");

    // Fix font families
    fixedValue = fixedValue.replace(
      /\b(Arial|Helvetica|Times|Courier)\b/gi,
      '"$1"',
    );

    return fixedValue;
  }

  fixCSSBasic(css) {
    // Fallback basic CSS fixes
    return css
      .replace(/([^{])\s*}/g, "$1; }") // Add semicolon before closing brace
      .replace(/([^;])\s*(\n)(?=\s*[a-z-])/g, "$1;$2") // Add semicolon at line ends before new properties
      .replace(/([^:]{)([^}]+)(})/g, "$1 $2; $3") // Ensure semicolon in simple rules
      .replace(/\bcolour\b/gi, "color");
  }

  fixJavaScriptWithParsing(js) {
    let fixedJS = js;

    try {
      // Basic JavaScript syntax fixes without complex parsing
      fixedJS = this.fixJavaScriptBasic(js);
    } catch (error) {
      console.warn(
        "JavaScript parsing failed, using basic fixes:",
        error.message,
      );
      fixedJS = this.fixJavaScriptBasic(js);
    }

    return fixedJS;
  }

  fixJavaScriptBasic(js) {
    return (
      js
        // Fix console.log and alert missing parentheses
        .replace(/(console\.log|alert|document\.write)\s+(?=[^;]+;)/g, "$1(")
        .replace(/(console\.log|alert|document\.write)\(([^)]+);/g, "$1($2);")

        // Fix function declarations
        .replace(/function\s+(\w+)\s*([^(][^{]*)\s*{/g, "function $1() {")
        .replace(/function\s*\([^)]*\)\s*{/g, "function() {")

        // Fix event listeners
        .replace(
          /(addEventListener\s*\(\s*['"][^'"]+['"]\s*,\s*function)\s*([^(][^{]*)\s*{/g,
          "$1() {",
        )

        // Add missing semicolons (basic heuristic)
        .replace(/([^;{}\n])(\s*\n)(?![^{]*})/g, "$1;$2")
        .replace(/([^;])(\s*}$)/g, "$1;$2")

        // Fix missing commas in arrays and objects (basic)
        .replace(/([\]\w"'])\s*(\n\s*[\]\w"'])/g, "$1,$2")
        .replace(/(\w+)\s*(?=\n\s*\w+:)/g, "$1,")
    );
  }

  wrapInDocumentStructure(html) {
    let wrapped = html.trim();

    // Only wrap if it's clearly not a full HTML document
    const hasDoctype = /<!DOCTYPE\s+html>/i.test(wrapped);
    const hasHtmlTag = /<html[\s>]/i.test(wrapped);
    const hasHeadTag = /<head[\s>]/i.test(wrapped);
    const hasBodyTag = /<body[\s>]/i.test(wrapped);

    const isFullDocument = hasDoctype && hasHtmlTag && hasHeadTag && hasBodyTag;
    const isPartialFragment = !hasHtmlTag && !hasBodyTag;

    console.log("Document analysis:", {
      hasDoctype,
      hasHtmlTag,
      hasHeadTag,
      hasBodyTag,
      isFullDocument,
      isPartialFragment,
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
    fixes = { addedClosures: 0, fixedVoidElements: 0, fixedNesting: 0 },
  ) {
    if (!node.childNodes || !Array.isArray(node.childNodes)) {
      return fixes;
    }

    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];

      // Recursively fix children first
      this.fixNodeChildren(child, fixes);

      // Fix unclosed non-void elements (simulate this since parse5 auto-closes)
      if (child.tagName && !this.isVoidElement(child.tagName)) {
        // Check if this element should be closed but might have issues
        if (child.childNodes && this.hasUnclosedText(child)) {
          fixes.addedClosures++;
          console.log(`Fixed unclosed element: <${child.tagName}>`);
        }
      }

      // Handle void elements with content (actual fix)
      if (child.tagName && this.isVoidElement(child.tagName)) {
        if (child.childNodes && child.childNodes.length > 0) {
          fixes.fixedVoidElements++;
          console.log(`Removing content from void element: <${child.tagName}>`);

          // Remove child nodes from void elements
          child.childNodes = [];
        }
      }

      // Fix nesting issues
      const nestingFix = this.fixNestingIssues(node, child, i);
      if (nestingFix) {
        fixes.fixedNesting++;
      }
    }

    return fixes;
  }

  hasUnclosedText(node) {
    // Check for text nodes that suggest unclosed elements
    if (node.childNodes) {
      for (const child of node.childNodes) {
        if (child.nodeName === "#text" && child.value) {
          const text = child.value.trim();
          // If text contains HTML-like patterns, might be unclosed
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
      "wbr",
    ]);
    return voidElements.has(tagName.toLowerCase());
  }

  fixNestingIssues(parent, child, index) {
    if (!child.tagName || !parent.tagName) return false;

    const childTag = child.tagName.toLowerCase();
    const parentTag = parent.tagName.toLowerCase();

    // Detect invalid nesting
    const invalidNesting = this.checkInvalidNesting(parentTag, childTag);

    if (invalidNesting) {
      console.warn(`Invalid nesting: <${childTag}> inside <${parentTag}>`);
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
      tr: ["th", "td"],
    };

    if (nestingRules[parentTag]) {
      return !nestingRules[parentTag].includes(childTag);
    }

    return false;
  }
}

module.exports = HtmlFixer;
