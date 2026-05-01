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
);

jest.mock("../agent", () => jest.fn());
jest.mock("../../self-healing/performance-monitor", () => jest.fn());

const ChatPanel = require("../chat-panel");

describe("ChatPanel structured edit helpers", () => {
  test("builds patched content across CRLF differences", () => {
    const panel = Object.create(ChatPanel.prototype);

    const result = panel._buildPatchedContent(
      "const answer = 41;\r\nconsole.log(answer);\r\n",
      "const answer = 41;\n",
      "const answer = 42;\n"
    );

    expect(result).toEqual({
      matched: true,
      content: "const answer = 42;\r\nconsole.log(answer);\r\n"
    });
  });

  test("builds patched content when whitespace differs", () => {
    const panel = Object.create(ChatPanel.prototype);

    const result = panel._buildPatchedContent(
      "function greet(name) {\n    return name;\n}\n",
      "function greet(name) {\n  return name;\n}\n",
      "function greet(name) {\n  return name.trim();\n}\n"
    );

    expect(result.matched).toBe(true);
    expect(result.content).toContain("return name.trim();");
  });

  test("rejects ambiguous PATCH searches that match multiple locations", () => {
    const panel = Object.create(ChatPanel.prototype);

    const result = panel._buildPatchedContent(
      "const value = 1;\nconst value = 1;\n",
      "const value = 1;\n",
      "const value = 2;\n"
    );

    expect(result).toMatchObject({
      matched: false,
      reason: "ambiguous_search",
      matchCount: 2
    });
  });

  test("planned action summary includes patch actions", () => {
    const panel = Object.create(ChatPanel.prototype);

    const summary = panel._summarizePlannedActions(
      [{ type: "patch", path: "src/app.js" }],
      [{ action: { type: "patch", path: "src/app.js" }, result: null }],
      []
    );

    expect(summary).toContain("patch src/app.js");
  });

  test("queued bugfix mode override is one-shot and falls back to chat mode", () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.chatMode = "fast";
    panel._queuedModeOverride = null;

    panel._queueModeOverride("bugfix");

    expect(panel._getRequestMode()).toBe("bugfix");
    expect(panel._consumeQueuedModeOverride()).toBe("bugfix");
    expect(panel._getRequestMode()).toBe("fast");
  });

  test("bugfix mode skips workspace preparation", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(panel._shouldPrepareWorkspaceContext("debug", "scan the active file", "bugfix")).toBe(false);
    expect(panel._shouldPrepareWorkspaceContext("scan", "scan the workspace", "heavy")).toBe(true);
  });

  test("detects explicit tool-oriented command requests", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(panel._hasExplicitCommandRequest("use rg to find the config")).toBe(true);
    expect(panel._hasExplicitCommandRequest("run npm test")).toBe(true);
    expect(panel._hasExplicitCommandRequest("fix this bug")).toBe(false);
  });

  test("suppresses generated commands only when edits are also being applied implicitly", () => {
    const panel = Object.create(ChatPanel.prototype);

    expect(
      panel._shouldSuppressGeneratedCommand(true, false, [
        { type: "patch", path: "src/app.js" },
        { type: "cmd", command: "npm test" }
      ])
    ).toBe(true);
    expect(
      panel._shouldSuppressGeneratedCommand(true, false, [
        { type: "cmd", command: "npm test" }
      ])
    ).toBe(false);
    expect(
      panel._shouldSuppressGeneratedCommand(true, true, [
        { type: "patch", path: "src/app.js" },
        { type: "cmd", command: "npm test" }
      ])
    ).toBe(false);
  });

  test("recovers a failed patch by requesting a broader patch and applying it", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.chatMode = "fast";
    const runtimeConfig = {
      provider: "custom:test",
      model: "gpt-like",
      customProvider: {
        apiKey: "secret",
        chatCompletionsUrl: "https://example.test/v1/chat/completions"
      }
    };
    panel.agent = {
      chat: jest.fn().mockResolvedValue({
        text: "PATCH: package.json",
        actions: [
          {
            type: "patch",
            path: "package.json",
            search: '"version": "1.16.5"',
            replace: '"version": "1.16.6"'
          }
        ]
      }),
      applyChanges: jest.fn().mockResolvedValue({
        success: true,
        path: "/workspace/package.json",
        relativePath: "package.json",
        changeSummary: "1 replacement"
      })
    };
    panel._postMessage = jest.fn();
    panel._shouldSuppressInternalStatus = jest.fn(() => false);

    const result = await panel._recoverFailedPatch(
      "bump the version in package.json",
      "/workspace",
      {
        type: "patch",
        path: "package.json",
        search: '"version": "1.16.4"',
        replace: '"version": "1.16.6"'
      },
      '{\n  "version": "1.16.5"\n}\n',
      false,
      {},
      runtimeConfig
    );

    expect(panel.agent.chat).toHaveBeenCalledTimes(1);
    expect(panel.agent.chat.mock.calls[0][0]).toContain("Prefer exactly one PATCH action");
    expect(panel.agent.chat.mock.calls[0][4]).toMatchObject({
      mode: "heavy",
      intentOverride: "edit",
      runtimeConfig
    });
    expect(panel.agent.applyChanges).toHaveBeenCalledWith(
      "package.json",
      '{\n  "version": "1.16.6"\n}\n',
      false,
      {}
    );
    expect(result.success).toBe(true);
  });

  test("falls back to FILE when patch retries are still unreliable", async () => {
    const panel = Object.create(ChatPanel.prototype);
    panel.chatMode = "heavy";
    const runtimeConfig = {
      provider: "custom:test",
      model: "gpt-like",
      customProvider: {
        apiKey: "secret",
        chatCompletionsUrl: "https://example.test/v1/chat/completions"
      }
    };
    panel.agent = {
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          text: "PATCH: package.json",
          actions: [
            {
              type: "patch",
              path: "package.json",
              search: '"version": "9.9.9"',
              replace: '"version": "1.16.6"'
            }
          ]
        })
        .mockResolvedValueOnce({
          text: "FILE: package.json",
          actions: [
            {
              type: "file",
              path: "package.json",
              content: '{\n  "version": "1.16.6"\n}\n'
            }
          ]
        }),
      applyChanges: jest.fn().mockResolvedValue({
        success: true,
        path: "/workspace/package.json",
        relativePath: "package.json",
        changeSummary: "rewrote file"
      })
    };
    panel._postMessage = jest.fn();
    panel._shouldSuppressInternalStatus = jest.fn(() => false);

    const result = await panel._recoverFailedPatch(
      "bump the version in package.json",
      "/workspace",
      {
        type: "patch",
        path: "package.json",
        search: '"version": "1.16.4"',
        replace: '"version": "1.16.6"'
      },
      '{\n  "version": "1.16.5"\n}\n',
      false,
      {},
      runtimeConfig
    );

    expect(panel.agent.chat).toHaveBeenCalledTimes(2);
    expect(panel.agent.chat.mock.calls[1][0]).toContain("Return exactly one FILE action");
    expect(panel.agent.chat.mock.calls[0][4]).toMatchObject({
      mode: "heavy",
      intentOverride: "edit",
      runtimeConfig
    });
    expect(panel.agent.chat.mock.calls[1][4]).toMatchObject({
      mode: "heavy",
      intentOverride: "edit",
      runtimeConfig
    });
    expect(panel.agent.applyChanges).toHaveBeenCalledWith(
      "package.json",
      '{\n  "version": "1.16.6"\n}\n',
      false,
      {}
    );
    expect(result.success).toBe(true);
  });
});
