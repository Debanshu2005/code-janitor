/* eslint-env jest */
const mockChat = jest.fn();

jest.mock("../ai-agent/agent", () =>
  jest.fn().mockImplementation(() => ({
    chat: (...args) => mockChat(...args)
  }))
);

const {
  buildChatRuntimeConfig,
  getReadOnlyOverlay,
  runSingleChatTurn
} = require("../cli-chat");

describe("cli chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CODE_JANITOR_NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;
  });

  test("builds NVIDIA runtime config from env", () => {
    process.env.NVIDIA_API_KEY = "secret-token";

    expect(
      buildChatRuntimeConfig({
        provider: "nvidia",
        model: "meta/llama-3.1-8b-instruct"
      })
    ).toMatchObject({
      enabled: true,
      provider: "nvidia",
      model: "meta/llama-3.1-8b-instruct",
      nvidiaApiKey: "secret-token"
    });
  });

  test("uses read-only overlay for chat turns", async () => {
    const writes = [];
    const io = {
      log: jest.fn(),
      error: jest.fn(),
      write: (text) => writes.push(String(text))
    };
    mockChat.mockResolvedValue({
      text: "Hello from chat.",
      actions: []
    });

    const exitCode = await runSingleChatTurn(
      { chat: mockChat },
      "Explain this repo",
      {
        mode: "heavy",
        provider: "nvidia",
        model: "meta/llama-3.1-8b-instruct",
        nvidiaApiKey: "secret-token"
      },
      io
    );

    expect(exitCode).toBe(0);
    expect(mockChat).toHaveBeenCalledWith(
      "Explain this repo",
      expect.any(String),
      expect.any(Function),
      null,
      expect.objectContaining({
        mode: "heavy",
        runtimeConfig: expect.objectContaining({
          provider: "nvidia",
          model: "meta/llama-3.1-8b-instruct",
          nvidiaApiKey: "secret-token"
        }),
        systemOverlay: getReadOnlyOverlay()
      })
    );
    expect(io.log).toHaveBeenCalledWith("Hello from chat.");
    expect(writes).toEqual([]);
  });
});
