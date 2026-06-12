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
          to: "helpers/util.py"
        }),
        expect.objectContaining({
          from: "src/main/java/com/example/App.java",
          to: "src/main/java/com/example/util/Helper.java",
          type: "java-import"
        })
      ])
    );
  });

  test("analyzer resolves side-effect imports, re-exports, and tsconfig aliases", async () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-janitor-graphify-aliases-")
    );
    workspaces.push(workspace);

    fs.mkdirSync(path.join(workspace, "src", "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["src/*"]
          }
        }
      }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspace, "src", "app.ts"),
      [
        'import "@/lib/util";',
        'import "./setup";',
        'export { default as util } from "@/lib/util";'
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspace, "src", "setup.ts"),
      "export const ready = true;\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspace, "src", "lib", "util.ts"),
      "export default 42;\n",
      "utf8"
    );

    const analyzer = new GraphifyAnalyzer(workspace);
    await analyzer.analyzeCodebase();

    expect(analyzer.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "src/app.ts",
          to: "src/lib/util.ts"
        }),
        expect.objectContaining({
          from: "src/app.ts",
          to: "src/setup.ts"
        })
      ])
    );
    expect(
      analyzer.edges.filter((edge) => edge.from === "src/app.ts")
    ).toHaveLength(2);
  });

  test("panel rebuilds fresh graph data even when graph.json exists", async () => {
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
          { path: "stale.js", name: "stale.js", type: "javascript" },
          { path: "old.js", name: "old.js", type: "javascript" }
        ],
        edges: [
          { from: "stale.js", to: "old.js", type: "imports" }
        ]
      }),
      "utf8"
    );
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
    panel.panel = {
      webview: {
        postMessage: jest.fn()
      }
    };

    await panel.analyzeCodebase();

    expect(panel.panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "renderGraph",
        data: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              type: "file",
              path: "a.js"
            }),
            expect.objectContaining({
              type: "file",
              path: "z.js"
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

  test("agent config generation backfills AGENTS guidance for workspace and graph data", async () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-janitor-graphify-agents-")
    );
    workspaces.push(workspace);
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: workspace } }];

    fs.writeFileSync(
      path.join(workspace, "AGENTS.md"),
      [
        "# AI Agent Instructions",
        "",
        "## Graphify Knowledge Graph",
        "Use Graphify before broad repo scans."
      ].join("\n"),
      "utf8"
    );

    const analyzer = new GraphifyAnalyzer(workspace);
    await analyzer.generateAgentConfigs();

    const agentsMarkdown = fs.readFileSync(
      path.join(workspace, "AGENTS.md"),
      "utf8"
    );

    expect(agentsMarkdown).toContain("## Repository Context Priority");
    expect(agentsMarkdown).toContain("Read `workspace.json` first");
    expect(agentsMarkdown).toContain("Read `graphify-out/WORKSPACE_MEMORY.md`");
    expect(agentsMarkdown.match(/## Graphify Knowledge Graph/g)).toHaveLength(1);
  });
});
