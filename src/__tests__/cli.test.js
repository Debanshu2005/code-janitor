/* eslint-env jest */
const mockAnalyzeTarget = jest.fn();
const mockRunAgentCli = jest.fn();
const mockRunChatCli = jest.fn();

jest.mock("../core/janitor", () => ({
  analyzeTarget: (...args) => mockAnalyzeTarget(...args)
}));

jest.mock("../agent-loop-cli", () => ({
  runAgentCli: (...args) => mockRunAgentCli(...args)
}));

jest.mock("../cli-chat", () => ({
  runChatCli: (...args) => mockRunChatCli(...args)
}));

const { getHelpText, parseArgs, runCli } = require("../cli");

function createIo() {
  return {
    log: jest.fn(),
    error: jest.fn()
  };
}

describe("cli", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("parses flags and positional target", () => {
    expect(parseArgs(["src/app.js", "--check", "--json"])).toMatchObject({
      command: "fix",
      targetPath: "src/app.js",
      check: true,
      json: true,
      write: false
    });
  });

  test("defaults to the interactive agent session with no arguments", () => {
    expect(parseArgs([])).toMatchObject({
      command: "agent",
      interactiveDefault: true
    });
  });

  test("parses AI model options", () => {
    expect(
      parseArgs([
        "src/broken.py",
        "--ai",
        "--model",
        "qwen2.5-coder:7b",
        "--ollama-url",
        "http://127.0.0.1:11434",
        "--timeout",
        "45000"
      ])
    ).toMatchObject({
      targetPath: "src/broken.py",
      ai: true,
      model: "qwen2.5-coder:7b",
      ollamaUrl: "http://127.0.0.1:11434",
      timeout: 45000
    });
  });

  test("allows disabling the AI timeout from the CLI", () => {
    expect(parseArgs(["src/broken.py", "--ai", "--timeout", "0"])).toMatchObject({
      targetPath: "src/broken.py",
      ai: true,
      timeout: 0
    });
  });

  test("parses chat subcommand with free-form message", () => {
    expect(
      parseArgs(["chat", "explain", "src/extension.js", "--mode", "heavy"])
    ).toMatchObject({
      command: "chat",
      chatMessage: "explain src/extension.js",
      mode: "heavy"
    });
  });

  test("parses NVIDIA CLI options", () => {
    expect(
      parseArgs([
        "src/broken.js",
        "--ai",
        "--provider",
        "nvidia",
        "--model",
        "meta/llama-3.1-8b-instruct",
        "--nvidia-api-key",
        "secret-token"
      ])
    ).toMatchObject({
      targetPath: "src/broken.js",
      ai: true,
      provider: "nvidia",
      model: "meta/llama-3.1-8b-instruct",
      nvidiaApiKey: "secret-token"
    });
  });

  test("parses agent subcommand with free-form task", () => {
    expect(
      parseArgs(["agent", "fix", "src/cli.js", "--mode", "heavy", "--max-steps", "8"])
    ).toMatchObject({
      command: "agent",
      agentMessage: "fix src/cli.js",
      mode: "heavy",
      maxSteps: 8
    });
  });

  test("parses exec as a one-shot agent task", () => {
    expect(
      parseArgs(["exec", "fix", "the", "CLI", "--mode", "deep", "--max-steps", "4"])
    ).toMatchObject({
      command: "exec",
      agentMessage: "fix the CLI",
      mode: "deep",
      maxSteps: 4
    });
  });

  test("parses non-nvidia provider options", () => {
    expect(
      parseArgs([
        "agent",
        "debug",
        "tests",
        "--provider",
        "anthropic",
        "--model",
        "claude-sonnet-4-5"
      ])
    ).toMatchObject({
      command: "agent",
      provider: "anthropic",
      model: "claude-sonnet-4-5"
    });
  });

  test("returns check failure when files would change", async () => {
    const io = createIo();
    mockAnalyzeTarget.mockResolvedValue({
      targetPath: "D:\\project",
      mode: "check",
      filesProcessed: 2,
      filesFixed: 1,
      filesWritten: 0,
      totalFixes: 3,
      fixedFiles: ["D:\\project\\broken.js"],
      writtenFiles: [],
      skippedFiles: [],
      errors: [],
      fileResults: []
    });

    const exitCode = await runCli(["D:\\project", "--check"], io);

    expect(exitCode).toBe(1);
    expect(mockAnalyzeTarget).toHaveBeenCalledWith("D:\\project", {
      ai: false,
      aiModel: "",
      nvidiaApiKey: "",
      ollamaUrl: "",
      provider: "",
      timeout: null,
      write: false
    });
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining("Files needing changes"));
  });

  test("prints JSON output when requested", async () => {
    const io = createIo();
    mockAnalyzeTarget.mockResolvedValue({
      targetPath: "D:\\project",
      mode: "write",
      filesProcessed: 1,
      filesFixed: 1,
      filesWritten: 1,
      totalFixes: 1,
      fixedFiles: ["D:\\project\\ok.js"],
      writtenFiles: ["D:\\project\\ok.js"],
      skippedFiles: [],
      errors: [],
      fileResults: []
    });

    const exitCode = await runCli(["D:\\project", "--json"], io);

    expect(exitCode).toBe(0);
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining("\"filesWritten\": 1"));
  });

  test("passes AI CLI options through to janitor", async () => {
    const io = createIo();
    mockAnalyzeTarget.mockResolvedValue({
      targetPath: "D:\\project",
      mode: "write",
      filesProcessed: 1,
      filesFixed: 0,
      filesWritten: 0,
      totalFixes: 0,
      fixedFiles: [],
      writtenFiles: [],
      skippedFiles: [],
      errors: [],
      fileResults: []
    });

    const exitCode = await runCli(
      [
        "D:\\project",
        "--ai",
        "--model",
        "qwen2.5-coder:7b",
        "--ollama-url",
        "http://127.0.0.1:11434",
        "--timeout",
        "45000"
      ],
      io
    );

    expect(exitCode).toBe(0);
    expect(mockAnalyzeTarget).toHaveBeenCalledWith("D:\\project", {
      ai: true,
      aiModel: "qwen2.5-coder:7b",
      nvidiaApiKey: "",
      ollamaUrl: "http://127.0.0.1:11434",
      provider: "",
      timeout: 45000,
      write: true
    });
  });

  test("passes NVIDIA CLI options through to janitor", async () => {
    const io = createIo();
    mockAnalyzeTarget.mockResolvedValue({
      targetPath: "D:\\project",
      mode: "write",
      filesProcessed: 1,
      filesFixed: 0,
      filesWritten: 0,
      totalFixes: 0,
      fixedFiles: [],
      writtenFiles: [],
      skippedFiles: [],
      errors: [],
      fileResults: []
    });

    const exitCode = await runCli(
      [
        "D:\\project",
        "--ai",
        "--provider",
        "nvidia",
        "--model",
        "meta/llama-3.1-8b-instruct",
        "--nvidia-api-key",
        "secret-token"
      ],
      io
    );

    expect(exitCode).toBe(0);
    expect(mockAnalyzeTarget).toHaveBeenCalledWith("D:\\project", {
      ai: true,
      aiModel: "meta/llama-3.1-8b-instruct",
      nvidiaApiKey: "secret-token",
      ollamaUrl: "",
      provider: "nvidia",
      timeout: null,
      write: true
    });
  });

  test("shows help for unknown flags", async () => {
    const io = createIo();

    const exitCode = await runCli(["--wat"], io);

    expect(exitCode).toBe(2);
    expect(io.error).toHaveBeenCalledWith("Unknown option: --wat");
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("code-janitor exec <task>"));
    expect(getHelpText()).toContain("Running code-janitor with no arguments opens the interactive agent session.");
  });

  test("delegates chat subcommand to chat runner", async () => {
    const io = createIo();
    mockRunChatCli.mockResolvedValue(0);

    const exitCode = await runCli(["chat", "hello", "there", "--mode", "deep"], io);

    expect(exitCode).toBe(0);
    expect(mockRunChatCli).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "chat",
        chatMessage: "hello there",
        mode: "deep"
      }),
      io
    );
  });

  test("delegates agent subcommand to agent runner", async () => {
    const io = createIo();
    mockRunAgentCli.mockResolvedValue(0);

    const exitCode = await runCli(
      ["agent", "fix", "src/cli.js", "--mode", "deep", "--max-steps", "5"],
      io
    );

    expect(exitCode).toBe(0);
    expect(mockRunAgentCli).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "agent",
        agentMessage: "fix src/cli.js",
        mode: "deep",
        maxSteps: 5
      }),
      io
    );
  });

  test("delegates exec subcommand to agent runner", async () => {
    const io = createIo();
    mockRunAgentCli.mockResolvedValue(0);

    const exitCode = await runCli(
      ["exec", "debug", "the", "CLI", "--mode", "deep", "--max-steps", "5"],
      io
    );

    expect(exitCode).toBe(0);
    expect(mockRunAgentCli).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "exec",
        agentMessage: "debug the CLI",
        mode: "deep",
        maxSteps: 5
      }),
      io
    );
  });

  test("delegates bare invocation to the interactive agent runner", async () => {
    const io = createIo();
    mockRunAgentCli.mockResolvedValue(0);

    const exitCode = await runCli([], io);

    expect(exitCode).toBe(0);
    expect(mockRunAgentCli).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "agent",
        interactiveDefault: true
      }),
      io
    );
  });
});
