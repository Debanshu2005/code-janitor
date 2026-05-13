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

  test("rejects ambiguous PATCH searches that match multiple locations", () => {
    const panel = Object.create(ChatPanel.prototype)

    const result = panel._buildPatchedContent(
      "const value = 1;\nconst value = 1;\n",
      "const value = 1;\n",
      "const value = 2;\n"
    )

    expect(result).toMatchObject({
      matched: false,
      reason: "ambiguous_search",
      matchCount: 2
    })
  })

  test("delegates edit-like intent checks to the agent", () => {
    const panel = Object.create(ChatPanel.prototype)
    panel.agent = {
      _shouldTreatAsEditIntent: jest.fn(() => true)
    }

    expect(panel._isEditLikeIntent("refactor", "clean up this file for me")).toBe(
      true
    )
    expect(panel.agent._shouldTreatAsEditIntent).toHaveBeenCalledWith(
      "refactor",
      "clean up this file for me"
    )
  })
})
