const path = require("path");

const DEFAULT_OUTPUT_RELATIVE_PATH = "graphify-out/WORKSPACE_MEMORY.md";
const SHARED_WORKSPACE_MEMORY_FILENAME = "workspacememory.md";

function sanitizeOutputRelativePath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw) {
    return DEFAULT_OUTPUT_RELATIVE_PATH;
  }

  const normalized = path.posix.normalize(raw).replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.startsWith("..") ||
    path.posix.isAbsolute(normalized)
  ) {
    return DEFAULT_OUTPUT_RELATIVE_PATH;
  }

  return normalized;
}

function resolveWorkspaceMemoryPaths(workspaceRoot, outputRelativePath) {
  const outputPath = sanitizeOutputRelativePath(outputRelativePath);
  return {
    outputRelativePath: outputPath,
    outputAbsolutePath: workspaceRoot
      ? path.join(workspaceRoot, outputPath)
      : "",
    sharedMirrorRelativePath: SHARED_WORKSPACE_MEMORY_FILENAME,
    sharedMirrorAbsolutePath: workspaceRoot
      ? path.join(workspaceRoot, SHARED_WORKSPACE_MEMORY_FILENAME)
      : ""
  };
}

module.exports = {
  DEFAULT_OUTPUT_RELATIVE_PATH,
  SHARED_WORKSPACE_MEMORY_FILENAME,
  sanitizeOutputRelativePath,
  resolveWorkspaceMemoryPaths
};
