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
      createWebviewPanel: jest.fn(),
      showInformationMessage: jest.fn(),
      showWarningMessage: jest.fn()
    },
    workspace: {
      workspaceFolders: [],
      onDidChangeTextDocument: jest.fn(),
      onDidSaveTextDocument: jest.fn()
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
});
