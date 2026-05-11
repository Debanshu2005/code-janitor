const readline = require("readline");

const AIAgent = require("./ai-agent/agent");
const {
  getDefaultCliConfigPath,
  resolveCliAiConfig
} = require("./utils/cli-config");
const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:1.5b";
const DEFAULT_NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";

function buildChatRuntimeConfig(options = {}) {
  const resolved = resolveCliAiConfig(options);
  const provider = String(resolved.provider || "ollama").trim().toLowerCase();
  const runtimeConfig = {
    enabled: true,
    provider: provider === "nvidia" ? "nvidia" : "ollama"
  };

  if (resolved.model) {
    runtimeConfig.model = resolved.model;
  }

  if (resolved.ollamaUrl) {
    runtimeConfig.ollamaUrl = resolved.ollamaUrl;
  }

  if (Number.isFinite(resolved.timeout) && resolved.timeout > 0) {
    runtimeConfig.timeout = resolved.timeout;
  }

  if (resolved.nvidiaApiKey) {
    runtimeConfig.nvidiaApiKey = resolved.nvidiaApiKey;
  }
  if (resolved.groqApiKey) {
    runtimeConfig.groqApiKey = resolved.groqApiKey;
  }
  if (resolved.openrouterApiKey) {
    runtimeConfig.openrouterApiKey = resolved.openrouterApiKey;
  }
  if (resolved.anthropicApiKey) {
    runtimeConfig.anthropicApiKey = resolved.anthropicApiKey;
  }

  return runtimeConfig;
}

function getReadOnlyOverlay() {
  return [
    "CLI chat mode is read-only by default.",
    "Do not generate FILE:, PATCH:, MKDIR:, or CMD: actions.",
    "Answer in plain text only.",
    "If the user asks for code changes, explain the change or provide a patch as prose, but do not execute it."
  ].join("\n");
}

function createDefaultIo() {
  return {
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
    write: (text) => process.stdout.write(String(text || ""))
  };
}

function normalizeIo(io = null) {
  const base = io && typeof io === "object" ? io : {};
  return {
    log:
      typeof base.log === "function"
        ? (...args) => base.log(...args)
        : (...args) => console.log(...args),
    error:
      typeof base.error === "function"
        ? (...args) => base.error(...args)
        : (...args) => console.error(...args),
    write:
      typeof base.write === "function"
        ? (text) => base.write(text)
        : (text) => process.stdout.write(String(text || ""))
  };
}

function getDefaultModelForProvider(provider) {
  return provider === "nvidia" ? DEFAULT_NVIDIA_MODEL : DEFAULT_OLLAMA_MODEL;
}

function isLikelyNvidiaModel(model) {
  return /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(String(model || "").trim());
}

async function runSingleChatTurn(agent, message, options = {}, io = createDefaultIo()) {
  const normalizedIo = normalizeIo(io);
  let streamedAny = false;
  const workspaceFolder = options.workspaceFolder || process.cwd();
  const runtimeConfig = buildChatRuntimeConfig(options);
  const response = await agent.chat(
    message,
    workspaceFolder,
    (chunk) => {
      streamedAny = true;
      normalizedIo.write(chunk);
    },
    null,
    {
      mode: options.mode || "fast",
      runtimeConfig,
      systemOverlay: getReadOnlyOverlay()
    }
  );

  if (response?.error) {
    normalizedIo.error(response.error);
    return 2;
  }

  if (!streamedAny) {
    normalizedIo.log(response?.text || "");
  } else {
    normalizedIo.write("\n");
  }

  return 0;
}

async function runInteractiveChat(options = {}, io = createDefaultIo()) {
  const normalizedIo = normalizeIo(io);
  let mode = options.mode || "fast";
  const initialConfig = resolveCliAiConfig(options);
  let provider = initialConfig.provider || "ollama";
  let model =
    initialConfig.model ||
    getDefaultModelForProvider(provider);
  let agent = new AIAgent();

  normalizedIo.log("Code Janitor CLI chat");
  normalizedIo.log("Commands: /fast, /heavy, /deep, /nvidia, /ollama, /clear, /exit");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "code-janitor> "
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

      if (/^\/nvidia$/i.test(trimmed)) {
        provider = "nvidia";
        if (!isLikelyNvidiaModel(model)) {
          model = DEFAULT_NVIDIA_MODEL;
        }
        const activeConfig = resolveCliAiConfig({
          ...options,
          model,
          provider
        });
        if (!activeConfig.nvidiaApiKey) {
          normalizedIo.log(
            `Provider switched to NVIDIA. Set NVIDIA_API_KEY, CODE_JANITOR_NVIDIA_API_KEY, or add it to ${getDefaultCliConfigPath()}.`
          );
        } else {
          normalizedIo.log(`Provider switched to NVIDIA (${model}).`);
        }
        rl.prompt();
        return;
      }

      if (/^\/ollama$/i.test(trimmed)) {
        provider = "ollama";
        if (isLikelyNvidiaModel(model) || !String(model || "").trim()) {
          model = DEFAULT_OLLAMA_MODEL;
        }
        normalizedIo.log(`Provider switched to Ollama (${model}).`);
        rl.prompt();
        return;
      }

      if (/^\/clear$/i.test(trimmed)) {
        agent = new AIAgent();
        normalizedIo.log("Started a fresh chat session.");
        rl.prompt();
        return;
      }

      try {
        await runSingleChatTurn(
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

async function runChatCli(options = {}, io = createDefaultIo()) {
  const agent = new AIAgent();
  const initialMessage = String(options.chatMessage || "").trim();

  if (initialMessage) {
    return runSingleChatTurn(agent, initialMessage, options, normalizeIo(io));
  }

  return runInteractiveChat(options, normalizeIo(io));
}

module.exports = {
  buildChatRuntimeConfig,
  getReadOnlyOverlay,
  normalizeIo,
  runChatCli,
  runInteractiveChat,
  runSingleChatTurn
};
