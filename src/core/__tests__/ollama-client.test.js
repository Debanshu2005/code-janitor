/* eslint-env jest */
const OllamaClient = require("../ai/ollama-client");

describe("OllamaClient runtime config", () => {
  afterEach(() => {
    OllamaClient.clearRuntimeConfig();
  });

  test("uses runtime config outside VS Code", () => {
    OllamaClient.configureRuntime({
      enabled: true,
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5-coder:7b",
      timeout: 45000
    });

    const client = new OllamaClient();

    expect(client.getConfig()).toEqual({
      enabled: true,
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5-coder:7b",
      nvidiaApiKey: "",
      timeout: 45000
    });
  });

  test("normalizes NVIDIA runtime config outside VS Code", () => {
    OllamaClient.configureRuntime({
      enabled: true,
      provider: "nvidia",
      model: "nvidia/minimax-m2.7",
      nvidiaApiKey: "secret-token",
      timeout: 60000
    });

    const client = new OllamaClient();

    expect(client.getConfig()).toEqual({
      enabled: true,
      provider: "nvidia",
      baseUrl: "http://localhost:11434",
      model: "minimaxai/minimax-m2.7",
      nvidiaApiKey: "secret-token",
      timeout: 60000
    });
  });
});
