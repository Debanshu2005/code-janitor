#!/usr/bin/env node

const path = require("path");

const { analyzeTarget } = require("./core/janitor");

function parseArgs(argv) {
  const options = {
    ai: false,
    check: false,
    help: false,
    json: false,
    model: "",
    nvidiaApiKey: "",
    ollamaUrl: "",
    provider: "ollama",
    timeout: null,
    version: false,
    write: true
  };
  const positionals = [];

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
      if (provider !== "ollama" && provider !== "nvidia") {
        throw new Error("Option --provider must be either ollama or nvidia.");
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
      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error("Option --timeout requires a positive number.");
      }
      options.timeout = timeoutValue;
      options.ai = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
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
  --ai              Allow AI-assisted fixes when a fixer supports them
  --provider NAME   AI provider: ollama or nvidia
  --model NAME      Model to use for the selected provider
  --ollama-url URL  Ollama base URL (default: http://localhost:11434)
  --nvidia-api-key  NVIDIA API key (or set NVIDIA_API_KEY / CODE_JANITOR_NVIDIA_API_KEY)
  --timeout MS      AI request timeout in milliseconds

Description:
  Analyze a supported file or directory and apply safe formatting and syntax fixes.
  If no path is provided, the current working directory is used.

Examples:
  code-janitor
  code-janitor src
  code-janitor src/app.js --check
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
