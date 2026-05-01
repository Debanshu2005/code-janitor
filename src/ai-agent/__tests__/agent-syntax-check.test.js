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

describe("AIAgent HTML syntax checks", () => {
  test("flags invalid inline CSS inside HTML", async () => {
    const agent = new AIAgent();
    const html = `<!DOCTYPE html>
<html>
  <head>
    <style>
      *,
      *::before,
      *::after {it
        margin: 0;
      }
    </style>
  </head>
  <body></body>
</html>`;

    const result = await agent._runSyntaxCheck(
      "src/ai-agent/chat-panel.html",
      null,
      html
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("HTML CSS syntax error");
  });

  test("flags invalid inline JavaScript inside HTML", async () => {
    const agent = new AIAgent();
    const html = `<!DOCTYPE html>
<html>
  <body>
    <script>
      function broken( {
        return true;
      }
    </script>
  </body>
</html>`;

    const result = await agent._runSyntaxCheck("broken.html", null, html);

    expect(result.success).toBe(false);
    expect(result.error).toContain("HTML JavaScript syntax error");
  });
});
