/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock(
  "vscode",
  () => ({
    window: {
      activeTextEditor: null,
      showTextDocument: jest.fn()
    },
    workspace: {
      workspaceFolders: [],
      getWorkspaceFolder: jest.fn(),
      getConfiguration: jest.fn(),
      openTextDocument: jest.fn(),
      onDidSaveTextDocument: jest.fn(() => ({ dispose() {} })),
      onDidCreateFiles: jest.fn(() => ({ dispose() {} })),
      onDidDeleteFiles: jest.fn(() => ({ dispose() {} })),
      onDidRenameFiles: jest.fn(() => ({ dispose() {} }))
    }
  }),
  { virtual: true }
);

jest.mock("../tools/fetch-github-context", () => ({
  fetchGitHubContext: jest.fn()
}));

const vscode = require("vscode");
const {
  WorkspaceMemoryService,
  extractGraphReportHighlights,
  isIgnoredWorkspacePath,
  sanitizeOutputRelativePath
} = require("../workspace-memory");
const { fetchGitHubContext } = require("../tools/fetch-github-context");

describe("WorkspaceMemoryService", () => {
  beforeEach(() => {
    vscode.workspace.workspaceFolders = [];
    vscode.window.activeTextEditor = null;
    vscode.workspace.getWorkspaceFolder.mockReset();
    vscode.workspace.openTextDocument.mockReset();
    vscode.window.showTextDocument.mockReset();
    vscode.workspace.getConfiguration.mockImplementation(() => ({
      get(_key, defaultValue) {
        return defaultValue;
      }
    }));
    fetchGitHubContext.mockReset();
  });

  test("writes workspace memory markdown with tracked changes and GitHub context", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cj-workspace-memory-")
    );
    fs.mkdirSync(path.join(workspaceRoot, "src", "ai-agent"), {
      recursive: true
    });
    fs.mkdirSync(path.join(workspaceRoot, "graphify-out"), {
      recursive: true
    });
    fs.writeFileSync(
      path.join(workspaceRoot, "package.json"),
      '{\n  "name": "code-janitor"\n}\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "extension.js"),
      "module.exports = {};\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "ai-agent", "agent.js"),
      "class Agent {}\nmodule.exports = Agent;\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "graphify-out", "GRAPH_REPORT.md"),
      [
        "# Codebase Knowledge Graph Report",
        "",
        "## Overview",
        "- Total Files: 3",
        "",
        "## God Nodes (High Connectivity)",
        "### src/extension.js",
        "- Total Connections: 16",
        "",
        "## Architecture Insights",
        "1. Start with god nodes."
      ].join("\n"),
      "utf8"
    );

    vscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
    vscode.window.activeTextEditor = {
      document: {
        fileName: path.join(workspaceRoot, "src", "ai-agent", "agent.js")
      }
    };

    fetchGitHubContext.mockResolvedValue({
      summary: "GitHub Repository: demo/code-janitor\nOpen pull requests:\n- #7 Workspace memory"
    });

    const context = {
      subscriptions: [],
      globalState: {
        get: jest.fn(() => null),
        update: jest.fn()
      }
    };
    const service = new WorkspaceMemoryService(context);
    jest.spyOn(service, "_getGitStatusSnapshot").mockResolvedValue({
      available: true,
      branch: "main",
      statusLines: ["M src/ai-agent/agent.js", "?? graphify-out/WORKSPACE_MEMORY.md"],
      statusTruncated: false,
      error: null
    });

    service._recordWorkspaceChange(workspaceRoot, {
      type: "save",
      path: "src/ai-agent/agent.js",
      lineCount: 2,
      recordedAt: Date.parse("2026-05-16T10:00:00Z")
    });

    const result = await service.refreshWorkspaceMemory(workspaceRoot, "manual");
    const markdown = fs.readFileSync(result.outputPath, "utf8");

    expect(markdown).toContain("# Workspace Memory");
    expect(markdown).toContain("src/ai-agent/agent.js");
    expect(markdown).toContain("GitHub Repository: demo/code-janitor");
    expect(markdown).toContain("Branch: main");
    expect(markdown).toContain("src/extension.js");
    expect(markdown).toContain("Tracked files in snapshot");
  });

  test("exports stable helpers for graph and path hygiene", () => {
    expect(
      extractGraphReportHighlights(
        "## Overview\n- Files: 2\n\n## God Nodes (High Connectivity)\n### src/extension.js\n- Total Connections: 16\n"
      )
    ).toContain("src/extension.js");
    expect(isIgnoredWorkspacePath("node_modules/react/index.js")).toBe(true);
    expect(isIgnoredWorkspacePath("src/extension.js")).toBe(false);
    expect(sanitizeOutputRelativePath("../outside.md")).toBe(
      "graphify-out/WORKSPACE_MEMORY.md"
    );
  });
});
