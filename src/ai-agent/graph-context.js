const path = require("path");

function isValidGraphData(graphData) {
  return !!(
    graphData &&
    Array.isArray(graphData.nodes) &&
    Array.isArray(graphData.edges)
  );
}

function normalizePathLike(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .toLowerCase();
}

function getGraphNodePath(node) {
  return normalizePathLike(node && node.path);
}

function getBaseStem(value) {
  return path.posix
    .basename(normalizePathLike(value))
    .replace(/\.[a-z0-9]+$/i, "");
}

function matchGraphPathsFromHints(graphData, pathHints = []) {
  if (!isValidGraphData(graphData) || !Array.isArray(pathHints)) {
    return [];
  }

  const scoredMatches = new Map();

  for (const rawHint of pathHints) {
    const normalizedHint = normalizePathLike(rawHint);
    if (!normalizedHint) continue;

    const hintedBaseName = path.posix.basename(normalizedHint);
    const hintedBaseStem = getBaseStem(normalizedHint);

    for (const node of graphData.nodes) {
      const nodePath = getGraphNodePath(node);
      if (!nodePath) continue;

      const nodeBaseName = path.posix.basename(nodePath);
      const nodeBaseStem = getBaseStem(nodePath);
      let score = 0;

      if (nodePath === normalizedHint) {
        score = 140;
      } else if (nodePath.endsWith(`/${normalizedHint}`)) {
        score = 110;
      } else if (nodeBaseName === hintedBaseName) {
        score = 90;
      } else if (hintedBaseStem && nodeBaseStem === hintedBaseStem) {
        score = 80;
      } else if (
        nodePath.includes(normalizedHint) ||
        normalizedHint.includes(nodeBaseName)
      ) {
        score = 35;
      }

      if (score > 0) {
        const previous = scoredMatches.get(node.path) || 0;
        if (score > previous) {
          scoredMatches.set(node.path, score);
        }
      }
    }
  }

  return Array.from(scoredMatches.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([nodePath]) => nodePath.replace(/\\/g, "/"));
}

function buildGraphLookupContext(graphData, matchedPaths = [], options = {}) {
  if (!isValidGraphData(graphData) || !Array.isArray(matchedPaths) || matchedPaths.length === 0) {
    return "";
  }

  const maxMatches =
    Number.isFinite(options.maxMatches) && options.maxMatches > 0
      ? options.maxMatches
      : 2;
  const maxNeighbors =
    Number.isFinite(options.maxNeighbors) && options.maxNeighbors > 0
      ? options.maxNeighbors
      : 4;
  const maxChars =
    Number.isFinite(options.maxChars) && options.maxChars > 0
      ? options.maxChars
      : 900;

  const nodeByPath = new Map(
    graphData.nodes.map((node) => [node.path.replace(/\\/g, "/"), node])
  );
  const inbound = new Map();
  const outbound = new Map();

  for (const edge of graphData.edges) {
    const from = String(edge && edge.from ? edge.from : "").replace(/\\/g, "/");
    const to = String(edge && edge.to ? edge.to : "").replace(/\\/g, "/");
    if (!from || !to) continue;

    if (!outbound.has(from)) outbound.set(from, new Set());
    if (!inbound.has(to)) inbound.set(to, new Set());
    outbound.get(from).add(to);
    inbound.get(to).add(from);
  }

  let context =
    "\n**Graph File Match**\nMatched requested file(s) through `graphify-out/graph.json`:\n";

  for (const matchedPath of matchedPaths.slice(0, maxMatches)) {
    const normalizedPath = matchedPath.replace(/\\/g, "/");
    const node = nodeByPath.get(normalizedPath);
    if (!node) continue;

    const details = [];
    if (node.type) details.push(node.type);
    if (Number.isFinite(node.lines) && node.lines > 0) {
      details.push(`${node.lines} lines`);
    }

    context += `- \`${normalizedPath}\`${details.length ? ` (${details.join(", ")})` : ""}\n`;

    const dependsOn = Array.from(outbound.get(normalizedPath) || []).slice(
      0,
      maxNeighbors
    );
    const referencedBy = Array.from(inbound.get(normalizedPath) || []).slice(
      0,
      maxNeighbors
    );

    if (dependsOn.length > 0) {
      context += `  depends on: ${dependsOn.join(", ")}\n`;
    }
    if (referencedBy.length > 0) {
      context += `  referenced by: ${referencedBy.join(", ")}\n`;
    }
  }

  return context.slice(0, maxChars).trimEnd();
}

module.exports = {
  buildGraphLookupContext,
  isValidGraphData,
  matchGraphPathsFromHints
};
