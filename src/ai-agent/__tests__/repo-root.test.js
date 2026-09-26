const fs = require("fs");
const os = require("os");
const path = require("path");
const AIAgent = require("../agent");
const vscode = require("../../utils/vscode-shim");

describe("AIAgent repository root resolution", () => {
  let agent;
  const workspaces = [];

  beforeEach(() => {
    agent = new AIAgent();
    vscode.workspace.workspaceFolders = [];
    vscode.window.activeTextEditor = null;
  });

  afterEach(() => {
    while (workspaces.length > 0) {
      fs.rmSync(workspaces.pop(), { recursive: true, force: true });
    }
  });

  test("(a) active file in a workspace subfolder while workspace root is the repo root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-janitor-test-"));
    workspaces.push(root);

    // Repo root contains .git
    fs.mkdirSync(path.join(root, ".git"));
    
    // Subfolder and file
    const subfolder = path.join(root, "src", "nested");
    fs.mkdirSync(subfolder, { recursive: true });
    const activeFile = path.join(subfolder, "active.js");
    fs.writeFileSync(activeFile, "console.log('hi');");

    // Workspace folder is the root
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];

    // resolveRepositoryRoot should resolve to root, even if we pass subfolder
    const resolved = agent._resolveRepositoryRoot(subfolder);
    expect(resolved).toBe(root);
  });

  test("(b) multi-root workspace where the active file's root differs from the .git root", async () => {
    const multiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-janitor-test-multi-"));
    workspaces.push(multiRoot);

    const rootA = path.join(multiRoot, "ProjectA");
    const rootB = path.join(multiRoot, "ProjectB");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });

    // ProjectA is the real repo
    fs.mkdirSync(path.join(rootA, ".git"));

    // ProjectB has the active file
    const activeFileB = path.join(rootB, "file.js");
    fs.writeFileSync(activeFileB, "console.log('B');");

    vscode.workspace.workspaceFolders = [
      { uri: { fsPath: rootA } },
      { uri: { fsPath: rootB } }
    ];

    // If we call _resolveRepositoryRoot with ProjectB
    const resolved = agent._resolveRepositoryRoot(rootB);
    // It should fall back to vscode.workspace.workspaceFolders[0] which is rootA?
    // Wait, let's see. If no .git is found upwards from rootB, it falls back to workspaceFolders[0] which is rootA, OR returns rootB?
    // In our implementation, we fallback to workspaceFolders[0] if it exists, or workspaceFolder.
    expect(resolved).toBe(rootA);
  });

  test("(c) missing graphify-out/ entirely", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-janitor-test-"));
    workspaces.push(root);

    fs.mkdirSync(path.join(root, ".git"));
    
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];

    // Since graphify-out is missing, _getKnowledgeGraphAssets should return null
    const assets = await agent._getKnowledgeGraphAssets(root);
    expect(assets).toBeNull();
    
    // And _loadKnowledgeGraph should return the system note when intent is "scan"
    const message = await agent._loadKnowledgeGraph(root, "scan codebase", "scan");
    expect(message).toContain("No graphify-out/GRAPH_REPORT.md was found under");
    expect(message).toContain(root);
  });
});
