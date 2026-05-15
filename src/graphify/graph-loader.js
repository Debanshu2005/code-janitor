const fs = require("fs");
const path = require("path");

function findGraphJsonForPath(inputPath) {
  if (!inputPath) return null;

  let currentPath = path.resolve(inputPath);
  try {
    if (!fs.statSync(currentPath).isDirectory()) {
      currentPath = path.dirname(currentPath);
    }
  } catch {
    currentPath = path.dirname(currentPath);
  }

  for (;;) {
    const candidate = path.join(currentPath, "graphify-out", "graph.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(currentPath);
    if (parent === currentPath) {
      return null;
    }
    currentPath = parent;
  }
}

function loadGraphContextForFile(filePath) {
  const graphPath = findGraphJsonForPath(filePath);
  if (!graphPath) {
    return null;
  }

  try {
    const graphData = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
      return null;
    }

    return {
      graphPath,
      graphRoot: path.dirname(path.dirname(graphPath)),
      data: graphData
    };
  } catch {
    return null;
  }
}

module.exports = {
  findGraphJsonForPath,
  loadGraphContextForFile
};
