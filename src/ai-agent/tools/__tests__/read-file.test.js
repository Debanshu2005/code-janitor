/* eslint-env jest */

const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const { readFiles } = require("../read-file");

describe("read-file", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-file-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("returns AST outlines without full function bodies", async () => {
    await fs.writeFile(
      path.join(tempDir, "sample.js"),
      [
        "function add(a, b) {",
        "  return a + b;",
        "}",
        "",
        "class Calculator {",
        "  multiply(x, y) {",
        "    return x * y;",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const result = await readFiles(
      [{ path: "sample.js", mode: "outline" }],
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.results[0].mode).toBe("outline");
    expect(result.results[0].content).toContain("function: add(a, b)");
    expect(result.results[0].content).toContain("declaration: Calculator");
    expect(result.results[0].content).not.toContain("return a + b");
  });

  test("rejects paths outside the workspace", async () => {
    const result = await readFiles(
      [{ path: "../outside.js", mode: "outline" }],
      tempDir
    );

    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain("outside the workspace");
  });
});
