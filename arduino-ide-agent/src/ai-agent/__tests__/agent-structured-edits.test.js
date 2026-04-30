/* eslint-env jest */
jest.mock(
  "vscode",
  () => ({
    window: {
      activeTextEditor: null,
      onDidChangeActiveTextEditor: jest.fn()
    },
    workspace: {
      workspaceFolders: [],
      onDidSaveTextDocument: jest.fn(),
      onDidOpenTextDocument: jest.fn(),
      onDidCloseTextDocument: jest.fn()
    }
  }),
  { virtual: true }
)

const AIAgent = require("../agent")

describe("Arduino AIAgent structured edit parsing", () => {
  test("treats PATCH actions as valid edit actions", () => {
    const agent = new AIAgent()
    const response = [
      "PATCH: src/example.ino",
      "SEARCH:",
      "```cpp",
      "digitalWrite(LED_BUILTIN, LOW);",
      "```",
      "REPLACE:",
      "```cpp",
      "digitalWrite(LED_BUILTIN, HIGH);",
      "```"
    ].join("\n")

    const parsed = agent._parseResponse(response)

    expect(parsed.actions).toEqual([
      {
        type: "patch",
        path: "src/example.ino",
        search: "digitalWrite(LED_BUILTIN, LOW);\n",
        replace: "digitalWrite(LED_BUILTIN, HIGH);\n"
      }
    ])
    expect(
      agent._hasRequiredActions("edit", "please edit src/example.ino", parsed.actions)
    ).toBe(true)
  })

  test("parses PATCH blocks with CRLF line endings", () => {
    const agent = new AIAgent()
    const response =
      "PATCH: src/example.ino\r\nSEARCH:\r\n```cpp\r\nold line\r\n```\r\nREPLACE:\r\n```cpp\r\nnew line\r\n```"

    const parsed = agent._parseResponse(response)

    expect(parsed.actions).toHaveLength(1)
    expect(parsed.actions[0]).toMatchObject({
      type: "patch",
      path: "src/example.ino",
      search: "old line\r\n",
      replace: "new line\r\n"
    })
  })

  test("prefers source files over generated copies when matching path hints", () => {
    const agent = new AIAgent()
    agent.codebaseContext = new Map([
      ["src/ai-agent/chat-panel.html", {}],
      [".tmp-vsix-100/extension/src/ai-agent/chat-panel.html", {}]
    ])

    expect(agent._matchPathsFromHints(["src/ai-agent/chat-panel.html"])).toEqual([
      "src/ai-agent/chat-panel.html"
    ])
  })
})
