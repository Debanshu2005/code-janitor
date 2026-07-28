const readline = require("readline");

const AIAgent = require("./ai-agent/agent");
const { getDefaultCliConfigPath, resolveCliAiConfig } = require("./utils/cli-config");
const {
  buildChatRuntimeConfig,
  createDefaultIo,
  formatProviderList,
  getDefaultModelForProvider,
  isLikelyNvidiaModel,
  isKnownProvider,
  normalizeIo,
  resolveModelShortcut,
  validateRuntimeCredentials
} = require("./cli-runtime");

function getReadOnlyOverlay() {
  return [
    "CLI chat mode is read-only by default.",
    "Do not generate FILE:, PATCH:, MKDIR:, or CMD: actions.",
    "Answer in plain text only.",
    "If the user asks for code changes, explain the change or provide a patch as prose, but do not execute it."
  ].join("\n");
}

function getChatHelpText() {
  return [
    "Slash commands:",
    "  /help                 Show available commands",
    "  /status               Show the active provider, model, and mode",
    "  /mode fast|heavy|deep Switch reasoning mode",
    "  /provider NAME        Switch provider",
    "  /model NAME           Set the active model",
    "  /clear                Start a fresh chat session",
    "  /exit                 Leave the session",
    "",
    "Shortcuts:",
    "  /fast  /heavy  /deep  /anthropic  /groq  /nvidia  /ollama  /openrouter",
    "  /mistral-nemotron  /nemotron  /minimax  /llama-3.1-8b"
  ].join("\n");
}

function logChatStatus(io, { mode, model, provider }) {
  io.log(`Mode: ${mode} | Provider: ${provider} | Model: ${model}`);
}

function buildProviderSwitchMessage(provider, model, options = {}) {
  const activeConfig = resolveCliAiConfig({
    ...options,
    model,
    provider
  });
  const runtimeConfig = buildChatRuntimeConfig({
    ...options,
    model,
    provider
  });
  const credentials = validateRuntimeCredentials(runtimeConfig);
  const missingKey =
    (provider === "anthropic" && !activeConfig.anthropicApiKey) ||
    (provider === "groq" && !activeConfig.groqApiKey) ||
    (provider === "nvidia" && !activeConfig.nvidiaApiKey) ||
    (provider === "openrouter" && !activeConfig.openrouterApiKey);

  if (!credentials.valid) {
    return `Provider switched to ${provider}. ${credentials.error}`;
  }

  if (missingKey) {
    return `Provider switched to ${provider}. Add the API key in env vars or ${getDefaultCliConfigPath()}.`;
  }

  return `Provider switched to ${provider} (${model}).`;
}

function pickModelForProvider(provider, currentModel) {
  const trimmedModel = String(currentModel || "").trim();
  if (!trimmedModel) {
    return getDefaultModelForProvider(provider);
  }

  if (provider === "nvidia" && !isLikelyNvidiaModel(trimmedModel)) {
    return getDefaultModelForProvider(provider);
  }

  if (provider !== "nvidia" && isLikelyNvidiaModel(trimmedModel)) {
    return getDefaultModelForProvider(provider);
  }

  return trimmedModel;
}

async function runSingleChatTurn(agent, message, options = {}, io = createDefaultIo()) {
  const normalizedIo = normalizeIo(io);
  let streamedAny = false;
  const workspaceFolder = options.workspaceFolder || process.cwd();
  const runtimeConfig = buildChatRuntimeConfig(options);
  const credentials = validateRuntimeCredentials(runtimeConfig);
  if (!credentials.valid) {
    normalizedIo.error(credentials.error);
    return 2;
  }

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
  const customProviders = initialConfig.customProviders || [];
  let provider = initialConfig.provider || "ollama";
  let model =
    initialConfig.model ||
    getDefaultModelForProvider(provider);
  let agent = new AIAgent();

  normalizedIo.log("Code Janitor");
  normalizedIo.log("Interactive chat session (read-only). Use exec or agent when you want edits.");
  logChatStatus(normalizedIo, { mode, model, provider });
  normalizedIo.log("Type /help for commands.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "janitor> "
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

      if (/^\/help$/i.test(trimmed)) {
        normalizedIo.log(getChatHelpText());
        rl.prompt();
        return;
      }

      if (/^\/status$/i.test(trimmed)) {
        logChatStatus(normalizedIo, { mode, model, provider });
        rl.prompt();
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

      const modeMatch = trimmed.match(/^\/mode\s+(fast|heavy|deep)$/i);
      if (modeMatch) {
        mode = modeMatch[1].toLowerCase();
        normalizedIo.log(`Mode switched to ${mode}.`);
        rl.prompt();
        return;
      }

      const providerMatch = trimmed.match(/^\/provider\s+([a-z0-9._:-]+)$/i);
      if (providerMatch) {
        const nextProvider = providerMatch[1].toLowerCase();
        if (!isKnownProvider(nextProvider, customProviders)) {
          normalizedIo.error(
            `Unknown provider "${nextProvider}". Choose one of: ${formatProviderList(customProviders)}.`
          );
          rl.prompt();
          return;
        }

        provider = nextProvider;
        model = pickModelForProvider(provider, model);
        normalizedIo.log(buildProviderSwitchMessage(provider, model, options));
        rl.prompt();
        return;
      }

      const modelMatch = trimmed.match(/^\/model\s+(.+)$/i);
      if (modelMatch) {
        model = modelMatch[1].trim();
        normalizedIo.log(`Model switched to ${model}.`);
        rl.prompt();
        return;
      }

      if (/^\/(anthropic|groq|nvidia|ollama|openrouter)$/i.test(trimmed)) {
        provider = trimmed.slice(1).toLowerCase();
        model = pickModelForProvider(provider, model);
        normalizedIo.log(buildProviderSwitchMessage(provider, model, options));
        rl.prompt();
        return;
      }

      const modelShortcut = resolveModelShortcut(trimmed);
      if (modelShortcut) {
        provider = modelShortcut.provider;
        model = modelShortcut.model;
        normalizedIo.log(buildProviderSwitchMessage(provider, model, options));
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
