const {
  getDefaultCliConfigPath,
  resolveCliAiConfig
} = require("./utils/cli-config");
const {
  resolveCustomProviderChatUrl,
  sanitizeApiKey
} = require("./ai-agent/provider-utils");

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

const PROVIDER_API_KEY_FIELDS = {
  anthropic: "anthropicApiKey",
  groq: "groqApiKey",
  nvidia: "nvidiaApiKey",
  openrouter: "openrouterApiKey"
};
const PROVIDER_API_KEY_ENV = {
  anthropic: "CODE_JANITOR_ANTHROPIC_API_KEY",
  groq: "CODE_JANITOR_GROQ_API_KEY",
  nvidia: "CODE_JANITOR_NVIDIA_API_KEY or NVIDIA_API_KEY",
  openrouter: "CODE_JANITOR_OPENROUTER_API_KEY"
};
const MODEL_SHORTCUTS = {
  "llama-3.1-8b": {
    provider: "nvidia",
    model: "meta/llama-3.1-8b-instruct"
  },
  minimax: {
    provider: "nvidia",
    model: "minimaxai/minimax-m2.7"
  },
  "mistral-nemotron": {
    provider: "nvidia",
    model: "mistralai/mistral-nemotron"
  },
  nemotron: {
    provider: "nvidia",
    model: "nvidia/llama-3.3-nemotron-super-49b-v1.5"
  }
};

function isCustomProviderId(provider) {
  return /^custom:[a-z0-9._-]+$/i.test(String(provider || "").trim());
}

function getConfiguredCustomProvider(customProviders = [], provider = "") {
  const normalized = String(provider || "").trim().toLowerCase();
  if (!normalized) return null;

  return (
    customProviders.find(
      (customProvider) =>
        String(customProvider?.id || "").trim().toLowerCase() === normalized
    ) || null
  );
}

function isKnownProvider(provider, customProviders = []) {
  const normalized = String(provider || "").trim().toLowerCase();
  return (
    BUILT_IN_PROVIDERS.has(normalized) ||
    !!getConfiguredCustomProvider(customProviders, normalized)
  );
}

function isProviderNameAllowed(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  return BUILT_IN_PROVIDERS.has(normalized) || isCustomProviderId(normalized);
}

function formatProviderList(customProviders = []) {
  return Array.from(
    new Set([
      ...Array.from(BUILT_IN_PROVIDERS),
      ...customProviders.map((provider) => provider.id).filter(Boolean)
    ])
  )
    .sort()
    .join(", ");
}

function normalizeProvider(provider, customProviders = []) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (BUILT_IN_PROVIDERS.has(normalized)) return normalized;
  if (getConfiguredCustomProvider(customProviders, normalized)) return normalized;
  return isCustomProviderId(normalized) ? normalized : "ollama";
}

function buildChatRuntimeConfig(options = {}) {
  const resolved = resolveCliAiConfig(options);
  const customProviders = Array.isArray(resolved.customProviders)
    ? resolved.customProviders
    : [];
  const provider = normalizeProvider(resolved.provider || "ollama", customProviders);
  const customProvider = getConfiguredCustomProvider(customProviders, provider);
  const runtimeConfig = {
    enabled: true,
    provider,
    anthropicApiKey: "",
    groqApiKey: "",
    nvidiaApiKey: "",
    openrouterApiKey: ""
  };

  if (customProvider) {
    runtimeConfig.model = resolved.model || customProvider.defaultModel;
    runtimeConfig.customProvider = {
      ...customProvider,
      protocol: customProvider.protocol || "openai",
      apiKey: sanitizeApiKey(customProvider.apiKey),
      chatCompletionsUrl: resolveCustomProviderChatUrl(customProvider.baseUrl)
    };
  } else if (resolved.model) {
    runtimeConfig.model = resolved.model;
  }

  if (resolved.ollamaUrl) {
    runtimeConfig.ollamaUrl = resolved.ollamaUrl;
  }

  if (Number.isFinite(resolved.timeout) && resolved.timeout >= 0) {
    runtimeConfig.timeout = resolved.timeout;
  }

  runtimeConfig.nvidiaApiKey = resolved.nvidiaApiKey || "";
  runtimeConfig.groqApiKey = resolved.groqApiKey || "";
  runtimeConfig.openrouterApiKey = resolved.openrouterApiKey || "";
  runtimeConfig.anthropicApiKey = resolved.anthropicApiKey || "";

  return runtimeConfig;
}

function validateRuntimeCredentials(runtimeConfig = {}) {
  const provider = normalizeProvider(runtimeConfig.provider);
  if (provider === "ollama") {
    return { valid: true, error: "" };
  }

  if (isCustomProviderId(provider)) {
    if (!runtimeConfig.customProvider) {
      return {
        valid: false,
        error: `${provider} is selected, but its provider definition is not synced to ${getDefaultCliConfigPath()}. Save it again from the Code Janitor chat provider dialog.`
      };
    }

    if (String(runtimeConfig.customProvider.apiKey || "").trim()) {
      return { valid: true, error: "" };
    }

    return {
      valid: false,
      error: `${runtimeConfig.customProvider.name || provider} is selected, but its API key is not configured. Save the key from the Code Janitor chat provider dialog or add it to ${getDefaultCliConfigPath()}.`
    };
  }

  const apiKeyField = PROVIDER_API_KEY_FIELDS[provider];
  if (!apiKeyField || String(runtimeConfig[apiKeyField] || "").trim()) {
    return { valid: true, error: "" };
  }

  return {
    valid: false,
    error: `${provider} is selected, but its API key is not configured. Set ${PROVIDER_API_KEY_ENV[provider]} or add the key to ${getDefaultCliConfigPath()}.`
  };
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
  if (isCustomProviderId(provider)) {
    return "";
  }

  return (
    DEFAULT_MODELS_BY_PROVIDER[normalizeProvider(provider)] ||
    DEFAULT_MODELS_BY_PROVIDER.ollama
  );
}

function isLikelyNvidiaModel(model) {
  return /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(String(model || "").trim());
}

function resolveModelShortcut(command) {
  const shortcut = String(command || "")
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase();
  return MODEL_SHORTCUTS[shortcut] || null;
}

module.exports = {
  BUILT_IN_PROVIDERS,
  buildChatRuntimeConfig,
  createDefaultIo,
  formatProviderList,
  getConfiguredCustomProvider,
  getDefaultModelForProvider,
  isLikelyNvidiaModel,
  isKnownProvider,
  isProviderNameAllowed,
  normalizeIo,
  normalizeProvider,
  resolveModelShortcut,
  validateRuntimeCredentials
};
