const fs = require('fs');
let content = fs.readFileSync('src/ai-agent/agent.js', 'utf8');

const oldValidate = `  validateCommand(command) {
    const raw = String(command || "").trim();
    const normalized = raw.toLowerCase();

    if (!normalized) {
      return { allowed: false, reason: "Empty command" };
    }

    if (/[\\r\\n]/.test(raw)) {
      return {
        allowed: false,
        reason: "Use a single-line project-scoped command"
      };
    }

    const blockedPatterns = [
      /\\bnpm\\s+install\\s+-g\\b/,
      /\\bnpm\\s+i\\s+-g\\b/,
      /\\bnpm(?:\\.cmd)?\\s+(?:exec|install|update|audit|cache|config)\\b/,
      /\\bpip(?:3)?\\s+install\\b/,
      /\\bcargo\\s+install\\b/,
      /\\bgo\\s+install\\b/,
      /\\byarn\\s+global\\b/,
      /\\byarn(?:\\.cmd)?\\s+(?:add|install|dlx|global|set|config|npm)\\b/,
      /\\bpnpm\\s+add\\s+-g\\b/,
      /\\bpnpm(?:\\.cmd)?\\s+(?:add|install|dlx|setup|env)\\b/,
      /\\bnpx(?:\\.cmd)?\\b(?!\\s+--no-install\\b)/,
      /\\bchoco\\s+install\\b/,
      /\\bwinget\\s+install\\b/,
      /\\bapt(?:-get)?\\s+install\\b/,
      /\\bcurl\\b/,
      /\\bwget\\b/,
      /\\binvoke-webrequest\\b/,
      /\\birm\\b/,
      /\\bnode\\s+-e\\b/,
      /\\bnpm\\s+(?:publish|unpublish|login|logout|adduser|owner|access|team|org|token|profile|dist-tag|deprecate|hook)\\b/,
      /\\byarn\\s+(?:publish|login|logout|npm\\s+publish|npm\\s+login|npm\\s+logout)\\b/,
      /\\bpnpm\\s+publish\\b/,
      /\\bgit\\s+(?:clone|push|pull|fetch|checkout|switch|restore|reset|merge|rebase|stash|tag|add|commit|cherry-pick|am|apply|remote)\\b/,
      /\\bdel\\b/,
      /\\brm\\b/,
      /\\brmdir\\b/,
      /^format(?:\\s|$)/
    ];

    if (blockedPatterns.some((pattern) => pattern.test(normalized))) {
      return {
        allowed: false,
        reason: "Blocked unsafe, global, or network command"
      };
    }

    if (/[|;&]|&&|\\|\\|/.test(normalized)) {
      return {
        allowed: false,
        reason: "Use one project-scoped command per CMD line (no chaining)"
      };
    }

    if (/(^|\\s)(>>?|<)(\\s|$)/.test(raw) || /\`|\\$\\(/.test(raw)) {
      return {
        allowed: false,
        reason: "Shell redirection and substitution are not allowed"
      };
    }

    const allowedPatterns = [
      /^(?:ls|dir|pwd|tree)(?:\\s+.+)?$/i,
      /^(?:get-childitem|gci|get-location|gl)(?:\\s+.+)?$/i,
      /^(?:cat|type|get-content|gc|get-item|gi|resolve-path|head|tail|echo|find|which|where|select-string|sls|grep|rg|ripgrep|findstr)(?:\\s+.+)?$/i,
      /^(?:mkdir|md)\\s+.+$/i,
      /^npm(?:\\.cmd)?\\s+(?:--version|version|test(?:\\s+.*)?|run\\s+[a-z0-9][a-z0-9:._-]*(?:\\s+--.*)?|ls(?:\\s+.*)?|list(?:\\s+.*)?)$/i,
      /^yarn(?:\\.cmd)?\\s+(?:--version|version|test(?:\\s+.*)?|run\\s+[a-z0-9][a-z0-9:._-]*(?:\\s+.*)?|list(?:\\s+.*)?)$/i,
      /^pnpm(?:\\.cmd)?\\s+(?:--version|version|test(?:\\s+.*)?|run\\s+[a-z0-9][a-z0-9:._-]*(?:\\s+.*)?|list(?:\\s+.*)?)$/i,
      /^npx(?:\\.cmd)?\\s+--no-install\\s+\\S+(?:\\s+.*)?$/i,
      /^node\\s+(?:--check\\s+\\S.*|--version)$/i,
      /^python(?:3)?\\s+(?:--version|-m\\s+(?:py_compile|flake8|pylint|pytest|unittest)\\b.*)$/i,
      /^(?:pip|pip3)\\s+list\\b.*$/i,
      /^pytest(?:\\s+.*)?$/i,
      /^eslint\\b.*$/i,
      /^tsc\\b.*$/i,
      /^javac\\b.+$/i,
      /^java\\s+-version$/i,
      /^mvn\\s+(?:clean|compile|test|package)\\b.*$/i,
      /^gradle\\s+(?:build|test|clean)\\b.*$/i,
      /^cargo\\s+(?:build|test|check)\\b.*$/i,
      /^go\\s+(?:build|test)\\b.*$/i,
      /^dotnet\\s+(?:build|test)\\b.*$/i,
      /^git\\s+(?:status|diff|log|show|rev-parse)\\b.*$/i,
      /^arduino-cli\\s+lib\\s+(?:list|search)\\b.*$/i,
      /^(?:\\.\\/|\\.\\\\)node_modules[\\\\/]\\.bin[\\\\/][^\\s]+(?:\\s+.*)?$/i
    ];

    const allowed = allowedPatterns.some((pattern) => pattern.test(raw));

    if (!allowed) {
      return {
        allowed: false,
        reason: "Only project-scoped read, test, and build commands are allowed"
      };
    }

    return { allowed: true };
  }`;

const newValidate = `  validateCommand(command) {
    const raw = String(command || "").trim();
    const normalized = raw.toLowerCase();

    if (!normalized) {
      return { allowed: false, reason: "Empty command" };
    }

    if (/[\\r\\n]/.test(raw)) {
      return {
        allowed: false,
        reason: "Use a single-line project-scoped command"
      };
    }

    // Explicitly blocked (never allowed)
    const blockedPatterns = [
      /\\bnpm\\s+install\\s+-g\\b/,
      /\\byarn\\s+global\\b/,
      /\\bchoco\\s+install\\b/,
      /\\bwinget\\s+install\\b/,
      /\\bapt(?:-get)?\\s+install\\b/
    ];

    if (blockedPatterns.some((pattern) => pattern.test(normalized))) {
      return {
        allowed: false,
        reason: "Blocked globally destructive command"
      };
    }

    // Highly destructive or interactive commands that cannot be auto-run
    const destructivePatterns = [
      /\\brm\\s+-rf\\b/,
      /\\bgit\\s+push\\s+--force\\b/,
      /\\bgit\\s+reset\\s+--hard\\b/,
      /\\bdel\\s+\\/f\\b/
    ];

    if (destructivePatterns.some((pattern) => pattern.test(normalized))) {
      return {
        allowed: true,
        classification: "destructive",
        reason: "Requires explicit confirmation"
      };
    }

    const safePatterns = [
      /^(?:ls|dir|pwd|tree)(?:\\s+.+)?$/i,
      /^(?:get-childitem|gci|get-location|gl)(?:\\s+.+)?$/i,
      /^(?:cat|type|get-content|gc|get-item|gi|resolve-path|head|tail|echo|find|which|where|select-string|sls|grep|rg|ripgrep|findstr)(?:\\s+.+)?$/i,
      /^npm(?:\\.cmd)?\\s+(?:--version|version|test(?:\\s+.*)?|ls(?:\\s+.*)?|list(?:\\s+.*)?)$/i,
      /^node\\s+(?:--check\\s+\\S.*|--version)$/i,
      /^python(?:3)?\\s+(?:--version|-m\\s+(?:py_compile|flake8|pylint|pytest|unittest)\\b.*)$/i,
      /^git\\s+(?:status|diff|log|show|rev-parse)\\b.*$/i
    ];

    if (safePatterns.some((pattern) => pattern.test(raw))) {
      return { allowed: true, classification: "safe" };
    }

    // Mutating but expected commands (e.g. build, install)
    return { allowed: true, classification: "expected" };
  }`;

const finalContent = content.replace(oldValidate, newValidate).replace(oldValidate.replace(/\n/g, '\r\n'), newValidate);
fs.writeFileSync('src/ai-agent/agent.js', finalContent);
console.log('Done');
