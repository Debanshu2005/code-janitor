/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

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

  test("accepts absolute HTML paths when workspaceFolder is also provided", async () => {
    const agent = new AIAgent();
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "code-janitor-html-")
    );
    const htmlPath = path.join(tempDir, "my_portfolio.html");

    jest
      .spyOn(agent, "_loadParse5")
      .mockResolvedValue({ parse: jest.fn() });
    jest
      .spyOn(agent, "_validateEmbeddedHtmlSyntax")
      .mockResolvedValue(null);

    await fs.promises.writeFile(
      htmlPath,
      "<!DOCTYPE html><html><body><h1>Portfolio</h1></body></html>",
      "utf8"
    );

    try {
      const result = await agent._runSyntaxCheck(htmlPath, tempDir, null);
      expect(result).toEqual({ success: true, output: "" });
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("AIAgent command syntax checks", () => {
  test("quotes Python syntax check paths that contain spaces", async () => {
    const agent = new AIAgent();
    const executeCommand = jest
      .spyOn(agent, "executeCommand")
      .mockResolvedValue({
        success: false,
        error: "SyntaxError: invalid syntax",
        output: "SyntaxError: invalid syntax"
      });

    const result = await agent._runSyntaxCheck(
      "folder with space/ai_module.py",
      "C:/workspace",
      null
    );

    expect(executeCommand).toHaveBeenCalledWith(
      "python -m py_compile 'folder with space/ai_module.py'",
      "C:/workspace"
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("SyntaxError");
  });
});
