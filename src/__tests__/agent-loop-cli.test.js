/* eslint-env jest */
const {
  buildPatchedContent,
  createNarrationStream,
  runSingleAgentTask,
  stripStructuredActions
} = require("../agent-loop-cli");

function createIo() {
  return {
    log: jest.fn(),
    error: jest.fn(),
    write: jest.fn()
  };
}

describe("agent loop cli", () => {
  test("stripStructuredActions keeps narration and removes action blocks", () => {
    expect(
      stripStructuredActions(`I'll inspect the file first.

READ: src/app.js
CMD: npm test
`)
    ).toBe("I'll inspect the file first.");
  });

  test("buildPatchedContent replaces a unique search block", () => {
    expect(
      buildPatchedContent(
        "function add(a, b) {\n  return a - b;\n}\n",
        "return a - b;",
        "return a + b;"
      )
    ).toMatchObject({
      matched: true,
      content: "function add(a, b) {\n  return a + b;\n}\n"
    });
  });

  test("createNarrationStream only emits narration before actions", () => {
    const io = createIo();
    const stream = createNarrationStream(io);

    stream.onChunk("I'll inspect");
    stream.onChunk(" the file.\n\nREAD: src/app.js");
    stream.finalize("I'll inspect the file.\n\nREAD: src/app.js");

    expect(io.write).toHaveBeenCalledWith("I'll inspect");
    expect(io.write).toHaveBeenCalledWith(" the file.\n\n");
    expect(io.log).not.toHaveBeenCalled();
  });

  test("runSingleAgentTask loops through tool results until completion", async () => {
    const io = createIo();
    const agent = {
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          text: "I'll inspect the file.\n\nREAD: src/app.js",
          actions: [{ type: "read", path: "src/app.js" }]
        })
        .mockResolvedValueOnce({
          text: "I found the bug. Final answer: fixed.",
          actions: []
        })
    };
    const executeAction = jest.fn().mockResolvedValue({
      success: true,
      transcript: "READ src/app.js\n```js\nreturn a - b;\n```"
    });

    const exitCode = await runSingleAgentTask(
      agent,
      "Fix the add bug",
      {
        maxSteps: 3,
        workspaceFolder: process.cwd()
      },
      io,
      { executeAction }
    );

    expect(exitCode).toBe(0);
    expect(agent.chat).toHaveBeenCalledTimes(2);
    expect(executeAction).toHaveBeenCalledWith({
      type: "read",
      path: "src/app.js"
    });
    expect(agent.chat.mock.calls[1][0]).toContain("Tool results:");
    expect(io.log).toHaveBeenCalledWith("[tool] READ src/app.js");
  });
});
