const readline = require("readline");

const AIAgent = require("./ai-agent/agent");
const { getDefaultCliConfigPath, resolveCliAiConfig } = require("./utils/cli-config");
const {
  buildChatRuntimeConfig,
  createDefaultIo,
  getDefaultModelForProvider,
  isLikelyNvidiaModel,
  normalizeIo
} = require("./cli-runtime");

function getReadOnlyOverlay() {
  return [
    "CLI chat mode is read-only by default.",
    "Do not generate FILE:, PATCH:, MKDIR:, or CMD: actions.",
    "Answer in plain text only.",
    "If the user asks for code changes, explain the change or provide a patch as prose, but do not execute it."
  ].join("\n");
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
          model = getDefaultModelForProvider(provider);
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
          model = getDefaultModelForProvider(provider);
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
