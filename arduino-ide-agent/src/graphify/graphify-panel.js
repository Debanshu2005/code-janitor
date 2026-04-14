const vscode = require("vscode")
const path = require("path")
const fs = require("fs").promises

class GraphifyPanel {
  constructor(context) {
    this.context = context
    this.panel = null
  }

  async show() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }

    this.panel = vscode.window.createWebviewPanel(
      "codeJanitorGraphify",
      "Arduino Project Graph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    )

    this.panel.onDidDispose(() => {
      this.panel = null
    })

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "analyze":
            await this.analyzeCodebase()
            break
          case "openFile":
            await this.openFile(message.path)
            break
        }
      },
      null,
      this.context.subscriptions
    )

    this.panel.webview.html = this.getHtmlContent()
  }

  async analyzeCodebase() {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) {
      vscode.window.showErrorMessage("No workspace folder open")
      return
    }

    const rootPath = workspaceFolders[0].uri.fsPath
    const graphData = await this.buildGraphData(rootPath)

    this.panel.webview.postMessage({
      command: "renderGraph",
      data: graphData
    })
  }

  async buildGraphData(rootPath) {
    const nodes = []
    const edges = []
    const fileMap = new Map()
    let nodeId = 0

    const codeExtensions = /\.(ino|c|cpp|h|hpp|py|js|jsx|ts|tsx|java)$/i
    const ignoreDirs = new Set([".git", "node_modules", "dist", "build", "out", "venv", "__pycache__"])

    const scanDirectory = async (dirPath, depth = 0) => {
      if (depth > 5) return

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name)
          const relativePath = path.relative(rootPath, fullPath)

          if (entry.isDirectory()) {
            if (ignoreDirs.has(entry.name)) continue

            const dirNodeId = nodeId++
            nodes.push({
              id: dirNodeId,
              label: entry.name,
              type: "directory",
              path: relativePath,
              group: depth
            })

            fileMap.set(relativePath, dirNodeId)
            await scanDirectory(fullPath, depth + 1)
          } else if (codeExtensions.test(entry.name)) {
            const fileNodeId = nodeId++
            const ext = path.extname(entry.name).slice(1)

            nodes.push({
              id: fileNodeId,
              label: entry.name,
              type: "file",
              extension: ext,
              path: relativePath,
              group: depth
            })

            fileMap.set(relativePath, fileNodeId)

            try {
              const content = await fs.readFile(fullPath, "utf8")
              const dependencies = this.extractDependencies(content, ext)

              for (const dep of dependencies) {
                const depPath = this.resolveDependencyPath(dep, dirPath, rootPath)
                if (depPath && fileMap.has(depPath)) {
                  edges.push({
                    from: fileNodeId,
                    to: fileMap.get(depPath),
                    label: "includes"
                  })
                }
              }
            } catch (err) {
              // Skip files that can't be read
            }
          }
        }
      } catch (err) {
        console.error(`Error scanning ${dirPath}:`, err)
      }
    }

    await scanDirectory(rootPath)

    return { nodes, edges }
  }

  extractDependencies(content, extension) {
    const dependencies = []

    if (["ino", "c", "cpp", "h", "hpp"].includes(extension)) {
      const includeRegex = /#include\s+["<](.+?)[">]/g
      let match
      while ((match = includeRegex.exec(content)) !== null) {
        dependencies.push(match[1])
      }
    } else if (["js", "jsx", "ts", "tsx"].includes(extension)) {
      const importRegex = /import\s+.*?\s+from\s+['"](.+?)['"]/g
      const requireRegex = /require\s*\(['"](.+?)['"]\)/g

      let match
      while ((match = importRegex.exec(content)) !== null) {
        if (!match[1].startsWith(".")) continue
        dependencies.push(match[1])
      }
      while ((match = requireRegex.exec(content)) !== null) {
        if (!match[1].startsWith(".")) continue
        dependencies.push(match[1])
      }
    } else if (extension === "py") {
      const importRegex = /^(?:from|import)\s+([\w.]+)/gm
      let match
      while ((match = importRegex.exec(content)) !== null) {
        dependencies.push(match[1])
      }
    } else if (extension === "java") {
      const importRegex = /import\s+([\w.]+);/g
      let match
      while ((match = importRegex.exec(content)) !== null) {
        dependencies.push(match[1])
      }
    }

    return dependencies
  }

  resolveDependencyPath(dep, currentDir, rootPath) {
    if (dep.startsWith(".")) {
      const resolved = path.resolve(currentDir, dep)
      const extensions = ["", ".ino", ".c", ".cpp", ".h", ".hpp", ".js", ".jsx", ".ts", ".tsx", ".py", ".java"]

      for (const ext of extensions) {
        const testPath = resolved + ext
        const relativePath = path.relative(rootPath, testPath)
        try {
          require("fs").accessSync(testPath)
          return relativePath
        } catch {
          continue
        }
      }
    }
    return null
  }

  async openFile(filePath) {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return

    const fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath)
    const uri = vscode.Uri.file(fullPath)

    try {
      const document = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(document)
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to open file: ${err.message}`)
    }
  }

  getHtmlContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arduino Project Graph</title>
  <script src="https://unpkg.com/vis-network@9.1.2/dist/vis-network.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1e1e1e;
      color: #cccccc;
      overflow: hidden;
    }
    #header {
      background: #252526;
      border-bottom: 1px solid #00979d;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #header h1 {
      font-size: 14px;
      font-weight: 600;
      color: #00979d;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #controls {
      display: flex;
      gap: 8px;
    }
    button {
      background: #00979d;
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
      background: #00b8c0;
    }
    button:active {
      background: #007a80;
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
      border-top: 3px solid #00979d;
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
      border: 1px solid #00979d;
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
      color: #00979d;
    }
    .legend {
      position: absolute;
      top: 60px;
      right: 16px;
      background: rgba(37, 37, 38, 0.95);
      border: 1px solid #00979d;
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
      Arduino Project Graph
    </h1>
    <div id="controls">
      <button id="analyzeBtn">🔍 Analyze Project</button>
      <button id="resetBtn">🔄 Reset View</button>
    </div>
  </div>
  <div id="graph-container"></div>
  <div id="loading" style="display: none;">
    <div class="spinner"></div>
    <div>Analyzing project...</div>
  </div>
  <div id="stats" style="display: none;">
    <div><strong>Files:</strong> <span id="fileCount">0</span></div>
    <div><strong>Directories:</strong> <span id="dirCount">0</span></div>
    <div><strong>Dependencies:</strong> <span id="edgeCount">0</span></div>
  </div>
  <div class="legend">
    <div class="legend-item">
      <div class="legend-color" style="background: #00979d;"></div>
      <span>Arduino (.ino)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #f34b7d;"></div>
      <span>C/C++ (.c, .cpp, .h)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #4a9eff;"></div>
      <span>JavaScript/TypeScript</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #3572a5;"></div>
      <span>Python</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #cccccc;"></div>
      <span>Directory</span>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let network = null;

    const extensionColors = {
      ino: '#00979d',
      c: '#f34b7d',
      cpp: '#f34b7d',
      h: '#f34b7d',
      hpp: '#f34b7d',
      js: '#4a9eff',
      jsx: '#4a9eff',
      ts: '#4a9eff',
      tsx: '#4a9eff',
      py: '#3572a5',
      java: '#b07219'
    };

    document.getElementById('analyzeBtn').addEventListener('click', () => {
      document.getElementById('loading').style.display = 'block';
      document.getElementById('stats').style.display = 'none';
      vscode.postMessage({ command: 'analyze' });
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
        color: { color: '#00979d', opacity: 0.6 },
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

    setTimeout(() => {
      document.getElementById('analyzeBtn').click();
    }, 500);
  </script>
</body>
</html>`
  }
}

module.exports = GraphifyPanel
