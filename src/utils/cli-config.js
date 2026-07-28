const fs = require("fs");
const os = require("os");
const path = require("path");

function toTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toNonNegativeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => toTrimmedString(item))
      .filter(Boolean);
  }

  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProvider(value) {
  const provider = toTrimmedString(value).toLowerCase();
  return provider || "";
}

function getDefaultCliConfigPath() {
  return path.join(os.homedir(), ".code-janitor", "config.json");
}

function getCliConfigCandidates(cwd = process.cwd()) {
  const candidates = [];
  const envPath = toTrimmedString(process.env.CODE_JANITOR_CONFIG);
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const homeConfigPath = getDefaultCliConfigPath();

  if (envPath) {
    candidates.push(path.resolve(envPath));
  }

  candidates.push(path.join(resolvedCwd, ".code-janitor.json"));
  candidates.push(path.join(resolvedCwd, ".code-janitor", "config.json"));
  candidates.push(path.join(os.homedir(), ".code-janitor.json"));
  candidates.push(homeConfigPath);

  return Array.from(new Set(candidates));
}

function readObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeCustomProvider(value) {
  const raw = readObject(value);
  const id = normalizeProvider(raw.id);
  const baseUrl = toTrimmedString(raw.baseUrl);
  const defaultModel =
    toTrimmedString(raw.defaultModel) ||
    toTrimmedString(raw.model);

  if (!id || !baseUrl || !defaultModel) {
    return null;
  }

  return {
    id,
    name: toTrimmedString(raw.name) || id,
    baseUrl,
    defaultModel,
    models: Array.from(new Set(toStringArray(raw.models))),
    apiKeyLink: toTrimmedString(raw.apiKeyLink),
    protocol: toTrimmedString(raw.protocol) || "openai",
    apiKey: toTrimmedString(raw.apiKey)
  };
}

function normalizeCustomProviders(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((provider) => normalizeCustomProvider(provider))
    .filter(Boolean);
}

function normalizeCliConfig(rawConfig) {
  const root = readObject(rawConfig);
  const ai = readObject(root.ai);
  const base = Object.keys(ai).length > 0 ? ai : root;
  const providers = readObject(base.providers);
  const nvidia = {
    ...readObject(base.nvidia),
    ...readObject(providers.nvidia)
  };
  const ollama = {
    ...readObject(base.ollama),
    ...readObject(providers.ollama)
  };
  const groq = {
    ...readObject(base.groq),
    ...readObject(providers.groq)
  };
  const openrouter = {
    ...readObject(base.openrouter),
    ...readObject(providers.openrouter)
  };
  const anthropic = {
    ...readObject(base.anthropic),
    ...readObject(providers.anthropic)
  };

  return {
    provider: normalizeProvider(base.provider),
    model: toTrimmedString(base.model),
    nvidiaModel:
      toTrimmedString(base.nvidiaModel) ||
      toTrimmedString(nvidia.model),
    ollamaUrl:
      toTrimmedString(base.ollamaUrl) ||
      toTrimmedString(ollama.url),
    timeout: toNonNegativeNumber(base.timeout),
    nvidiaApiKey:
      toTrimmedString(base.nvidiaApiKey) ||
      toTrimmedString(nvidia.apiKey),
    groqApiKey:
      toTrimmedString(base.groqApiKey) ||
      toTrimmedString(groq.apiKey),
    openrouterApiKey:
      toTrimmedString(base.openrouterApiKey) ||
      toTrimmedString(openrouter.apiKey),
    anthropicApiKey:
      toTrimmedString(base.anthropicApiKey) ||
      toTrimmedString(anthropic.apiKey),
    customProviders: normalizeCustomProviders(base.customProviders)
  };
}

function loadCliConfig(cwd = process.cwd()) {
  let lastError = null;

  for (const candidate of getCliConfigCandidates(cwd)) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return {
        path: candidate,
        config: normalizeCliConfig(raw),
        error: null
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    path: "",
    config: normalizeCliConfig({}),
    error: lastError
  };
}

function mergeDefined(target, source, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }

    const value = source[key];
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        target[key] = trimmed;
      }
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      target[key] = value;
    }
  }
}

function mergeCustomProviders(existing = [], updates = []) {
  const byId = new Map();

  for (const provider of normalizeCustomProviders(existing)) {
    byId.set(provider.id, provider);
  }

  for (const provider of normalizeCustomProviders(updates)) {
    const current = byId.get(provider.id) || {};
    byId.set(provider.id, {
      ...current,
      ...provider,
      apiKey: provider.apiKey || current.apiKey || ""
    });
  }

  return Array.from(byId.values());
}

function writeCliAiConfigPatch(updates = {}, configPath = getDefaultCliConfigPath()) {
  const targetPath = path.resolve(configPath || getDefaultCliConfigPath());
  let existing = {};

  if (fs.existsSync(targetPath)) {
    try {
      existing = readObject(JSON.parse(fs.readFileSync(targetPath, "utf8")));
    } catch {
      existing = {};
    }
  }

  const nextAi = {
    ...readObject(existing.ai)
  };

  mergeDefined(nextAi, updates, [
    "provider",
    "model",
    "nvidiaModel",
    "ollamaUrl",
    "timeout",
    "anthropicApiKey",
    "groqApiKey",
    "nvidiaApiKey",
    "openrouterApiKey"
  ]);

  if (Array.isArray(updates.customProviders)) {
    nextAi.customProviders = mergeCustomProviders(
      nextAi.customProviders,
      updates.customProviders
    );
  }

  const nextConfig = {
    ...existing,
    ai: nextAi
  };

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // Best effort on Windows and filesystems that do not support POSIX modes.
  }

  return {
    path: targetPath,
    config: normalizeCliConfig(nextConfig)
  };
}

function resolveCliAiConfig(options = {}) {
  const cwd = options.workspaceFolder || options.cwd || process.cwd();
  const loaded = loadCliConfig(cwd);
  const fileConfig = loaded.config || {};
  const customProviders = Array.isArray(fileConfig.customProviders)
    ? fileConfig.customProviders
    : [];

  const requestedProvider =
    normalizeProvider(options.provider) ||
    normalizeProvider(process.env.CODE_JANITOR_PROVIDER) ||
    normalizeProvider(fileConfig.provider) ||
    "ollama";
  const selectedCustomProvider =
    customProviders.find((provider) => provider.id === requestedProvider) || null;

  const providerModel =
    requestedProvider === "nvidia"
      ? toTrimmedString(fileConfig.nvidiaModel) || toTrimmedString(fileConfig.model)
      : selectedCustomProvider
        ? toTrimmedString(fileConfig.model) ||
          toTrimmedString(selectedCustomProvider.defaultModel)
      : toTrimmedString(fileConfig.model);

  return {
    configPath: loaded.path,
    provider: requestedProvider,
    model:
      toTrimmedString(options.aiModel) ||
      toTrimmedString(options.model) ||
      toTrimmedString(process.env.CODE_JANITOR_MODEL) ||
      providerModel,
    ollamaUrl:
      toTrimmedString(options.ollamaUrl) ||
      toTrimmedString(process.env.CODE_JANITOR_OLLAMA_URL) ||
      toTrimmedString(fileConfig.ollamaUrl),
    timeout:
      toNonNegativeNumber(options.timeout) ??
      toNonNegativeNumber(process.env.CODE_JANITOR_TIMEOUT) ??
      toNonNegativeNumber(fileConfig.timeout),
    nvidiaApiKey:
      toTrimmedString(options.nvidiaApiKey) ||
      toTrimmedString(process.env.CODE_JANITOR_NVIDIA_API_KEY) ||
      toTrimmedString(process.env.NVIDIA_API_KEY) ||
      toTrimmedString(fileConfig.nvidiaApiKey),
    groqApiKey:
      toTrimmedString(process.env.CODE_JANITOR_GROQ_API_KEY) ||
      toTrimmedString(fileConfig.groqApiKey),
    openrouterApiKey:
      toTrimmedString(process.env.CODE_JANITOR_OPENROUTER_API_KEY) ||
      toTrimmedString(fileConfig.openrouterApiKey),
    anthropicApiKey:
      toTrimmedString(process.env.CODE_JANITOR_ANTHROPIC_API_KEY) ||
      toTrimmedString(fileConfig.anthropicApiKey),
    customProviders
  };
}

module.exports = {
  getCliConfigCandidates,
  getDefaultCliConfigPath,
  loadCliConfig,
  normalizeCliConfig,
  resolveCliAiConfig,
  writeCliAiConfigPatch
};
