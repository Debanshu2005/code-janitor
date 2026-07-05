/**
 * Shared utility for workspace-bounded path resolution.
 */

const path = require("path");

/**
 * Resolve a file path and validate that it stays within the workspace root.
 *
 * Accepts relative paths resolved against workspaceRoot, and absolute paths
 * only when they resolve inside workspaceRoot.
 *
 * @param {string} filePath The user/agent supplied file path.
 * @param {string} workspaceRoot Absolute path to the workspace root.
 * @returns {{ absolutePath: string, relativePath: string }}
 */
function resolveAndValidatePath(filePath, workspaceRoot) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("workspaceRoot is required for safe path resolution.");
  }

  if (!filePath || typeof filePath !== "string") {
    throw new Error("filePath is required and must be a non-empty string.");
  }

  const normalizedRoot = path.resolve(workspaceRoot);
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(normalizedRoot, filePath);
  const relativePath = path.relative(normalizedRoot, absolutePath);
  const outsideWorkspace =
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath);

  if (outsideWorkspace) {
    throw new Error(
      `Path "${filePath}" resolves to "${absolutePath}" which is outside the workspace root "${normalizedRoot}". ` +
        "File operations are restricted to the workspace directory."
    );
  }

  return {
    absolutePath,
    relativePath: relativePath.split(path.sep).join("/")
  };
}

module.exports = { resolveAndValidatePath };
