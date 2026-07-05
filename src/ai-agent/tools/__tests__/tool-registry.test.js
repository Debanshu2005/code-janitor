/* eslint-env jest */

const fs = require("fs").promises;
const os = require("os");
const path = require("path");

const { ToolRegistry } = require("../tool-registry");

describe("ToolRegistry validators", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-registry-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("rejects malformed apply_diff payloads before tool execution", async () => {
    const registry = new ToolRegistry();
    const filePath = path.join(tempDir, "example.js");

    await fs.writeFile(filePath, "const answer = 41;\n", "utf8");

    await expect(
      registry.executeTool(
        "apply_diff",
        {
          path: filePath,
          diff: "not a SEARCH/REPLACE diff"
        },
        tempDir
      )
    ).rejects.toThrow(/No valid SEARCH\/REPLACE blocks/i);
  });

  test("documents full SEARCH/REPLACE syntax for apply_diff", () => {
    const registry = new ToolRegistry();
    const help = registry.getHelp("apply_diff");

    expect(help).toContain("<<<<<<< SEARCH");
    expect(help).toContain(":start_line: 10");
    expect(help).toContain(">>>>>>> REPLACE");
  });

  test("rejects insert_content requests with out-of-range line numbers", async () => {
    const registry = new ToolRegistry();
    const filePath = path.join(tempDir, "example.js");

    await fs.writeFile(filePath, "const answer = 41;\n", "utf8");

    await expect(
      registry.executeTool(
        "insert_content",
        {
          path: filePath,
          line: 10,
          content: "console.log(answer);"
        },
        tempDir
      )
    ).rejects.toThrow(/exceeds file length/i);

    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("const answer = 41;\n");
  });

  test("rejects invalid attempt_completion payloads through the registry", async () => {
    const registry = new ToolRegistry();

    await expect(
      registry.executeTool(
        "attempt_completion",
        {
          result: "Great, would you like me to keep going?"
        },
        tempDir
      )
    ).rejects.toThrow(/should not end with a question|should not start/i);
  });

  test("runs input guardrails before schema validation", async () => {
    const registry = new ToolRegistry();

    await expect(
      registry.executeTool("attempt_completion", null, tempDir)
    ).rejects.toThrow(/Tool input guardrail blocked attempt_completion/i);
  });

  test("blocks oversized tool output and records a failed execution", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "huge_output",
      description: "Returns a response larger than the output guardrail limit",
      params: {},
      handler: async () => "x".repeat(2_000_001)
    });

    await expect(
      registry.executeTool("huge_output", {}, tempDir)
    ).rejects.toThrow(/Tool output guardrail blocked huge_output/i);

    expect(registry.getHistory(1)[0]).toEqual(
      expect.objectContaining({
        tool: "huge_output",
        success: false
      })
    );
  });

  test("emits trace spans around tool execution", async () => {
    const registry = new ToolRegistry();
    const trace = {
      startSpan: jest.fn(() => ({ id: "span-1", name: "tool_call" })),
      endSpan: jest.fn()
    };

    registry.registerTool({
      name: "noop",
      description: "No-op test tool",
      params: {},
      handler: async () => ({ ok: true })
    });

    await registry.executeTool("noop", {}, tempDir, { trace });

    expect(trace.startSpan).toHaveBeenCalledWith(
      "tool_call",
      expect.objectContaining({ toolName: "noop" })
    );
    expect(trace.endSpan).toHaveBeenCalledWith(
      expect.objectContaining({ id: "span-1" }),
      "completed",
      expect.objectContaining({ durationMs: expect.any(Number) })
    );
  });
});
