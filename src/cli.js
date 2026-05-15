#!/usr/bin/env node

const path = require("path");

const { runAgentCli } = require("./agent-loop-cli");
const { runChatCli } = require("./cli-chat");
const { BUILT_IN_PROVIDERS } = require("./cli-runtime");
const { analyzeTarget } = require("./core/janitor");

function parseArgs(argv) {
  const options = {
    ai: false,
    agentMessage: "",
    chatMessage: "",
    check: false,
    command: "fix",
    help: false,
    json: false,
    maxSteps: null,
    model: "",
    mode: "fast",
    nvidiaApiKey: "",
    ollamaUrl: "",
    provider: "",
    timeout: null,
    version: false,
    write: true
  };
  const positionals = [];
  const chatTokens = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    const readValue = (flagName) => {
      const nextIndex = index + 1;
      const value = argv[nextIndex];

      if (!value || value.startsWith("-")) {
        throw new Error(`Option ${flagName} requires a value.`);
      }

      index = nextIndex;
      return value;
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      options.version = true;
      continue;
    }

    if (arg === "--check") {
      options.check = true;
      options.write = false;
      continue;
    }

    if (arg === "--write") {
      options.write = true;
      options.check = false;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--mode") {
      const mode = readValue("--mode").trim().toLowerCase();
      if (!["fast", "heavy", "deep"].includes(mode)) {
        throw new Error("Option --mode must be one of: fast, heavy, deep.");
      }
      options.mode = mode;
      continue;
    }

    if (arg === "--ai") {
      options.ai = true;
      continue;
    }

    if (arg === "--model") {
      options.model = readValue("--model");
      options.ai = true;
      continue;
    }

    if (arg === "--provider") {
      const provider = readValue("--provider").trim().toLowerCase();
      if (!BUILT_IN_PROVIDERS.has(provider)) {
        throw new Error(
          `Option --provider must be one of: ${Array.from(BUILT_IN_PROVIDERS)
            .sort()
            .join(", ")}.`
        );
      }
      options.provider = provider;
      options.ai = true;
      continue;
    }

    if (arg === "--ollama-url") {
      options.ollamaUrl = readValue("--ollama-url");
      options.ai = true;
      continue;
    }

    if (arg === "--nvidia-api-key") {
      options.nvidiaApiKey = readValue("--nvidia-api-key");
      options.provider = "nvidia";
      options.ai = true;
      continue;
    }

    if (arg === "--timeout") {
      const timeoutValue = Number(readValue("--timeout"));
      if (!Number.isFinite(timeoutValue) || timeoutValue < 0) {
        throw new Error(
          "Option --timeout requires a non-negative number. Use 0 to disable the timeout."
        );
      }
      options.timeout = timeoutValue;
      options.ai = true;
      continue;
    }

    if (arg === "--max-steps") {
      const maxSteps = Number(readValue("--max-steps"));
      if (!Number.isFinite(maxSteps) || maxSteps <= 0) {
        throw new Error("Option --max-steps requires a positive number.");
      }
      options.maxSteps = maxSteps;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.command === "chat" || options.command === "agent") {
      chatTokens.push(arg);
      continue;
    }

    if (arg === "chat" && positionals.length === 0) {
      options.command = "chat";
      continue;
    }

    if (arg === "agent" && positionals.length === 0) {
      options.command = "agent";
      continue;
    }

    positionals.push(arg);
  }

  if (options.command === "chat") {
    return {
      ...options,
      chatMessage: chatTokens.join(" ").trim(),
      targetPath: process.cwd()
    };
  }

  if (options.command === "agent") {
    return {
      ...options,
      agentMessage: chatTokens.join(" ").trim(),
      targetPath: process.cwd()
    };
  }

  if (positionals.length > 1) {
    throw new Error("Only one file or directory target can be provided.");
  }

  return {
    ...options,
    targetPath: positionals[0] || process.cwd()
  };
}

function getVersion() {
  return require("../package.json").version;
}

function getHelpText() {
  return `
Usage: code-janitor [path] [options]

Options:
  -h, --help        Show this help message
  -v, --version     Show version information
  --check           Report files that would change without writing them
  --write           Apply fixes to disk (default)
  --json            Print the final report as JSON
  --mode NAME       Chat mode: fast, heavy, or deep
  --max-steps N     Maximum model/tool loop rounds for the agent subcommand
  --ai              Allow AI-assisted fixes when a fixer supports them
  --provider NAME   AI provider: anthropic, groq, nvidia, ollama, or openrouter
  --model NAME      Model to use for the selected provider
  --ollama-url URL  Ollama base URL (default: http://localhost:11434)
  --nvidia-api-key  NVIDIA API key (or set NVIDIA_API_KEY / CODE_JANITOR_NVIDIA_API_KEY)
  --timeout MS      AI request timeout in milliseconds (0 disables timeout)

Description:
  Default mode analyzes a supported file or directory and applies safe formatting
  and syntax fixes. If no path is provided, the current working directory is used.
  Use the chat subcommand for a read-only terminal chat experience.
  Use the agent subcommand for a narrated tool loop that can inspect, edit, and verify.

Examples:
  code-janitor
  code-janitor src
  code-janitor src/app.js --check
  code-janitor chat
  code-janitor chat explain src/extension.js --mode heavy
  code-janitor agent fix the CLI help text in src/cli.js
  code-janitor agent debug npm test failure --provider anthropic --max-steps 8
  code-janitor . --json
  code-janitor src/broken.py --ai --model qwen2.5-coder:1.5b
  code-janitor src/broken.js --ai --provider nvidia --model meta/llama-3.1-8b-instruct
`.trim();
}

function printTextSummary(report, io = console) {
  const targetLabel = path.resolve(report.targetPath);
  const actionLabel =
    report.mode === "check" ? "Checking for safe fixes" : "Applying safe fixes";

  io.log(`Code Janitor: ${actionLabel} in ${targetLabel}`);
  io.log(`Files processed: ${report.filesProcessed}`);

  if (report.mode === "check") {
    io.log(`Files needing changes: ${report.filesFixed}`);
  } else {
    io.log(`Files modified: ${report.filesWritten}`);
  }

  io.log(`Total fixes identified: ${report.totalFixes}`);

  if (report.fixedFiles.length > 0) {
    const heading =
      report.mode === "check" ? "Files that would change:" : "Modified files:";
    io.log("");
    io.log(heading);
    report.fixedFiles.forEach((filePath) => {
      io.log(`  - ${path.relative(targetLabel, filePath) || path.basename(filePath)}`);
    });
  } else {
    io.log("");
    io.log(
      report.mode === "check"
        ? "No changes needed. Your code already looks clean."
        : "No issues found. Your code already looks clean."
    );
  }

  if (report.errors.length > 0) {
    io.error("");
    io.error("Processing errors:");
    report.errors.forEach((error) => {
      io.error(`  - ${error.filePath}: ${error.message}`);
    });
  }
}

async function runCli(argv, io = console) {
  let options;

  try {
    options = parseArgs(argv);
  } catch (error) {
    io.error(error.message);
    io.error("");
    io.error(getHelpText());
    return 2;
  }

  if (options.help) {
    io.log(getHelpText());
    return 0;
  }

  if (options.version) {
    io.log(`code-janitor v${getVersion()}`);
    return 0;
  }

  if (options.command === "agent") {
    return runAgentCli(options, io);
  }

  if (options.command === "chat") {
    return runChatCli(options, io);
  }

  try {
    const report = await analyzeTarget(path.resolve(options.targetPath), {
      ai: options.ai,
      aiModel: options.model,
      nvidiaApiKey: options.nvidiaApiKey,
      ollamaUrl: options.ollamaUrl,
      provider: options.provider,
      timeout: options.timeout,
      write: options.write
    });

    if (options.json) {
      io.log(JSON.stringify(report, null, 2));
    } else {
      printTextSummary(report, io);
    }

    if (report.errors.length > 0) {
      return 2;
    }

    if (options.check && report.filesFixed > 0) {
      return 1;
    }

    return 0;
  } catch (error) {
    io.error(`[ERROR] ${error.message}`);
    return 2;
  }
}

async function executeFromProcess() {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

if (require.main === module) {
  executeFromProcess();
}

module.exports = {
  executeFromProcess,
  getHelpText,
  getVersion,
  parseArgs,
  printTextSummary,
  runCli
};
