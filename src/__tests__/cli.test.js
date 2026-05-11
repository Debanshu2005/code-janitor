/* eslint-env jest */
const mockAnalyzeTarget = jest.fn();

jest.mock("../core/janitor", () => ({
  analyzeTarget: (...args) => mockAnalyzeTarget(...args)
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
      targetPath: "src/app.js",
      check: true,
      json: true,
      write: false
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

  test("shows help for unknown flags", async () => {
    const io = createIo();

    const exitCode = await runCli(["--wat"], io);

    expect(exitCode).toBe(2);
    expect(io.error).toHaveBeenCalledWith("Unknown option: --wat");
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("Usage: code-janitor"));
    expect(getHelpText()).toContain("--check");
  });
});
