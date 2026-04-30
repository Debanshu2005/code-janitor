const {
  buildGraphLookupContext,
  isValidGraphData,
  matchGraphPathsFromHints
} = require("../graph-context");

describe("graph-context", () => {
  const graphData = {
    nodes: [
      {
        path: "src/ai-agent/agent.js",
        type: "javascript",
        lines: 4200
      },
      {
        path: "src/ai-agent/chat-panel.js",
        type: "javascript",
        lines: 1300
      },
      {
        path: "src/graphify/graph-loader.js",
        type: "javascript",
        lines: 55
      }
    ],
    edges: [
      {
        from: "src/ai-agent/agent.js",
        to: "src/graphify/graph-loader.js"
      },
      {
        from: "src/ai-agent/chat-panel.js",
        to: "src/ai-agent/agent.js"
      }
    ]
  };

  test("validates graph data shape", () => {
    expect(isValidGraphData(graphData)).toBe(true);
    expect(isValidGraphData({ nodes: [] })).toBe(false);
  });

  test("matches graph paths from basename and relative hints", () => {
    expect(matchGraphPathsFromHints(graphData, ["agent.js"])).toEqual([
      "src/ai-agent/agent.js"
    ]);

    expect(
      matchGraphPathsFromHints(graphData, ["src/graphify/graph-loader.js"])
    ).toEqual(["src/graphify/graph-loader.js"]);
  });

  test("builds graph lookup context with dependency neighborhood", () => {
    const context = buildGraphLookupContext(graphData, [
      "src/ai-agent/agent.js"
    ]);

    expect(context).toContain("Graph File Match");
    expect(context).toContain("src/ai-agent/agent.js");
    expect(context).toContain("depends on: src/graphify/graph-loader.js");
    expect(context).toContain("referenced by: src/ai-agent/chat-panel.js");
  });
});
