const vscode = require("vscode");
const path = require("path");
const fs = require("fs").promises;
const GraphifyAnalyzer = require("./graphify-analyzer");

class GraphifyPanel {
  constructor(context) {
    this.context = context;
    this.panel = null;
  }

  async show() {
    console.log("[GraphifyPanel] show() called");
    if (this.panel) {
      console.log("[GraphifyPanel] Panel already exists, revealing it");
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    console.log("[GraphifyPanel] Creating new webview panel");
    this.panel = vscode.window.createWebviewPanel(
      "codeJanitorGraphify",
      "Code Janitor - Codebase Graph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    console.log("[GraphifyPanel] Webview panel created successfully");

    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "analyze":
            await this.analyzeCodebase();
            break;
          case "openFile":
            await this.openFile(message.path);
            break;
          case "generateKnowledgeGraph":
            await this.generateKnowledgeGraph();
            break;
        }
      },
      null,
      this.context.subscriptions
    );

    this.panel.webview.html = this.getHtmlContent();
  }

  async generateKnowledgeGraph() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    
    this.panel.webview.postMessage({
      command: "showStatus",
      message: "Generating knowledge graph..."
    });

    try {
      const analyzer = new GraphifyAnalyzer(rootPath);
      const result = await analyzer.generateKnowledgeGraph();
      const graphData = await this._loadGeneratedGraphData(rootPath);

      this.panel.webview.postMessage({
        command: "showStatus",
        message: `Knowledge graph generated! ${result.nodeCount} files, ${result.edgeCount} dependencies. Check graphify-out/GRAPH_REPORT.md and graphify-out/graph.json`
      });

      if (graphData) {
        this.panel.webview.postMessage({
          command: "renderGraph",
          data: graphData
        });
      }

      vscode.window.showInformationMessage(
        `✅ Knowledge graph generated! ${result.nodeCount} files analyzed. Check graphify-out/GRAPH_REPORT.md and graphify-out/graph.json`,
        "Open Report"
      ).then(async (selection) => {
        if (selection === "Open Report") {
          const reportPath = path.join(rootPath, "graphify-out", "GRAPH_REPORT.md");
          const uri = vscode.Uri.file(reportPath);
          const document = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(document);
        }
      });
    } catch (err) {
      this.panel.webview.postMessage({
        command: "showStatus",
        message: `Error: ${err.message}`
      });
      vscode.window.showErrorMessage(`Failed to generate knowledge graph: ${err.message}`);
    }
  }

  async analyzeCodebase() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const graphData =
      (await this.buildGraphData(rootPath)) ||
      (await this._loadGeneratedGraphData(rootPath));

    this.panel.webview.postMessage({
      command: "renderGraph",
      data: graphData
    });
  }

  async _loadGeneratedGraphData(rootPath) {
    const graphPath = path.join(rootPath, "graphify-out", "graph.json");

    try {
      const raw = await fs.readFile(graphPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        return null;
      }
      return this._convertKnowledgeGraphToViewData(parsed);
    } catch {
      return null;
    }
  }

  _convertKnowledgeGraphToViewData(graphData) {
    const nodes = [];
    const edges = [];
    const nodeIdByPath = new Map();
    const fileNodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
    let nextId = 0;

    const registerDirectory = (dirPath) => {
      const normalizedPath = String(dirPath || "").replace(/\\/g, "/");
      if (!normalizedPath || normalizedPath === ".") {
        return null;
      }
      if (nodeIdByPath.has(normalizedPath)) {
        return nodeIdByPath.get(normalizedPath);
      }

      const dirId = nextId++;
      nodeIdByPath.set(normalizedPath, dirId);
      nodes.push({
        id: dirId,
        label: path.posix.basename(normalizedPath) || normalizedPath,
        type: "directory",
        path: normalizedPath,
        group: normalizedPath.split("/").length - 1
      });
      return dirId;
    };

    for (const fileNode of fileNodes) {
      const normalizedPath = String(fileNode?.path || "").replace(/\\/g, "/");
      if (!normalizedPath) continue;

      const parentDir = path.posix.dirname(normalizedPath);
      if (parentDir && parentDir !== ".") {
        const segments = parentDir.split("/");
        let currentDir = "";
        for (const segment of segments) {
          currentDir = currentDir ? `${currentDir}/${segment}` : segment;
          registerDirectory(currentDir);
        }
      }

      const fileId = nextId++;
      nodeIdByPath.set(normalizedPath, fileId);
      nodes.push({
        id: fileId,
        label: fileNode.name || path.posix.basename(normalizedPath),
        type: "file",
        extension: path.extname(normalizedPath).slice(1),
        path: normalizedPath,
        group: normalizedPath.split("/").length - 1
      });
    }

    for (const edge of graphData.edges || []) {
      const fromPath = String(edge?.from || "").replace(/\\/g, "/");
      const toPath = String(edge?.to || "").replace(/\\/g, "/");
      const fromId = nodeIdByPath.get(fromPath);
      const toId = nodeIdByPath.get(toPath);

      if (fromId === undefined || toId === undefined) {
        continue;
      }

      edges.push({
        from: fromId,
        to: toId,
        label: edge.type || "imports"
      });
    }

    return { nodes, edges };
  }

  async buildGraphData(rootPath) {
    const analyzer = new GraphifyAnalyzer(rootPath);
    await analyzer.analyzeCodebase();
    analyzer.detectCommunities();
    return this._convertKnowledgeGraphToViewData(
      analyzer.getSerializableGraph()
    );
  }

  extractDependencies(content, extension) {
    const dependencies = [];

    if (["js", "jsx", "ts", "tsx"].includes(extension)) {
      const importRegex = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
      const requireRegex = /require\s*\(['"](.+?)['"]\)/g;

      let match;
      while ((match = importRegex.exec(content)) !== null) {
        if (!match[1].startsWith(".")) continue;
        dependencies.push(match[1]);
      }
      while ((match = requireRegex.exec(content)) !== null) {
        if (!match[1].startsWith(".")) continue;
        dependencies.push(match[1]);
      }
    } else if (extension === "py") {
      const importRegex = /^(?:from|import)\s+([\w.]+)/gm;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        dependencies.push(match[1]);
      }
    } else if (["c", "cpp", "h", "hpp", "ino"].includes(extension)) {
      const includeRegex = /#include\s+["<](.+?)[">]/g;
      let match;
      while ((match = includeRegex.exec(content)) !== null) {
        dependencies.push(match[1]);
      }
    } else if (extension === "java") {
      const importRegex = /import\s+([\w.]+);/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        dependencies.push(match[1]);
      }
    }

    return dependencies;
  }

  resolveDependencyPath(dep, currentDir, rootPath) {
    if (dep.startsWith(".")) {
      const resolved = path.resolve(currentDir, dep);
      const extensions = ["", ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".h", ".hpp"];

      for (const ext of extensions) {
        const testPath = resolved + ext;
        const relativePath = path.relative(rootPath, testPath);
        try {
          require("fs").accessSync(testPath);
          return relativePath;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  async openFile(filePath) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
    const uri = vscode.Uri.file(fullPath);

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
    }
  }

  getHtmlContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Codebase Graph</title>
  <script src="https://unpkg.com/vis-network@9.1.2/dist/vis-network.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1e1e1e;
      color: #cccccc;
      overflow: hidden;
    }
    #header {
      background: #252526;
      border-bottom: 1px solid #3c3c3c;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #header h1 {
      font-size: 14px;
      font-weight: 600;
      color: #cccccc;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #controls {
      display: flex;
      gap: 8px;
    }
    button {
      background: #0e639c;
      color: #ffffff;
      border: none;
      padding: 6px 12px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }
    button:hover {
      background: #1177bb;
    }
    button:active {
      background: #0d5a8f;
    }
    #graph-container {
      width: 100%;
      height: calc(100vh - 49px);
      background: #1e1e1e;
    }
    #loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: #cccccc;
    }
    #loading .spinner {
      border: 3px solid #3c3c3c;
      border-top: 3px solid #0e639c;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    #stats {
      position: absolute;
      bottom: 16px;
      left: 16px;
      background: rgba(37, 37, 38, 0.95);
      border: 1px solid #3c3c3c;
      border-radius: 4px;
      padding: 12px;
      font-size: 12px;
      color: #cccccc;
      min-width: 200px;
    }
    #stats div {
      margin: 4px 0;
    }
    #stats strong {
      color: #0e639c;
    }
    .legend {
      position: absolute;
      top: 60px;
      right: 16px;
      background: rgba(37, 37, 38, 0.95);
      border: 1px solid #3c3c3c;
      border-radius: 4px;
      padding: 12px;
      font-size: 12px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 6px 0;
    }
    .legend-color {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid #3c3c3c;
    }
  </style>
</head>
<body>
  <div id="header">
    <h1>
      <span>📊</span>
      Codebase Graph Visualization
    </h1>
    <div id="controls">
      <button id="analyzeBtn">🔍 Analyze Codebase</button>
      <button id="generateBtn">📝 Generate Knowledge Graph</button>
      <button id="clusterBtn">📁 Toggle Clusters</button>
      <button id="resetBtn">🔄 Reset View</button>
    </div>
  </div>
  <div id="graph-container"></div>
  <div id="loading" style="display: none;">
    <div class="spinner"></div>
    <div>Analyzing codebase...</div>
  </div>
  <div id="stats" style="display: none;">
    <div><strong>Files:</strong> <span id="fileCount">0</span></div>
    <div><strong>Directories:</strong> <span id="dirCount">0</span></div>
    <div><strong>Dependencies:</strong> <span id="edgeCount">0</span></div>
  </div>
  <div class="legend">
    <div class="legend-item">
      <div class="legend-color" style="background: #4a9eff;"></div>
      <span>JavaScript/TypeScript</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #3572a5;"></div>
      <span>Python</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #f34b7d;"></div>
      <span>C/C++</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #b07219;"></div>
      <span>Java</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #00979d;"></div>
      <span>Arduino</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #cccccc;"></div>
      <span>Directory</span>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let network = null;
    let clustersEnabled = false;
    let clustersByDirectory = new Map();

    const extensionColors = {
      js: '#4a9eff',
      jsx: '#4a9eff',
      ts: '#4a9eff',
      tsx: '#4a9eff',
      py: '#3572a5',
      c: '#f34b7d',
      cpp: '#f34b7d',
      h: '#f34b7d',
      hpp: '#f34b7d',
      ino: '#00979d',
      java: '#b07219',
      cs: '#178600',
      go: '#00add8',
      rb: '#701516',
      php: '#4f5d95',
      rs: '#dea584'
    };

    document.getElementById('analyzeBtn').addEventListener('click', () => {
      document.getElementById('loading').style.display = 'block';
      document.getElementById('stats').style.display = 'none';
      vscode.postMessage({ command: 'analyze' });
    });

    document.getElementById('generateBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'generateKnowledgeGraph' });
    });

    document.getElementById('clusterBtn').addEventListener('click', () => {
      if (network) {
        toggleClusters();
      }
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
      if (network) {
        network.fit();
      }
    });

    window.addEventListener('message', event => {
      const message = event.data;
      
      if (message.command === 'renderGraph') {
        renderGraph(message.data);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('stats').style.display = 'block';
      }
    });

    function renderGraph(data) {
      const container = document.getElementById('graph-container');
      
      const nodes = data.nodes.map(node => ({
        id: node.id,
        label: node.label,
        title: node.path,
        color: node.type === 'directory' 
          ? '#cccccc' 
          : extensionColors[node.extension] || '#888888',
        shape: node.type === 'directory' ? 'box' : 'dot',
        size: node.type === 'directory' ? 20 : 15,
        font: {
          color: '#cccccc',
          size: 12
        }
      }));

      const edges = data.edges.map(edge => ({
        from: edge.from,
        to: edge.to,
        arrows: 'to',
        color: { color: '#666666', opacity: 0.6 },
        smooth: { type: 'continuous' }
      }));

      const graphData = { nodes, edges };

      const options = {
        nodes: {
          borderWidth: 2,
          borderWidthSelected: 3,
          font: {
            color: '#cccccc'
          }
        },
        edges: {
          width: 1,
          selectionWidth: 2
        },
        physics: {
          enabled: true,
          barnesHut: {
            gravitationalConstant: -8000,
            centralGravity: 0.3,
            springLength: 150,
            springConstant: 0.04,
            damping: 0.09
          },
          stabilization: {
            iterations: 200
          }
        },
        interaction: {
          hover: true,
          tooltipDelay: 100,
          zoomView: true,
          dragView: true
        }
      };

      buildClusterMap(data);

      if (network) {
        network.destroy();
      }

      network = new vis.Network(container, graphData, options);

      network.on('doubleClick', (params) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0];
          const node = data.nodes.find(n => n.id === nodeId);
          if (node && node.type === 'file') {
            vscode.postMessage({ 
              command: 'openFile', 
              path: node.path 
            });
          }
        }
      });

      const fileCount = data.nodes.filter(n => n.type === 'file').length;
      const dirCount = data.nodes.filter(n => n.type === 'directory').length;
      document.getElementById('fileCount').textContent = fileCount;
      document.getElementById('dirCount').textContent = dirCount;
      document.getElementById('edgeCount').textContent = data.edges.length;
    }

    function buildClusterMap(data) {
      clustersByDirectory.clear();
      const dirNodes = data.nodes.filter(n => n.type === 'directory');
      
      dirNodes.forEach(dir => {
        const childNodes = data.nodes.filter(n => 
          n.type === 'file' && n.path.startsWith(dir.path + '/')
        );
        if (childNodes.length > 0) {
          clustersByDirectory.set(dir.id, childNodes.map(n => n.id));
        }
      });
    }

    function toggleClusters() {
      if (!network) return;

      if (clustersEnabled) {
        network.setData(network.body.data);
        clustersEnabled = false;
      } else {
        clustersByDirectory.forEach((nodeIds, dirId) => {
          if (nodeIds.length > 2) {
            network.cluster({
              joinCondition: (node) => nodeIds.includes(node.id),
              clusterNodeProperties: {
                id: 'cluster_' + dirId,
                label: '📁 ' + nodeIds.length + ' files',
                shape: 'box',
                color: '#0e639c',
                font: { color: '#ffffff', size: 14 }
              }
            });
          }
        });
        clustersEnabled = true;
      }

      network.on('doubleClick', (params) => {
        if (params.nodes.length === 1) {
          const nodeId = params.nodes[0];
          if (network.isCluster(nodeId)) {
            network.openCluster(nodeId);
          }
        }
      });
    }

    setTimeout(() => {
      document.getElementById('analyzeBtn').click();
    }, 500);
  </script>
</body>
</html>`;
  }
}

module.exports = GraphifyPanel;
