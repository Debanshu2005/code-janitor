/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock(
  "vscode",
  () => ({
    Uri: {
      file: (fsPath) => ({ fsPath })
    },
    ViewColumn: {
      Beside: 2
    },
    window: {
      activeTextEditor: null,
      createTerminal: jest.fn(),
      createWebviewPanel: jest.fn(),
      showInformationMessage: jest.fn(),
      showWarningMessage: jest.fn()
    },
    workspace: {
      workspaceFolders: [],
      onDidChangeTextDocument: jest.fn(),
      onDidSaveTextDocument: jest.fn()
    },
    commands: {
      executeCommand: jest.fn()
    }
  }),
  { virtual: true }
);

jest.mock("prettier", () => ({
  resolveConfig: jest.fn(async () => ({})),
  format: jest.fn(async (code) => code)
}));

const vscode = require("vscode");
const livePreviewer = require("../live-preview");

describe("live preview multi-file HTML resources", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cj-preview-"));
    vscode.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: tmpDir
        }
      }
    ];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vscode.workspace.workspaceFolders = [];
    vscode.window.activeTextEditor = null;
    livePreviewer._test.resetState();
    jest.clearAllMocks();
  });

  test("rewrites split HTML site CSS, JS, images, and srcset paths", () => {
    const indexPath = path.join(tmpDir, "index.html");
    fs.writeFileSync(indexPath, "<!doctype html>", "utf8");
    fs.writeFileSync(path.join(tmpDir, "styles.css"), "body{}", "utf8");
    fs.writeFileSync(path.join(tmpDir, "app.js"), "console.log('ok');", "utf8");
    fs.mkdirSync(path.join(tmpDir, "assets"));
    fs.writeFileSync(path.join(tmpDir, "assets", "logo.png"), "png", "utf8");
    fs.writeFileSync(path.join(tmpDir, "assets", "large.png"), "png", "utf8");

    const webview = {
      asWebviewUri: (uri) =>
        `vscode-webview://${String(uri.fsPath).replace(/\\/g, "/")}`
    };
    const html = [
      '<link rel="stylesheet" href="styles.css">',
      '<script src="./app.js"></script>',
      '<img src="/assets/logo.png" srcset="assets/logo.png 1x, assets/large.png 2x">',
      '<a href="#section">Jump</a>'
    ].join("\n");

    const converted = livePreviewer._test.convertLocalPathsToWebviewUris(
      html,
      webview,
      indexPath
    );

    expect(converted).toContain("vscode-webview://");
    expect(converted).toContain("/styles.css?v=");
    expect(converted).toContain("/app.js?v=");
    expect(converted).toContain("/assets/logo.png?v=");
    expect(converted).toContain("/assets/large.png?v=");
    expect(converted).toContain('<a href="#section">Jump</a>');
  });

  test("treats saved files in the preview folder as related to the active preview", () => {
    const indexPath = path.join(tmpDir, "index.html");
    const cssPath = path.join(tmpDir, "styles.css");
    const outsidePath = path.join(os.tmpdir(), "outside-preview.css");

    expect(
      livePreviewer._test.isRelatedPreviewDocument(cssPath, indexPath)
    ).toBe(true);
    expect(
      livePreviewer._test.isRelatedPreviewDocument(outsidePath, indexPath)
    ).toBe(false);
  });

  test("detects package apps without an index file as dev-server preview candidates", () => {
    const packageJson = {
      scripts: {
        dev: "vite --host 0.0.0.0 --port 5174"
      },
      dependencies: {
        react: "^18.0.0",
        vite: "^5.0.0"
      }
    };
    const packagePath = path.join(tmpDir, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify(packageJson), "utf8");

    expect(livePreviewer._test.pickPreviewScript(packageJson)).toEqual({
      name: "dev",
      command: "vite --host 0.0.0.0 --port 5174"
    });
    expect(
      livePreviewer._test.isPackagePreviewCandidate(
        { fileName: packagePath },
        packageJson,
        tmpDir
      )
    ).toBe(true);
    expect(
      livePreviewer._test.detectPreviewPort(packageJson.scripts.dev, packageJson)
    ).toBe(5174);
  });

  test("prefers dev-server preview for framework apps but not plain static packages", () => {
    const indexPath = path.join(tmpDir, "index.html");
    fs.writeFileSync(indexPath, "<div id=\"root\"></div>", "utf8");

    expect(
      livePreviewer._test.isPackagePreviewCandidate(
        { fileName: path.join(tmpDir, "src", "App.jsx") },
        {
          scripts: { dev: "vite" },
          dependencies: { react: "^18.0.0", vite: "^5.0.0" }
        },
        tmpDir
      )
    ).toBe(true);

    expect(
      livePreviewer._test.isPackagePreviewCandidate(
        { fileName: path.join(tmpDir, "package.json") },
        {
          scripts: { dev: "http-server ." },
          devDependencies: { "http-server": "^14.0.0" }
        },
        tmpDir
      )
    ).toBe(false);
  });

  test("opens package app dev servers in the editor Simple Browser", async () => {
    const packageJson = {
      scripts: {
        dev: "next dev --webpack"
      },
      dependencies: {
        next: "^16.0.0",
        react: "^19.0.0"
      }
    };
    const packagePath = path.join(tmpDir, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify(packageJson), "utf8");

    const terminal = {
      sendText: jest.fn(),
      show: jest.fn()
    };
    vscode.window.createTerminal.mockReturnValue(terminal);
    vscode.commands.executeCommand.mockResolvedValue(undefined);
    vscode.window.activeTextEditor = {
      document: {
        fileName: packagePath,
        languageId: "json",
        uri: { scheme: "file" },
        getText: () => JSON.stringify(packageJson)
      }
    };

    const result = await livePreviewer({ subscriptions: [] });

    expect(vscode.window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: tmpDir
      })
    );
    expect(terminal.sendText).toHaveBeenCalledWith("npm run dev");
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "simpleBrowser.show",
      "http://localhost:3000"
    );
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      devServer: true,
      inEditor: true,
      url: "http://localhost:3000"
    });
  });
});
