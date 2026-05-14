const { resolveCliAiConfig } = require("./utils/cli-config");

const DEFAULT_MODELS_BY_PROVIDER = {
  anthropic: "claude-sonnet-4-5",
  groq: "llama-3.1-8b-instant",
  nvidia: "meta/llama-3.1-8b-instruct",
  ollama: "qwen2.5-coder:1.5b",
  openrouter: "qwen/qwen-2.5-coder-32b-instruct"
};

const BUILT_IN_PROVIDERS = new Set([
  "anthropic",
  "groq",
  "nvidia",
  "ollama",
  "openrouter"
]);

function normalizeProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  return BUILT_IN_PROVIDERS.has(normalized) ? normalized : "ollama";
}

function buildChatRuntimeConfig(options = {}) {
  const resolved = resolveCliAiConfig(options);
  const provider = normalizeProvider(resolved.provider || "ollama");
  const runtimeConfig = {
    enabled: true,
    provider
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
  return (
    DEFAULT_MODELS_BY_PROVIDER[normalizeProvider(provider)] ||
    DEFAULT_MODELS_BY_PROVIDER.ollama
  );
}

function isLikelyNvidiaModel(model) {
  return /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(String(model || "").trim());
}

module.exports = {
  BUILT_IN_PROVIDERS,
  buildChatRuntimeConfig,
  createDefaultIo,
  getDefaultModelForProvider,
  isLikelyNvidiaModel,
  normalizeIo,
  normalizeProvider
};
