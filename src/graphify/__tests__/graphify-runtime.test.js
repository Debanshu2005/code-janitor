/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock(
  "vscode",
  () => ({
    window: {
      showErrorMessage: jest.fn(),
      showInformationMessage: jest.fn()
    },
    workspace: {
      workspaceFolders: []
    }
  }),
  { virtual: true }
);

const vscode = require("vscode");
const GraphifyAnalyzer = require("../graphify-analyzer");
const GraphifyPanel = require("../graphify-panel");

describe("Graphify runtime wiring", () => {
  const workspaces = [];

  afterEach(() => {
    vscode.workspace.workspaceFolders = [];
    while (workspaces.length > 0) {
      fs.rmSync(workspaces.pop(), { recursive: true, force: true });
    }
  });

  test("analyzer creates local Python and Java dependency edges", async () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-janitor-graphify-runtime-")
    );
    workspaces.push(workspace);

    fs.mkdirSync(path.join(workspace, "helpers"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "helpers", "util.py"),
      "VALUE = 42\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspace, "app.py"),
      "import helpers.util\nfrom helpers import util\n",
      "utf8"
    );

    fs.mkdirSync(
      path.join(workspace, "src", "main", "java", "com", "example", "util"),
      { recursive: true }
    );
    fs.writeFileSync(
      path.join(workspace, "src", "main", "java", "com", "example", "App.java"),
      "package com.example;\nimport com.example.util.Helper;\nclass App {}\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(
        workspace,
        "src",
        "main",
        "java",
        "com",
        "example",
        "util",
        "Helper.java"
      ),
      "package com.example.util;\nclass Helper {}\n",
      "utf8"
    );

    const analyzer = new GraphifyAnalyzer(workspace);
    await analyzer.analyzeCodebase();

    expect(analyzer.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "app.py",
          to: "helpers/util.py",
          type: "python-import"
        }),
        expect.objectContaining({
          from: "src/main/java/com/example/App.java",
          to: "src/main/java/com/example/util/Helper.java",
          type: "java-import"
        })
      ])
    );
  });

  test("panel prefers generated graph data when graph.json exists", async () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-janitor-graphify-panel-")
    );
    workspaces.push(workspace);
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: workspace } }];

    fs.mkdirSync(path.join(workspace, "graphify-out"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "graphify-out", "graph.json"),
      JSON.stringify({
        nodes: [
          { path: "src/app.js", name: "app.js", type: "javascript" },
          { path: "src/lib.js", name: "lib.js", type: "javascript" }
        ],
        edges: [
          { from: "src/app.js", to: "src/lib.js", type: "imports" }
        ]
      }),
      "utf8"
    );

    const panel = new GraphifyPanel({ subscriptions: [] });
    panel.panel = {
      webview: {
        postMessage: jest.fn()
      }
    };
    panel.buildGraphData = jest.fn(async () => ({ nodes: [], edges: [] }));

    await panel.analyzeCodebase();

    expect(panel.buildGraphData).not.toHaveBeenCalled();
    expect(panel.panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "renderGraph",
        data: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              type: "directory",
              path: "src"
            }),
            expect.objectContaining({
              type: "file",
              path: "src/app.js"
            })
          ]),
          edges: [
            expect.objectContaining({
              label: "imports"
            })
          ]
        })
      })
    );
  });

  test("fallback graph builder keeps forward dependency edges", async () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-janitor-graphify-fallback-")
    );
    workspaces.push(workspace);

    fs.writeFileSync(
      path.join(workspace, "a.js"),
      "import helper from './z.js';\nconsole.log(helper);\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspace, "z.js"),
      "export default 1;\n",
      "utf8"
    );

    const panel = new GraphifyPanel({ subscriptions: [] });
    const graphData = await panel.buildGraphData(workspace);

    expect(graphData.edges).toHaveLength(1);
  });
});
