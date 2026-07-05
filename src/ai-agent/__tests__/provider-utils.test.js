/* eslint-env jest */

const vscode = require("../../utils/vscode-shim");
const {
  getStoredApiKey,
  resolveProviderRuntimeConfig
} = require("../provider-utils");

describe("provider-utils credentials", () => {
  beforeEach(() => {
    jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: jest.fn((key, fallback) => {
        if (key === "groqApiKey") return "plaintext-setting-key";
        return fallback;
      })
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("getStoredApiKey ignores plaintext VS Code settings", async () => {
    const context = {
      secrets: {
        get: jest.fn().mockResolvedValue("")
      }
    };

    await expect(getStoredApiKey(context, "groq")).resolves.toBe("");
  });

  test("resolveProviderRuntimeConfig reports missing credentials without settings fallback", async () => {
    const context = {
      secrets: {
        get: jest.fn().mockResolvedValue("")
      },
      globalState: {
        get: jest.fn().mockReturnValue([])
      }
    };
    const agent = {
      getConfig: jest.fn().mockReturnValue({
        provider: "groq",
        model: "llama-3.1-8b-instant"
      }),
      _getDefaultModelForProvider: jest.fn().mockReturnValue("llama-3.1-8b-instant")
    };

    const config = await resolveProviderRuntimeConfig({ context, agent });

    expect(config.provider).toBe("groq");
    expect(config.groqApiKey).toBe("");
    expect(config.hasRequiredCredentials).toBe(false);
  });
});
