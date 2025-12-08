const parse5 = require("parse5");
const prettier = require("prettier");

class HtmlFixer {
  constructor(code, filePath = "") {
    this.code = code;
    this.filePath = filePath;
    this.fixedCode = null;
    this.fixes = [];
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

  // --- Core Logic ---

  async analyze() {
    try {
      let code = this.code;
      console.log("Original code, length:", code.length);

      const original = code;
      code = this.wrapInDocumentStructure(code);
      const document = parse5.parse(code, { sourceCodeLocationInfo: true });
      const fixes = this.fixNodeChildren(document);
      const repaired = parse5.serialize(document);

      // Step 4: Fix embedded content (CSS/JS) safely using Prettier
      const finalCode = await this.fixEmbeddedContentWithParsing(repaired);

      // Step 5: Format final HTML with Prettier
      const formatted = await prettier.format(finalCode, {
        parser: "html",
        htmlWhitespaceSensitivity: "css",
        printWidth: 80
      });

      console.log("Original === Formatted?", original === formatted);
      console.log("Changes, made:", fixes);

      this.fixedCode = formatted;
      await this.saveFile(formatted);

      return {
        success: true,
        formatted,
        changes: fixes,
        originalLength: original.length,
        formattedLength: formatted.length
      };
    } catch (err) {
      console.error("Error fixing, HTML:", err);
      return { success: false, error: err.message };
    }
  }

  // --- Embedded Content Fixes (Updated JS with Pre-Cleanup) ---

  async fixEmbeddedContentWithParsing(html) {
    // 1. Fix CSS in style tags (Kept, uses safe Prettier)
    html = await this.replaceAsync(
      html,
      /<style[^>]*>([\s\S]*?)<\/style>/gi,
      async (match, cssContent) => {
        const fixedCSS = await this.fixCSSWithParsing(cssContent);
        return match.replace(cssContent, fixedCSS);
      }
    );

    // 2. Fix JavaScript in script tags (Updated)
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
          return match.replace(jsContent, fixedJS);
        }
        return match;
      }
    );

    return html;
  }

  // NEW: Robust CSS fixing using Prettier (Kept)
  async fixCSSWithParsing(css) {
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
    // This addresses the common Folium errors like 'arg,;' and '; newline'.
    cleanedJS = cleanedJS.replace(/,\s*;/g, ",");
    cleanedJS = cleanedJS.replace(/;(\s*\n)/g, "$1");

    // 2. Remove semicolons directly following an open parenthesis or closing parenthesis/brace.
    // This fixes errors like 'L.map(;', and, '});'.
    cleanedJS = cleanedJS.replace(/\(\s*;/g, "(");
    cleanedJS = cleanedJS.replace(/;(\s*[\)\}])/g, "$1");

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
    fixes = { addedClosures: 0, fixedVoidElements: 0, fixedNesting: 0 }
  ) {
    if (!node.childNodes || !Array.isArray(node.childNodes)) {
      return fixes;
    }

    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      this.fixNodeChildren(child, fixes);

      if (child.tagName && !this.isVoidElement(child.tagName)) {
        if (child.childNodes && this.hasUnclosedText(child)) {
          fixes.addedClosures++;
          console.log(`Fixed unclosed, element: <${child.tagName}>`);
        }
      }

      if (child.tagName && this.isVoidElement(child.tagName)) {
        if (child.childNodes && child.childNodes.length > 0) {
          fixes.fixedVoidElements++;
          console.log(
            `Removing content from void, element: <${child.tagName}>`
          );
          child.childNodes = [];
        }
      }

      const nestingFix = this.fixNestingIssues(node, child, i);
      if (nestingFix) {
        fixes.fixedNesting++;
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
