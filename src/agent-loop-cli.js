const fs = require("fs").promises;
const path = require("path");
const readline = require("readline");

const AIAgent = require("./ai-agent/agent");
const { extractReadableContent } = require("./ai-agent/web-content-utils");
const {
  buildChatRuntimeConfig,
  createDefaultIo,
  getDefaultModelForProvider,
  isLikelyNvidiaModel,
  normalizeIo
} = require("./cli-runtime");
const {
  getDefaultCliConfigPath,
  resolveCliAiConfig
} = require("./utils/cli-config");

const DEFAULT_MAX_AGENT_STEPS = 6;
const MAX_GREP_MATCHES = 25;
const MAX_TOOL_RESULT_CHARS = 8_000;

function getAgentLoopOverlay() {
  return [
    "You are running inside an interactive agent loop.",
    "On each turn, briefly narrate your next step in plain text when useful.",
    "If you need workspace state, emit structured actions on their own lines after the narration.",
    "Available actions: READ, GREP, PATCH, FILE, MKDIR, CMD, FETCH.",
    "Use the real tool results from the next user message as ground truth for the following step.",
    "Do not restate the whole plan every turn.",
    "When the task is complete, stop emitting actions and give the final plain-text answer."
  ].join("\n");
}

function findStructuredActionStart(text) {
  const value = String(text || "");
  const match = /(^|\n)(FILE|PATCH|READ|GREP|MKDIR|CMD|GRAPHIFY|LINT|VALIDATE|PREVIEW|PERFORMANCE|FETCH)\s*:/i.exec(
    value
  );
  if (!match) {
    return -1;
  }
  return match.index + (match[1] ? match[1].length : 0);
}

function stripStructuredActions(text) {
  let cleaned = String(text || "");
  if (!cleaned.trim()) {
    return "";
  }

  const blockPatterns = [
    /PATCH:\s*[^\r\n`]+\r?\nSEARCH:\s*\r?\n```[\w-]*\r?\n?[\s\S]*?```\s*\r?\nREPLACE:\s*\r?\n```[\w-]*\r?\n?[\s\S]*?```/gi,
    /FILE:\s*[^\r\n`]+\r?\n```[\w-]*\r?\n?[\s\S]*?```/gi
  ];

  for (const pattern of blockPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  const linePatterns = [
    /^\s*(READ|GREP)\s*:\s*.+$/gim,
    /^\s*(CMD|MKDIR)\s*:\s*.+$/gim,
    /^\s*GRAPHIFY\s*:\s*open\s*$/gim,
    /^\s*LINT\s*:\s*active\s*$/gim,
    /^\s*VALIDATE\s*:\s*frontend\s*$/gim,
    /^\s*PREVIEW\s*:\s*(open|inspect)\s*$/gim,
    /^\s*PERFORMANCE\s*:\s*show\s*$/gim,
    /^\s*FETCH\s*:\s*https?:\/\/\S+\s*$/gim
  ];

  for (const pattern of linePatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  const trailingStructuredStart = findStructuredActionStart(cleaned);
  if (trailingStructuredStart !== -1) {
    cleaned = cleaned.slice(0, trailingStructuredStart);
  }

  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function truncateForTranscript(value, maxChars = MAX_TOOL_RESULT_CHARS) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.2));
  const omitted = text.length - head.length - tail.length;
  return `${head}\n...\n[truncated ${omitted} chars]\n...\n${tail}`;
}

function buildPatchedContent(currentContent, searchContent, replaceContent) {
  const source = String(currentContent || "");
  const search = String(searchContent || "");
  const replace = String(replaceContent || "");

  const countOccurrences = (haystack, needle) => {
    if (!needle) return 0;
    let count = 0;
    let index = 0;
    while ((index = haystack.indexOf(needle, index)) !== -1) {
      count += 1;
      index += Math.max(needle.length, 1);
    }
    return count;
  };

  if (!search) {
    return { matched: false, reason: "empty_search" };
  }

  const literalSplice = (haystack, needle, replacement) => {
    const index = haystack.indexOf(needle);
    return (
      haystack.slice(0, index) +
      replacement +
      haystack.slice(index + needle.length)
    );
  };

  if (source.includes(search)) {
    const exactMatchCount = countOccurrences(source, search);
    if (exactMatchCount !== 1) {
      return {
        matched: false,
        reason: "ambiguous_search",
        matchCount: exactMatchCount
      };
    }
    return {
      matched: true,
      content: literalSplice(source, search, replace)
    };
  }

  const normalizeLineEndings = (text) => text.replace(/\r\n/g, "\n");
  const currentUnix = normalizeLineEndings(source);
  const searchUnix = normalizeLineEndings(search);
  const replaceUnix = normalizeLineEndings(replace);
  const prefersCrlf = source.includes("\r\n");

  if (currentUnix.includes(searchUnix)) {
    const normalizedMatchCount = countOccurrences(currentUnix, searchUnix);
    if (normalizedMatchCount !== 1) {
      return {
        matched: false,
        reason: "ambiguous_search",
        matchCount: normalizedMatchCount
      };
    }
    let content = literalSplice(currentUnix, searchUnix, replaceUnix);
    if (prefersCrlf) {
      content = content.replace(/\n/g, "\r\n");
    }
    return { matched: true, content };
  }

  const whitespaceAwarePattern = new RegExp(
    search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
  );
  const whitespaceAwareMatches =
    source.match(
      new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
        "g"
      )
    ) || [];

  if (whitespaceAwareMatches.length !== 1) {
    return {
      matched: false,
      reason: whitespaceAwareMatches.length
        ? "ambiguous_search"
        : "search_not_found",
      matchCount: whitespaceAwareMatches.length
    };
  }

  const content = source.replace(whitespaceAwarePattern, () => replace);
  if (content === source) {
    return { matched: false, reason: "search_not_found" };
  }

  return { matched: true, content };
}

function buildInspectionMatcher(query) {
  const raw = String(query || "").trim();
  if (!raw) {
    return {
      description: "",
      test: () => false
    };
  }

  const regexMatch = raw.match(/^\/([\s\S]+)\/([dgimsuvy]*)$/);
  if (regexMatch) {
    try {
      const flags = regexMatch[2].replace(/g/g, "");
      const regex = new RegExp(regexMatch[1], flags);
      return {
        description: raw,
        test: (line) => regex.test(line)
      };
    } catch {
      // Fall back to literal matching below.
    }
  }

  const lowered = raw.toLowerCase();
  return {
    description: raw,
    test: (line) => String(line || "").toLowerCase().includes(lowered)
  };
}

function formatToolResult(label, content, language = "") {
  return `${label}\n\`\`\`${language}\n${truncateForTranscript(content)}\n\`\`\``;
}

function buildToolLabel(action = {}) {
  switch (action.type) {
    case "read":
      return `READ ${action.path}`;
    case "grep":
      return `GREP ${action.query}`;
    case "cmd":
      return `CMD ${action.command}`;
    case "patch":
      return `PATCH ${action.path}`;
    case "file":
      return `FILE ${action.path}`;
    case "mkdir":
      return `MKDIR ${action.path}`;
    case "fetch":
      return `FETCH ${action.url}`;
    default:
      return String(action.type || "ACTION").toUpperCase();
  }
}

function buildToolResultMessage(originalTask, results = []) {
  const transcripts = results
    .map((result) => String(result?.transcript || "").trim())
    .filter(Boolean)
    .join("\n\n");

  return [
    "Continue the agent loop using the real tool results below as ground truth.",
    "",
    "Original task:",
    originalTask,
    "",
    "Tool results:",
    transcripts || "[no tool output]",
    "",
    "Instructions:",
    "- Brief narration is fine, but keep it short.",
    "- If more work is needed, emit the next structured actions.",
    "- If the task is complete, answer plainly with no more actions.",
    "- Do not repeat the same failed action unchanged."
  ].join("\n");
}

async function executeAgentAction(agent, action, workspaceFolder) {
  const label = buildToolLabel(action);

  switch (action.type) {
    case "read": {
      const resolved = agent._resolveWorkspacePath(action.path, workspaceFolder);
      if (!resolved.fullPath || resolved.outsideWorkspace) {
        return {
          success: false,
          transcript: formatToolResult(
            label,
            "Error: path is outside the workspace."
          )
        };
      }
      const content = await fs.readFile(resolved.fullPath, "utf8");
      return {
        success: true,
        transcript: formatToolResult(
          label,
          content,
          path.extname(action.path || "").replace(/^\./, "")
        )
      };
    }
    case "grep": {
      await agent.ensureCodebaseScanned(workspaceFolder);
      const matcher = buildInspectionMatcher(action.query);
      const matches = [];

      for (const [relativePath, fileData] of agent.codebaseContext.entries()) {
        const content = String(fileData?.content || "");
        if (!content) continue;
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (!matcher.test(lines[index])) continue;
          matches.push(
            `${relativePath}:${index + 1}: ${String(lines[index] || "")
              .trim()
              .slice(0, 220)}`
          );
          if (matches.length >= MAX_GREP_MATCHES) {
            break;
          }
        }
        if (matches.length >= MAX_GREP_MATCHES) {
          break;
        }
      }

      return {
        success: matches.length > 0,
        transcript: formatToolResult(
          label,
          matches.length > 0
            ? matches.join("\n")
            : "No matches found in indexed workspace files.",
          "text"
        )
      };
    }
    case "cmd": {
      const result = await agent.executeCommand(action.command, workspaceFolder);
      const output = result.success
        ? result.output || "Done."
        : `${result.error || "Command failed"}${
            result.output ? `\n${result.output}` : ""
          }`;
      return {
        success: result.success,
        transcript: formatToolResult(label, output, "text")
      };
    }
    case "patch": {
      const resolved = agent._resolveWorkspacePath(action.path, workspaceFolder);
      if (!resolved.fullPath || resolved.outsideWorkspace) {
        return {
          success: false,
          transcript: formatToolResult(
            label,
            "Error: patch target is outside the workspace."
          )
        };
      }
      let currentContent = "";
      try {
        currentContent = await fs.readFile(resolved.fullPath, "utf8");
      } catch (error) {
        return {
          success: false,
          transcript: formatToolResult(label, `Error: ${error.message}`)
        };
      }

      const patchResult = buildPatchedContent(
        currentContent,
        action.search,
        action.replace
      );
      if (!patchResult.matched) {
        return {
          success: false,
          transcript: formatToolResult(
            label,
            patchResult.reason === "empty_search"
              ? "Error: SEARCH block is empty."
              : patchResult.reason === "ambiguous_search"
                ? `Error: SEARCH matched ${
                    patchResult.matchCount || "multiple"
                  } locations.`
                : "Error: SEARCH content not found in the file."
          )
        };
      }

      const result = await agent.applyChanges(action.path, patchResult.content, false, {
        workspaceRoot: workspaceFolder
      });
      return {
        success: result.success,
        transcript: formatToolResult(
          label,
          result.success
            ? result.changeSummary || `Patched ${action.path}.`
            : result.error || `Failed to patch ${action.path}.`,
          "text"
        )
      };
    }
    case "file": {
      const result = await agent.applyChanges(action.path, action.content, false, {
        workspaceRoot: workspaceFolder
      });
      return {
        success: result.success,
        transcript: formatToolResult(
          label,
          result.success
            ? result.changeSummary ||
                (result.created
                  ? `Created ${action.path}.`
                  : `Updated ${action.path}.`)
            : result.error || `Failed to write ${action.path}.`,
          "text"
        )
      };
    }
    case "mkdir": {
      const result = await agent.createFolder(action.path, false, {
        workspaceRoot: workspaceFolder
      });
      return {
        success: result.success,
        transcript: formatToolResult(
          label,
          result.success
            ? result.skipped
              ? `Folder already satisfied by existing path ${
                  result.path || action.path
                }.`
              : `Created folder ${result.path || action.path}.`
            : result.error || `Failed to create folder ${action.path}.`,
          "text"
        )
      };
    }
    case "fetch": {
      try {
        const result = await agent.fetchFromWeb(action.url, {
          maxSize: 250_000,
          timeout: 10_000
        });
        const readable = extractReadableContent(result.data, {
          contentType: result.contentType,
          finalUrl: result.finalUrl
        });
        return {
          success: true,
          transcript: formatToolResult(
            label,
            readable || result.data || "Fetched content was empty.",
            "text"
          )
        };
      } catch (error) {
        return {
          success: false,
          transcript: formatToolResult(label, `Error: ${error.message}`, "text")
        };
      }
    }
    default:
      return {
        success: false,
        transcript: formatToolResult(
          label,
          `Error: unsupported action type "${action.type}".`,
          "text"
        )
      };
  }
}

function createNarrationStream(io) {
  const normalizedIo = normalizeIo(io);
  let rawText = "";
  let emittedChars = 0;
  let actionStart = -1;

  return {
    onChunk: (chunk) => {
      const value = String(chunk || "");
      if (!value) {
        return;
      }
      rawText += value;
      if (actionStart === -1) {
        actionStart = findStructuredActionStart(rawText);
      }
      const safeEnd = actionStart === -1 ? rawText.length : actionStart;
      if (safeEnd > emittedChars) {
        normalizedIo.write(rawText.slice(emittedChars, safeEnd));
        emittedChars = safeEnd;
      }
    },
    finalize: (fallbackText) => {
      const visibleText = stripStructuredActions(fallbackText || rawText);
      if (!visibleText.trim()) {
        return false;
      }
      if (emittedChars === 0) {
        normalizedIo.log(visibleText);
        return true;
      }
      normalizedIo.write("\n");
      return true;
    }
  };
}

async function runSingleAgentTask(
  agent,
  task,
  options = {},
  io = createDefaultIo(),
  dependencies = {}
) {
  const normalizedIo = normalizeIo(io);
  const workspaceFolder = options.workspaceFolder || process.cwd();
  const runtimeConfig = buildChatRuntimeConfig(options);
  const executeAction =
    typeof dependencies.executeAction === "function"
      ? dependencies.executeAction
      : (action) => executeAgentAction(agent, action, workspaceFolder);
  const maxSteps =
    Number.isFinite(options.maxSteps) && options.maxSteps > 0
      ? options.maxSteps
      : DEFAULT_MAX_AGENT_STEPS;

  let prompt = task;

  for (let step = 1; step <= maxSteps; step += 1) {
    const narrationStream = createNarrationStream(normalizedIo);
    const response = await agent.chat(
      prompt,
      workspaceFolder,
      narrationStream.onChunk,
      null,
      {
        interactionStyle: "agent_loop",
        mode: options.mode || "fast",
        runtimeConfig,
        systemOverlay: getAgentLoopOverlay()
      }
    );

    if (response?.error) {
      normalizedIo.error(response.error);
      return 2;
    }

    narrationStream.finalize(response?.text || "");

    const actions = Array.isArray(response?.actions) ? response.actions : [];
    if (actions.length === 0) {
      return 0;
    }

    const toolResults = [];
    for (const action of actions) {
      normalizedIo.log(`[tool] ${buildToolLabel(action)}`);
      const result = await executeAction(action);
      toolResults.push(result);
      const transcript = String(result?.transcript || "").trim();
      if (transcript) {
        normalizedIo.log(transcript);
      }
    }

    prompt = buildToolResultMessage(task, toolResults);
  }

  normalizedIo.error(
    `Stopped after ${maxSteps} agent step(s). Refine the task or increase --max-steps.`
  );
  return 2;
}

async function runInteractiveAgentCli(options = {}, io = createDefaultIo()) {
  const normalizedIo = normalizeIo(io);
  let mode = options.mode || "fast";
  const initialConfig = resolveCliAiConfig(options);
  let provider = initialConfig.provider || "ollama";
  let model = initialConfig.model || getDefaultModelForProvider(provider);
  let agent = new AIAgent();

  normalizedIo.log("Code Janitor agent loop");
  normalizedIo.log(
    "Commands: /fast, /heavy, /deep, /anthropic, /groq, /nvidia, /ollama, /openrouter, /clear, /exit"
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "code-janitor-agent> "
  });

  rl.prompt();

  return new Promise((resolve) => {
    rl.on("line", async (line) => {
      const trimmed = String(line || "").trim();

      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (/^\/(exit|quit)$/i.test(trimmed)) {
        rl.close();
        return;
      }

      if (/^\/fast$/i.test(trimmed)) {
        mode = "fast";
        normalizedIo.log("Mode switched to Fast.");
        rl.prompt();
        return;
      }

      if (/^\/heavy$/i.test(trimmed)) {
        mode = "heavy";
        normalizedIo.log("Mode switched to Heavy.");
        rl.prompt();
        return;
      }

      if (/^\/deep$/i.test(trimmed)) {
        mode = "deep";
        normalizedIo.log("Mode switched to Deep.");
        rl.prompt();
        return;
      }

      if (/^\/(anthropic|groq|nvidia|ollama|openrouter)$/i.test(trimmed)) {
        provider = trimmed.slice(1).toLowerCase();
        if (
          provider !== "nvidia" ||
          !isLikelyNvidiaModel(model) ||
          !String(model || "").trim()
        ) {
          model = getDefaultModelForProvider(provider);
        }
        const activeConfig = resolveCliAiConfig({
          ...options,
          model,
          provider
        });
        const missingKey =
          (provider === "anthropic" && !activeConfig.anthropicApiKey) ||
          (provider === "groq" && !activeConfig.groqApiKey) ||
          (provider === "nvidia" && !activeConfig.nvidiaApiKey) ||
          (provider === "openrouter" && !activeConfig.openrouterApiKey);
        if (missingKey) {
          normalizedIo.log(
            `Provider switched to ${provider}. Add the API key in env vars or ${getDefaultCliConfigPath()}.`
          );
        } else {
          normalizedIo.log(`Provider switched to ${provider} (${model}).`);
        }
        rl.prompt();
        return;
      }

      if (/^\/clear$/i.test(trimmed)) {
        agent = new AIAgent();
        normalizedIo.log("Started a fresh agent session.");
        rl.prompt();
        return;
      }

      try {
        await runSingleAgentTask(
          agent,
          trimmed,
          {
            ...options,
            model,
            mode,
            provider
          },
          normalizedIo
        );
      } catch (error) {
        normalizedIo.error(error.message);
      }

      rl.prompt();
    });

    rl.on("close", () => {
      resolve(0);
    });
  });
}

async function runAgentCli(options = {}, io = createDefaultIo()) {
  const agent = new AIAgent();
  const initialMessage = String(options.agentMessage || "").trim();

  if (initialMessage) {
    return runSingleAgentTask(agent, initialMessage, options, normalizeIo(io));
  }

  return runInteractiveAgentCli(options, normalizeIo(io));
}

module.exports = {
  DEFAULT_MAX_AGENT_STEPS,
  buildPatchedContent,
  buildToolResultMessage,
  createNarrationStream,
  executeAgentAction,
  findStructuredActionStart,
  getAgentLoopOverlay,
  runAgentCli,
  runInteractiveAgentCli,
  runSingleAgentTask,
  stripStructuredActions
};
