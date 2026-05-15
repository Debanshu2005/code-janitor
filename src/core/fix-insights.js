const path = require("path");

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(Number(value) || 0);
}

function splitLines(text) {
  return String(text || "").split(/\r?\n/);
}

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

function getLanguageFamily(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if ([".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp"].includes(ext)) {
    return "curly";
  }
  if (ext === ".py") {
    return "python";
  }
  if ([".html", ".htm", ".xml", ".svg"].includes(ext)) {
    return "markup";
  }
  return "plain";
}

function countCommentLines(lines, family) {
  let count = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (family === "python") {
      if (
        trimmed.startsWith("#") ||
        trimmed.startsWith("\"\"\"") ||
        trimmed.startsWith("'''")
      ) {
        count += 1;
      }
      continue;
    }

    if (family === "markup") {
      if (trimmed.startsWith("<!--") || trimmed.startsWith("/*")) {
        count += 1;
      }
      continue;
    }

    if (inBlockComment) {
      count += 1;
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.startsWith("//")) {
      count += 1;
      continue;
    }

    if (trimmed.startsWith("/*")) {
      count += 1;
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
    }
  }

  return count;
}

function countDuplicateLogicalLines(lines) {
  const seen = new Map();

  for (const line of lines) {
    const normalized = line.trim().replace(/\s+/g, " ");
    if (
      normalized.length < 12 ||
      normalized.startsWith("//") ||
      normalized.startsWith("#") ||
      normalized.startsWith("/*")
    ) {
      continue;
    }
    seen.set(normalized, (seen.get(normalized) || 0) + 1);
  }

  let duplicates = 0;
  for (const count of seen.values()) {
    if (count > 1) {
      duplicates += count - 1;
    }
  }
  return duplicates;
}

function estimateMaxNestingDepth(lines, family) {
  let depth = 0;
  let maxDepth = 0;
  let previousIndent = 0;

  for (const line of lines) {
    const raw = String(line || "");
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }

    if (family === "python") {
      const indentMatch = raw.match(/^\s*/);
      const indent = indentMatch ? indentMatch[0].replace(/\t/g, "    ").length : 0;

      if (
        /^(if|elif|else|for|while|try|except|finally|with|def|class)\b/.test(trimmed)
      ) {
        if (indent > previousIndent) {
          depth += 1;
        } else if (indent < previousIndent) {
          depth = Math.max(0, depth - Math.ceil((previousIndent - indent) / 4));
        }
        previousIndent = indent;
        maxDepth = Math.max(maxDepth, depth + 1);
      } else if (indent < previousIndent) {
        depth = Math.max(0, depth - Math.ceil((previousIndent - indent) / 4));
        previousIndent = indent;
      }
      continue;
    }

    const closeCount = countMatches(trimmed, /\}/g);
    if (closeCount > 0) {
      depth = Math.max(0, depth - closeCount);
    }

    maxDepth = Math.max(maxDepth, depth);

    const openCount = countMatches(trimmed, /\{/g);
    if (openCount > 0) {
      depth += openCount;
      maxDepth = Math.max(maxDepth, depth);
    }
  }

  return maxDepth;
}

function estimateLongBlockCount(lines, family) {
  let count = 0;
  let currentSpan = 0;

  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed) {
      currentSpan = 0;
      continue;
    }

    const startsBlock =
      family === "python"
        ? /^(def|class)\b/.test(trimmed)
        : /\b(function|class|if|for|while|switch)\b/.test(trimmed);

    if (startsBlock) {
      currentSpan = 1;
      continue;
    }

    if (currentSpan > 0) {
      currentSpan += 1;
      if (currentSpan === 46) {
        count += 1;
      }
    }
  }

  return count;
}

function findSecurityIssues(text) {
  const patterns = [
    {
      kind: "unsafe-eval",
      pattern: /\beval\s*\(|\bnew Function\s*\(/i
    },
    {
      kind: "shell-exec",
      pattern:
        /\b(child_process\.(exec|execSync|spawn|spawnSync)|os\.system|subprocess\.(run|Popen|call)|Runtime\.getRuntime\(\)\.exec)\b/i
    },
    {
      kind: "hardcoded-secret",
      pattern:
        /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["'`][^"'`\n]{6,}["'`]/i
    },
    {
      kind: "html-injection",
      pattern: /\b(innerHTML|outerHTML|document\.write)\b/i
    },
    {
      kind: "insecure-http",
      pattern: /http:\/\//i
    }
  ];

  return patterns.filter((entry) => entry.pattern.test(text)).map((entry) => entry.kind);
}

function getStructuralImbalancePenalty(text) {
  const pairs = [
    ["(", ")"],
    ["{", "}"],
    ["[", "]"]
  ];
  let penalty = 0;

  for (const [open, close] of pairs) {
    const diff =
      Math.abs(countMatches(text, new RegExp(`\\${open}`, "g")) -
      countMatches(text, new RegExp(`\\${close}`, "g")));
    penalty += diff * 4;
  }

  const singleQuotes = countMatches(text, /'/g);
  const doubleQuotes = countMatches(text, /"/g);
  if (singleQuotes % 2 !== 0) {
    penalty += 6;
  }
  if (doubleQuotes % 2 !== 0) {
    penalty += 6;
  }

  if (/\b(if|while|elif)\b[^\n]*?(?<![=!<>])=(?!=)/.test(text)) {
    penalty += 12;
  }

  return penalty;
}

function formatDelta(delta) {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function findChangedRegion(beforeCode, afterCode) {
  const beforeLines = splitLines(beforeCode);
  const afterLines = splitLines(afterCode);

  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  if (start === beforeLines.length && start === afterLines.length) {
    return {
      removed: [],
      added: []
    };
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= start &&
    afterEnd >= start &&
    beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return {
    removed: beforeLines.slice(start, beforeEnd + 1),
    added: afterLines.slice(start, afterEnd + 1)
  };
}

function summarizeChangedLines(lines, prefix) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return `${prefix} none`;
  }

  return lines
    .slice(0, 3)
    .map((line) => `${prefix} ${String(line || "").trim() || "<blank>"}`)
    .join("\n");
}

function detectFixPattern(beforeCode, afterCode, syntaxMessage, family) {
  const before = String(beforeCode || "");
  const after = String(afterCode || "");

  if (
    /\b(if|while|elif)\b[^\n]*?(?<![=!<>])=(?!=)/.test(before) &&
    /\b(if|while|elif)\b[^\n]*?(==|===)/.test(after)
  ) {
    return {
      wrong:
        "A conditional used assignment syntax where a comparison was needed, which breaks evaluation.",
      why:
        "The updated condition uses a comparison operator, so the expression can be evaluated instead of trying to assign inside the check.",
      bestPractice:
        "Use `==` or `===` for comparisons and reserve `=` for assignment."
    };
  }

  if (
    family === "python" &&
    /^(if|elif|else|for|while|def|class|try|except|finally|with)\b[^\n:]*$/m.test(before) &&
    /^(if|elif|else|for|while|def|class|try|except|finally|with)\b[^\n]*:\s*$/m.test(after)
  ) {
    return {
      wrong:
        "A Python block header was missing its trailing colon, so the interpreter could not open the block correctly.",
      why:
        "Python requires a colon at the end of block-introducing statements, and the updated line now follows that rule.",
      bestPractice:
        "When writing Python control flow or function definitions, finish the header line before moving to the indented body."
    };
  }

  if (
    family === "curly" &&
    /[^\s;{}]$/m.test(before) &&
    /;\s*$/m.test(after) &&
    /expected|missing/i.test(String(syntaxMessage || ""))
  ) {
    return {
      wrong:
        "A statement terminator was missing, which left the parser unable to separate statements cleanly.",
      why:
        "Adding the terminator restores a valid statement boundary for the language parser.",
      bestPractice:
        "Keep statement endings consistent, especially in JavaScript, Java, and C-style languages."
    };
  }

  if (getStructuralImbalancePenalty(before) > getStructuralImbalancePenalty(after)) {
    return {
      wrong:
        "The file had unbalanced delimiters or quotes, which commonly causes cascading syntax errors.",
      why:
        "The updated code restores balanced structure, which lets the parser understand the surrounding code correctly.",
      bestPractice:
        "When a parser error points near the end of a file, inspect earlier braces, brackets, parentheses, and quotes."
    };
  }

  const normalizedMessage = String(syntaxMessage || "").trim();
  if (normalizedMessage) {
    return {
      wrong: `The parser reported a syntax problem: ${normalizedMessage.split(/\r?\n/)[0]}`,
      why:
        "The updated code aligns with the parser feedback and should be easier for the language toolchain to validate.",
      bestPractice:
        "After a syntax repair, rerun the language checker immediately so small mistakes do not stack up."
    };
  }

  return {
    wrong:
      "The file contained code that was not syntactically or structurally valid enough for a clean edit flow.",
    why:
      "The updated version makes the changed region more consistent and parser-friendly.",
    bestPractice:
      "Prefer small, local edits and verify them quickly so syntax issues are caught close to the source of the change."
  };
}

function analyzeCodeQuality(code, options = {}) {
  const text = String(code || "");
  const family = getLanguageFamily(options.filePath);
  const lines = splitLines(text);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const lineCount = nonEmptyLines.length || 1;
  const commentLines = countCommentLines(lines, family);
  const longLines = lines.filter((line) => line.length > 100).length;
  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const trailingWhitespace = lines.filter((line) => /\s+$/.test(line)).length;
  const tabIndented = lines.filter((line) => /^\t+/.test(line)).length;
  const duplicateLines = countDuplicateLogicalLines(lines);
  const nestingDepth = estimateMaxNestingDepth(lines, family);
  const longBlocks = estimateLongBlockCount(lines, family);
  const todoCount = countMatches(text, /\b(TODO|FIXME|XXX|HACK)\b/g);
  const securityIssues = findSecurityIssues(text);
  const syntaxKnown = options.knownSyntaxValid;
  const commentRatio = commentLines / lineCount;

  const readability = clamp(
    100 -
      longLines * 4 -
      Math.max(0, maxLineLength - 120) / 4 -
      trailingWhitespace * 3 -
      tabIndented * 2
  );
  const maintainability = clamp(
    100 - nestingDepth * 6 - longBlocks * 10 - duplicateLines * 3 - todoCount * 4
  );
  const documentation = clamp(
    lineCount <= 8 ? 85 : 30 + commentRatio * 220 - Math.max(0, longBlocks - commentLines) * 2
  );
  const security = clamp(
    100 -
      securityIssues.length * 16 -
      (securityIssues.includes("hardcoded-secret") ? 10 : 0) -
      (securityIssues.includes("unsafe-eval") ? 8 : 0)
  );

  let correctness = syntaxKnown === false ? 35 : syntaxKnown === true ? 95 : 78;
  correctness = clamp(correctness - getStructuralImbalancePenalty(text));

  const total =
    readability * 0.24 +
    maintainability * 0.22 +
    security * 0.22 +
    documentation * 0.12 +
    correctness * 0.20;

  return {
    score: round(total),
    subscores: {
      readability: round(readability),
      maintainability: round(maintainability),
      security: round(security),
      documentation: round(documentation),
      correctness: round(correctness)
    },
    notes: {
      longLines,
      nestingDepth,
      duplicateLines,
      securityIssues
    }
  };
}

function buildFixInsights(options = {}) {
  const beforeCode = String(options.beforeCode || "");
  const afterCode = String(options.afterCode || "");
  if (!beforeCode || !afterCode || beforeCode === afterCode) {
    return null;
  }

  const filePath = options.filePath || "";
  const family = getLanguageFamily(filePath);
  const beforeAnalysis = analyzeCodeQuality(beforeCode, {
    filePath,
    knownSyntaxValid: options.knownSyntaxBefore
  });
  const afterAnalysis = analyzeCodeQuality(afterCode, {
    filePath,
    knownSyntaxValid: options.knownSyntaxAfter
  });
  const changeRegion = findChangedRegion(beforeCode, afterCode);
  const pattern = detectFixPattern(
    beforeCode,
    afterCode,
    options.syntaxErrorOutput,
    family
  );
  const scoreDelta = afterAnalysis.score - beforeAnalysis.score;
  const verificationPassed = options.verificationPassed;

  return {
    filePath,
    title: path.basename(filePath || "Active file"),
    summary:
      `Quality score ${beforeAnalysis.score} -> ${afterAnalysis.score} ` +
      `(${formatDelta(scoreDelta)}).`,
    quality: {
      before: beforeAnalysis.score,
      after: afterAnalysis.score,
      delta: scoreDelta,
      beforeSubscores: beforeAnalysis.subscores,
      afterSubscores: afterAnalysis.subscores
    },
    sections: [
      {
        label: "What was wrong",
        text: pattern.wrong
      },
      {
        label: "What changed",
        text:
          `${summarizeChangedLines(changeRegion.removed, "-")}\n` +
          `${summarizeChangedLines(changeRegion.added, "+")}`
      },
      {
        label: "Why this fix is correct",
        text: verificationPassed === false
          ? `${pattern.why} The file still needs review because verification found remaining issues.`
          : verificationPassed === true
            ? `${pattern.why} The post-fix verification passed.`
            : pattern.why
      },
      {
        label: "Best practice",
        text: pattern.bestPractice
      }
    ]
  };
}

module.exports = {
  analyzeCodeQuality,
  buildFixInsights
};
