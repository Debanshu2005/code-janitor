/* eslint-env jest */

const path = require("path");
const { resolveAndValidatePath } = require("../safe-path");

describe("safe-path", () => {
  const workspaceRoot = path.resolve("workspace");

  test("resolves relative paths inside the workspace", () => {
    const result = resolveAndValidatePath("src/app.js", workspaceRoot);

    expect(result.absolutePath).toBe(path.join(workspaceRoot, "src", "app.js"));
    expect(result.relativePath).toBe("src/app.js");
  });

  test("allows absolute paths inside the workspace", () => {
    const insidePath = path.join(workspaceRoot, "src", "app.js");

    expect(resolveAndValidatePath(insidePath, workspaceRoot)).toEqual({
      absolutePath: insidePath,
      relativePath: "src/app.js"
    });
  });

  test("rejects traversal outside the workspace", () => {
    expect(() => resolveAndValidatePath("../secret.txt", workspaceRoot)).toThrow(
      "outside the workspace"
    );
  });

  test("rejects sibling directory prefix confusion", () => {
    const sibling = path.resolve(`${workspaceRoot}-secrets`, "file.txt");

    expect(() => resolveAndValidatePath(sibling, workspaceRoot)).toThrow(
      "outside the workspace"
    );
  });
});
