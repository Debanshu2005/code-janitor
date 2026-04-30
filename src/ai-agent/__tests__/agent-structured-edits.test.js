/* eslint-env jest */
jest.mock(
  "vscode",
  () => ({
    window: {
      activeTextEditor: null,
      onDidChangeActiveTextEditor: jest.fn()
    },
    workspace: {
      workspaceFolders: []
    }
  }),
  { virtual: true }
);

const AIAgent = require("../agent");

describe("AIAgent structured edit parsing", () => {
  test("treats PATCH actions as valid edit actions", () => {
    const agent = new AIAgent();
    const response = [
      "PATCH: src/example.js",
      "SEARCH:",
      "```js",
      "const answer = 41;",
      "```",
      "REPLACE:",
      "```js",
      "const answer = 42;",
      "```"
    ].join("\n");

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toEqual([
      {
        type: "patch",
        path: "src/example.js",
        search: "const answer = 41;\n",
        replace: "const answer = 42;\n"
      }
    ]);
    expect(
      agent._hasRequiredActions("edit", "please edit src/example.js", parsed.actions)
    ).toBe(true);
  });

  test("parses PATCH blocks with CRLF line endings", () => {
    const agent = new AIAgent();
    const response =
      "PATCH: src/example.js\r\nSEARCH:\r\n```js\r\nold line\r\n```\r\nREPLACE:\r\n```js\r\nnew line\r\n```";

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]).toMatchObject({
      type: "patch",
      path: "src/example.js",
      search: "old line\r\n",
      replace: "new line\r\n"
    });
  });

  test("allows clarifying questions for edit requests without treating them as invalid prose", () => {
    const agent = new AIAgent();
    const response =
      "Which file should I update, and what exact behavior do you want changed?";

    expect(
      agent._isClarificationResponse(response, "edit", "fix this for me")
    ).toBe(true);
  });

  test("parses CMD actions as executable command steps", () => {
    const agent = new AIAgent();
    const response = "CMD: npm test";

    const parsed = agent._parseResponse(response);

    expect(parsed.actions).toEqual([
      {
        type: "cmd",
        command: "npm test"
      }
    ]);
  });

  test("prefers source files over generated copies when matching path hints", () => {
    const agent = new AIAgent();
    agent.codebaseContext = new Map([
      ["src/ai-agent/chat-panel.html", {}],
      [".tmp-vsix-100/extension/src/ai-agent/chat-panel.html", {}]
    ]);

    expect(agent._matchPathsFromHints(["src/ai-agent/chat-panel.html"])).toEqual([
      "src/ai-agent/chat-panel.html"
    ]);
  });

  test("allows internal list commands with --format flags but still blocks chained commands", () => {
    const agent = new AIAgent();

    expect(agent.validateCommand("pip list --format=json")).toEqual({
      allowed: true
    });
    expect(agent.validateCommand("arduino-cli lib list --format json")).toEqual({
      allowed: true
    });
    expect(agent.validateCommand("npm test && git status")).toEqual({
      allowed: false,
      reason: "Use one project-scoped command per CMD line (no chaining)"
    });
  });

  test("allows safe PowerShell read commands for workspace inspection", () => {
    const agent = new AIAgent();

    expect(agent.validateCommand("Get-Content package.json")).toEqual({
      allowed: true
    });
    expect(agent.validateCommand("Select-String -Path src/ai-agent/agent.js -Pattern thinking")).toEqual({
      allowed: true
    });
  });

  test("thinking mode instructions request visible Thinking and Answer sections", () => {
    const agent = new AIAgent();

    const instruction = agent._buildSystemInstruction("scan", "", "fast", true);

    expect(instruction).toContain('heading titled "Thinking"');
    expect(instruction).toContain('heading titled "Answer"');
    expect(instruction).toContain("Do not expose hidden internal chain-of-thought");
  });
});
