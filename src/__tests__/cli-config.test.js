/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  getCliConfigCandidates,
  loadCliConfig,
  resolveCliAiConfig
} = require("../utils/cli-config");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-janitor-cli-config-"));
}

describe("cli config", () => {
  const tempDirs = [];

  beforeEach(() => {
    delete process.env.CODE_JANITOR_CONFIG;
    delete process.env.CODE_JANITOR_NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.CODE_JANITOR_PROVIDER;
    delete process.env.CODE_JANITOR_MODEL;
    delete process.env.CODE_JANITOR_OLLAMA_URL;
    delete process.env.CODE_JANITOR_TIMEOUT;
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test("loads workspace cli config file", () => {
    const workspace = createTempDir();
    tempDirs.push(workspace);
    const configPath = path.join(workspace, ".code-janitor.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ai: {
          provider: "nvidia",
          nvidia: {
            apiKey: "file-key",
            model: "meta/llama-3.1-8b-instruct"
          },
          timeout: 45000
        }
      }),
      "utf8"
    );

    const loaded = loadCliConfig(workspace);

    expect(loaded.path).toBe(configPath);
    expect(loaded.config).toMatchObject({
      provider: "nvidia",
      nvidiaApiKey: "file-key",
      nvidiaModel: "meta/llama-3.1-8b-instruct",
      timeout: 45000
    });
  });

  test("resolves AI settings from config file", () => {
    const workspace = createTempDir();
    tempDirs.push(workspace);
    fs.writeFileSync(
      path.join(workspace, ".code-janitor.json"),
      JSON.stringify({
        ai: {
          provider: "nvidia",
          nvidiaApiKey: "file-key",
          nvidiaModel: "meta/llama-3.1-8b-instruct"
        }
      }),
      "utf8"
    );

    expect(resolveCliAiConfig({ cwd: workspace })).toMatchObject({
      provider: "nvidia",
      model: "meta/llama-3.1-8b-instruct",
      nvidiaApiKey: "file-key"
    });
  });

  test("cli options override config file values", () => {
    const workspace = createTempDir();
    tempDirs.push(workspace);
    fs.writeFileSync(
      path.join(workspace, ".code-janitor.json"),
      JSON.stringify({
        ai: {
          provider: "nvidia",
          nvidiaApiKey: "file-key",
          nvidiaModel: "meta/llama-3.1-8b-instruct"
        }
      }),
      "utf8"
    );

    expect(
      resolveCliAiConfig({
        cwd: workspace,
        provider: "ollama",
        model: "qwen2.5-coder:1.5b"
      })
    ).toMatchObject({
      provider: "ollama",
      model: "qwen2.5-coder:1.5b",
      nvidiaApiKey: "file-key"
    });
  });

  test("env path is checked first", () => {
    const workspace = createTempDir();
    tempDirs.push(workspace);
    const configPath = path.join(workspace, "custom-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ai: {
          provider: "ollama",
          model: "qwen2.5-coder:14b"
        }
      }),
      "utf8"
    );
    process.env.CODE_JANITOR_CONFIG = configPath;

    const candidates = getCliConfigCandidates(workspace);

    expect(candidates[0]).toBe(path.resolve(configPath));
    expect(resolveCliAiConfig({ cwd: workspace })).toMatchObject({
      provider: "ollama",
      model: "qwen2.5-coder:14b"
    });
  });
});
