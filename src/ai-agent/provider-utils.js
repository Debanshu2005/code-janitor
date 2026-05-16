const vscode = require("../utils/vscode-shim");

const BUILT_IN_PROVIDERS = new Set([
  "ollama",
  "groq",
  "openrouter",
  "anthropic",
  "nvidia"
]);

const BUILT_IN_PROVIDER_LABELS = {
  ollama: "Ollama",
  groq: "Groq",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  nvidia: "NVIDIA NIM"
};

function sanitizeApiKey(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  if (
    (raw.startsWith("\"") && raw.endsWith("\"")) ||
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith("`") && raw.endsWith("`"))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

function sanitizeExternalUrl(value, { allowHttp = true, allowHttps = true } = {}) {
  const raw = String(value || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return "";

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" && allowHttp) return parsed.toString();
    if (parsed.protocol === "https:" && allowHttps) return parsed.toString();
  } catch {
    return "";
  }

  return "";
}

function resolveCustomProviderChatUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) return "";
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function getApiKeyConfigKey(provider) {
  if (provider === "groq") return "groqApiKey";
  if (provider === "openrouter") return "openrouterApiKey";
  if (provider === "anthropic") return "anthropicApiKey";
  if (provider === "nvidia") return "nvidiaApiKey";
  return null;
}

function getApiSecretKey(provider) {
  return `codeJanitor.ai.${provider}.apiKey`;
}

function getSavedProviderModelStateKey(provider) {
  return `codeJanitor.ai.lastModel.${provider || "unknown"}`;
}

function getCustomProviders(context) {
  const providers = context?.globalState?.get?.("codeJanitor.ai.customProviders", []);
  return Array.isArray(providers) ? providers.filter(Boolean) : [];
}

function getCustomProviderById(context, providerId) {
  return getCustomProviders(context).find((provider) => provider.id === providerId) || null;
}

function getSavedProviderModel(context, provider, fallback = "") {
  return String(
    context?.globalState?.get?.(getSavedProviderModelStateKey(provider), fallback) || fallback
  ).trim();
}

async function getStoredApiKey(context, provider) {
  const configKey = getApiKeyConfigKey(provider);
  const secretValue = sanitizeApiKey(
    await context?.secrets?.get?.(getApiSecretKey(provider))
  );
  if (secretValue) return secretValue;
  if (!configKey) return "";

  const cfg = vscode.workspace.getConfiguration("codeJanitor.ai");
  return sanitizeApiKey(cfg.get(configKey, ""));
}

function getProviderDisplayName(provider, context) {
  if (BUILT_IN_PROVIDER_LABELS[provider]) {
    return BUILT_IN_PROVIDER_LABELS[provider];
  }

  return getCustomProviderById(context, provider)?.name || provider || "AI provider";
}

async function resolveProviderRuntimeConfig({
  context,
  agent,
  preferredProvider = "",
  preferredModel = ""
} = {}) {
  if (!agent) {
    throw new Error("An AI agent instance is required.");
  }

  const baseConfig = agent.getConfig();
  const provider = String(preferredProvider || "").trim() || baseConfig.provider;
  const defaultModel = agent._getDefaultModelForProvider(provider);
  const selectedModel =
    String(preferredModel || "").trim() ||
    getSavedProviderModel(context, provider, "") ||
    (provider === "nvidia" ? baseConfig.nvidiaModel : "") ||
    baseConfig.model ||
    defaultModel;

  if (provider === "ollama") {
    return {
      ...baseConfig,
      provider,
      model: selectedModel || defaultModel,
      providerDisplayName: getProviderDisplayName(provider, context),
      hasRequiredCredentials: true
    };
  }

  if (BUILT_IN_PROVIDERS.has(provider)) {
    const apiKey = await getStoredApiKey(context, provider);
    const nextConfig = {
      ...baseConfig,
      provider,
      model: selectedModel || defaultModel,
      providerDisplayName: getProviderDisplayName(provider, context),
      hasRequiredCredentials: !!apiKey
    };

    if (provider === "groq") {
      nextConfig.groqApiKey = apiKey;
    } else if (provider === "openrouter") {
      nextConfig.openrouterApiKey = apiKey;
    } else if (provider === "anthropic") {
      nextConfig.anthropicApiKey = apiKey;
    } else if (provider === "nvidia") {
      nextConfig.model = agent._sanitizeNvidiaModel(selectedModel || defaultModel);
      nextConfig.nvidiaModel = nextConfig.model;
      nextConfig.nvidiaApiKey = apiKey;
    }

    return nextConfig;
  }

  const customProvider = getCustomProviderById(context, provider);
  if (!customProvider) {
    throw new Error(`Preferred provider "${provider}" is not configured.`);
  }

  const apiKey = sanitizeApiKey(
    await context?.secrets?.get?.(getApiSecretKey(provider))
  );
  const model =
    selectedModel ||
    String(customProvider.defaultModel || "").trim() ||
    defaultModel;

  return {
    ...baseConfig,
    provider,
    model,
    providerDisplayName: customProvider.name || provider,
    hasRequiredCredentials: !!apiKey,
    customProvider: {
      ...customProvider,
      protocol: customProvider.protocol || "openai",
      apiKey,
      chatCompletionsUrl: resolveCustomProviderChatUrl(customProvider.baseUrl)
    }
  };
}

async function runProviderPrompt({
  context,
  agent,
  workspaceRoot,
  prompt,
  preferredProvider = "",
  preferredModel = "",
  mode = "fast",
  intent = "general",
  systemOverlay = "",
  onStatus = null
} = {}) {
  const runtimeConfig = await resolveProviderRuntimeConfig({
    context,
    agent,
    preferredProvider,
    preferredModel
  });

  if (!runtimeConfig.hasRequiredCredentials) {
    throw new Error(
      `${runtimeConfig.providerDisplayName || runtimeConfig.provider} is selected, but its API key is not configured.`
    );
  }

  const response = await agent.chat(prompt, workspaceRoot, null, null, {
    mode,
    intentOverride: intent,
    skipHistory: true,
    runtimeConfig,
    systemOverlay,
    onStatus
  });

  if (response?.error) {
    throw new Error(response.error);
  }

  return {
    provider: runtimeConfig.provider,
    providerDisplayName: runtimeConfig.providerDisplayName,
    model: runtimeConfig.model,
    text: String(response?.text || "").trim(),
    response
  };
}

module.exports = {
  BUILT_IN_PROVIDERS,
  getCustomProviderById,
  getCustomProviders,
  getProviderDisplayName,
  getSavedProviderModel,
  getStoredApiKey,
  resolveProviderRuntimeConfig,
  runProviderPrompt,
  sanitizeApiKey,
  sanitizeExternalUrl,
  resolveCustomProviderChatUrl
};
