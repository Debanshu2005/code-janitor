/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  findGraphJsonForPath,
  loadGraphContextForFile
} = require("../graph-loader");

describe("graph-loader", () => {
  const workspaces = [];

  afterEach(() => {
    while (workspaces.length > 0) {
      fs.rmSync(workspaces.pop(), { recursive: true, force: true });
    }
  });

  test("loads graph context for a nested file by walking up to graphify-out", () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-janitor-graph-loader-")
    );
    workspaces.push(workspace);

    const nestedFile = path.join(workspace, "packages", "app", "src", "index.html");
    fs.mkdirSync(path.dirname(nestedFile), { recursive: true });
    fs.writeFileSync(nestedFile, "<img src=\"shared/logo.png\">", "utf8");

    const graphDir = path.join(workspace, "graphify-out");
    fs.mkdirSync(graphDir, { recursive: true });
    fs.writeFileSync(
      path.join(graphDir, "graph.json"),
      JSON.stringify({
        version: 1,
        nodes: [{ path: "shared/logo.png", type: "asset" }],
        edges: []
      }),
      "utf8"
    );

    const graphPath = findGraphJsonForPath(nestedFile);
    const context = loadGraphContextForFile(nestedFile);

    expect(graphPath).toBe(path.join(graphDir, "graph.json"));
    expect(context).toEqual({
      graphPath: path.join(graphDir, "graph.json"),
      graphRoot: workspace,
      data: {
        version: 1,
        nodes: [{ path: "shared/logo.png", type: "asset" }],
        edges: []
      }
    });
  });
});
