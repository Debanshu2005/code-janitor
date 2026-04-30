/* eslint-env jest */
jest.mock(
  "vscode",
  () => ({
    window: {
      activeTextEditor: null,
      onDidChangeActiveTextEditor: jest.fn()
    },
    workspace: {
      getConfiguration: jest.fn(() => ({
        get: jest.fn(),
        update: jest.fn()
      }))
    }
  }),
  { virtual: true }
)

jest.mock("../agent", () => jest.fn())

const ChatPanel = require("../chat-panel")

describe("Arduino ChatPanel structured edit helpers", () => {
  test("builds patched content across CRLF differences", () => {
    const panel = Object.create(ChatPanel.prototype)

    const result = panel._buildPatchedContent(
      "const answer = 41;\r\nSerial.println(answer);\r\n",
      "const answer = 41;\n",
      "const answer = 42;\n"
    )

    expect(result).toEqual({
      matched: true,
      content: "const answer = 42;\r\nSerial.println(answer);\r\n"
    })
  })

  test("planned action summary includes patch actions", () => {
    const panel = Object.create(ChatPanel.prototype)

    const summary = panel._summarizePlannedActions(
      [{ type: "patch", path: "src/example.ino" }],
      [{ action: { type: "patch", path: "src/example.ino" }, result: null }],
      []
    )

    expect(summary).toContain("patch src/example.ino")
  })
})
