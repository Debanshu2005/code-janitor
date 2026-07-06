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

  test("prefers edit intent when an explanation request also asks for a fix", () => {
    const agent = new AIAgent()

    expect(agent._detectIntent("Why is this broken, fix it.")).toBe("edit")
  })

  test("keeps advisory how-do-i fix questions in explain intent", () => {
    const agent = new AIAgent()

    expect(agent._detectIntent("How do I fix this?")).toBe("explain")
  })

  test("treats refactor requests with explicit file changes as structured edits", () => {
    const agent = new AIAgent()

    expect(
      agent._shouldForceStructuredEdit("refactor", "clean up this file for me")
    ).toBe(true)
  })

  test("blocks unsafe command execution escape hatches", () => {
    const agent = new AIAgent()

    expect(agent.validateCommand("arduino-cli compile --fqbn arduino:avr:uno sketch")).toEqual({
      allowed: true
    })
    expect(agent.validateCommand("arduino-cli upload -p COM3 --fqbn arduino:avr:uno sketch")).toEqual({
      allowed: false,
      reason: "Blocked unsafe, global, or network command"
    })
    expect(agent.validateCommand('node -e "console.log(1)"')).toEqual({
      allowed: false,
      reason: "Blocked unsafe, global, or network command"
    })
    expect(agent.validateCommand("git push origin main")).toEqual({
      allowed: false,
      reason: "Blocked unsafe, global, or network command"
    })
  })
})
