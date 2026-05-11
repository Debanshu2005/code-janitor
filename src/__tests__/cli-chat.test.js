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
  normalizeIo,
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

  test("builds NVIDIA runtime config from workspace cli config file", () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "code-janitor-chat-config-"));
    const configPath = path.join(workspace, ".code-janitor.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ai: {
          provider: "nvidia",
          nvidiaApiKey: "file-key",
          nvidiaModel: "meta/llama-3.1-8b-instruct"
        }
      }),
      "utf8"
    );

    expect(buildChatRuntimeConfig({ cwd: workspace })).toMatchObject({
      enabled: true,
      provider: "nvidia",
      model: "meta/llama-3.1-8b-instruct",
      nvidiaApiKey: "file-key"
    });

    fs.rmSync(workspace, { recursive: true, force: true });
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

  test("normalizes console-style io for streamed responses", async () => {
    const io = {
      log: jest.fn(),
      error: jest.fn()
    };
    const stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    mockChat.mockResolvedValue({
      text: "Hello from stream.",
      actions: []
    });

    const exitCode = await runSingleChatTurn(
      { chat: (message, workspace, streamCallback, abortSignal, chatOptions) => {
        streamCallback("Hello ");
        streamCallback("from stream.");
        return mockChat(message, workspace, streamCallback, abortSignal, chatOptions);
      } },
      "Hi",
      {},
      io
    );

    expect(exitCode).toBe(0);
    expect(stdoutSpy).toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });

  test("normalizeIo adds a write fallback", () => {
    const stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const io = normalizeIo({
      log: jest.fn(),
      error: jest.fn()
    });

    io.write("hello");

    expect(stdoutSpy).toHaveBeenCalledWith("hello");
    stdoutSpy.mockRestore();
  });
});
