/* eslint-env jest */

const {
  ToolGuardrailManager,
  guardrailBlock,
  estimateStringSize
} = require("../tool-guardrails");

describe("ToolGuardrailManager", () => {
  test("rejects non-object tool parameters", async () => {
    const guardrails = new ToolGuardrailManager();
    const result = await guardrails.runInputGuardrails({
      toolName: "read_file",
      params: null
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/JSON object/i);
  });

  test("rejects oversized parameters and output", async () => {
    const guardrails = new ToolGuardrailManager({
      maxStringParamChars: 4,
      maxOutputChars: 4
    });

    await expect(
      guardrails.runInputGuardrails({
        toolName: "insert_content",
        params: { content: "too long" }
      })
    ).resolves.toEqual(expect.objectContaining({ allowed: false }));

    await expect(
      guardrails.runOutputGuardrails({
        toolName: "read_file",
        result: { text: "too long" }
      })
    ).resolves.toEqual(expect.objectContaining({ allowed: false }));
  });

  test("supports custom guardrails and cyclic objects", async () => {
    const guardrails = new ToolGuardrailManager();
    const params = { value: "abc" };
    params.self = params;

    guardrails.registerInputGuardrail("custom_block", () =>
      guardrailBlock("custom reason")
    );

    const result = await guardrails.runInputGuardrails({
      toolName: "custom_tool",
      params
    });

    expect(estimateStringSize(params)).toBe(3);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("custom reason");
  });
});
