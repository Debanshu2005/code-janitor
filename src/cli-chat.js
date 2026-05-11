const readline = require("readline");

const AIAgent = require("./ai-agent/agent");

function buildChatRuntimeConfig(options = {}) {
  const provider = String(options.provider || "ollama").trim().toLowerCase();
  const runtimeConfig = {
    enabled: true,
    provider: provider === "nvidia" ? "nvidia" : "ollama"
  };

  if (typeof options.model === "string" && options.model.trim()) {
    runtimeConfig.model = options.model.trim();
  }

  if (typeof options.ollamaUrl === "string" && options.ollamaUrl.trim()) {
    runtimeConfig.ollamaUrl = options.ollamaUrl.trim();
  }

  if (Number.isFinite(options.timeout) && options.timeout > 0) {
    runtimeConfig.timeout = options.timeout;
  }

  const nvidiaApiKey =
    String(options.nvidiaApiKey || "").trim() ||
    String(process.env.CODE_JANITOR_NVIDIA_API_KEY || "").trim() ||
    String(process.env.NVIDIA_API_KEY || "").trim();

  if (nvidiaApiKey) {
    runtimeConfig.nvidiaApiKey = nvidiaApiKey;
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

async function runSingleChatTurn(agent, message, options = {}, io = createDefaultIo()) {
  let streamedAny = false;
  const workspaceFolder = options.workspaceFolder || process.cwd();
  const runtimeConfig = buildChatRuntimeConfig(options);
  const response = await agent.chat(
    message,
    workspaceFolder,
    (chunk) => {
      streamedAny = true;
      io.write(chunk);
    },
    null,
    {
      mode: options.mode || "fast",
      runtimeConfig,
      systemOverlay: getReadOnlyOverlay()
    }
  );

  if (response?.error) {
    io.error(response.error);
    return 2;
  }

  if (!streamedAny) {
    io.log(response?.text || "");
  } else {
    io.write("\n");
  }

  return 0;
}

async function runInteractiveChat(options = {}, io = createDefaultIo()) {
  let mode = options.mode || "fast";
  let agent = new AIAgent();

  io.log("Code Janitor CLI chat");
  io.log("Commands: /fast, /heavy, /deep, /clear, /exit");

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
        io.log("Mode switched to Fast.");
        rl.prompt();
        return;
      }

      if (/^\/heavy$/i.test(trimmed)) {
        mode = "heavy";
        io.log("Mode switched to Heavy.");
        rl.prompt();
        return;
      }

      if (/^\/deep$/i.test(trimmed)) {
        mode = "deep";
        io.log("Mode switched to Deep.");
        rl.prompt();
        return;
      }

      if (/^\/clear$/i.test(trimmed)) {
        agent = new AIAgent();
        io.log("Started a fresh chat session.");
        rl.prompt();
        return;
      }

      try {
        await runSingleChatTurn(
          agent,
          trimmed,
          {
            ...options,
            mode
          },
          io
        );
      } catch (error) {
        io.error(error.message);
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
    return runSingleChatTurn(agent, initialMessage, options, io);
  }

  return runInteractiveChat(options, io);
}

module.exports = {
  buildChatRuntimeConfig,
  getReadOnlyOverlay,
  runChatCli,
  runInteractiveChat,
  runSingleChatTurn
};
