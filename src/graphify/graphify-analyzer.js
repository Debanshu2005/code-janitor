const vscode = require("vscode")
const path = require("path")
const fs = require("fs").promises

class GraphifyAnalyzer {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot
    this.nodes = []
    this.edges = []
    this.communities = new Map()
  }

  async generateKnowledgeGraph() {
    const outputDir = path.join(this.workspaceRoot, "graphify-out")
    
    // Check if we're writing outside workspace
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || !outputDir.startsWith(workspaceFolders[0].uri.fsPath)) {
      // Ask for permission to write outside workspace
      const answer = await vscode.window.showWarningMessage(
        `Graphify wants to create files outside the workspace at:\n${outputDir}\n\nAllow this operation?`,
        { modal: true },
        "Allow",
        "Deny"
      )
      
      if (answer !== "Allow") {
        throw new Error("User denied permission to write outside workspace")
      }
    }
    
    await fs.mkdir(outputDir, { recursive: true })

    // Analyze codebase
    await this.analyzeCodebase()
    
    // Detect communities (god nodes, clusters)
    this.detectCommunities()

    // Generate GRAPH_REPORT.md
    const report = this.generateReport()
    await fs.writeFile(
      path.join(outputDir, "GRAPH_REPORT.md"),
      report,
      "utf8"
    )

    // Generate agent configurations
    await this.generateAgentConfigs()

    return {
      success: true,
      outputDir,
      nodeCount: this.nodes.length,
      edgeCount: this.edges.length,
      communityCount: this.communities.size
    }
  }

  async analyzeCodebase() {
    const codeExtensions = /\.(js|jsx|ts|tsx|py|java|c|cpp|h|hpp|ino|cs|go|rb|php|rs)$/i
    const ignoreDirs = new Set([".git", "node_modules", "dist", "build", "out", "venv", "__pycache__", "graphify-out"])

    const scanDirectory = async (dirPath) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name)
          const relativePath = path.relative(this.workspaceRoot, fullPath)

          if (entry.isDirectory()) {
            if (ignoreDirs.has(entry.name)) continue
            await scanDirectory(fullPath)
          } else if (codeExtensions.test(entry.name)) {
            try {
              const content = await fs.readFile(fullPath, "utf8")
              const node = {
                path: relativePath.replace(/\\/g, "/"),
                name: entry.name,
                type: this.getFileType(entry.name),
                lines: content.split("\n").length,
                imports: [],
                exports: [],
                dependencies: []
              }

              // Extract imports/exports
              this.extractDependencies(content, node)
              this.nodes.push(node)

              // Create edges
              for (const dep of node.dependencies) {
                this.edges.push({
                  from: relativePath.replace(/\\/g, "/"),
                  to: dep,
                  type: "imports"
                })
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

    await scanDirectory(this.workspaceRoot)
  }

  getFileType(fileName) {
    const ext = path.extname(fileName).toLowerCase()
    const typeMap = {
      ".js": "javascript",
      ".jsx": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".py": "python",
      ".java": "java",
      ".c": "c",
      ".cpp": "cpp",
      ".h": "c_header",
      ".hpp": "cpp_header",
      ".ino": "arduino",
      ".cs": "csharp",
      ".go": "go",
      ".rb": "ruby",
      ".php": "php",
      ".rs": "rust"
    }
    return typeMap[ext] || "unknown"
  }

  extractDependencies(content, node) {
    const ext = path.extname(node.name).toLowerCase()

    if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
      // JavaScript/TypeScript
      const importRegex = /import\s+.*?\s+from\s+['"](.+?)['"]/g
      const requireRegex = /require\s*\(['"](.+?)['"]\)/g
      const exportRegex = /export\s+(default\s+)?(class|function|const|let|var)\s+(\w+)/g

      let match
      while ((match = importRegex.exec(content)) !== null) {
        if (match[1].startsWith(".")) {
          node.dependencies.push(match[1])
          node.imports.push(match[1])
        }
      }
      while ((match = requireRegex.exec(content)) !== null) {
        if (match[1].startsWith(".")) {
          node.dependencies.push(match[1])
          node.imports.push(match[1])
        }
      }
      while ((match = exportRegex.exec(content)) !== null) {
        node.exports.push(match[3])
      }
    } else if (ext === ".py") {
      // Python
      const importRegex = /^(?:from|import)\s+([\w.]+)/gm
      let match
      while ((match = importRegex.exec(content)) !== null) {
        node.imports.push(match[1])
      }
    } else if ([".c", ".cpp", ".h", ".hpp", ".ino"].includes(ext)) {
      // C/C++/Arduino
      const includeRegex = /#include\s+["<](.+?)[">]/g
      let match
      while ((match = includeRegex.exec(content)) !== null) {
        node.dependencies.push(match[1])
        node.imports.push(match[1])
      }
    } else if (ext === ".java") {
      // Java
      const importRegex = /import\s+([\w.]+);/g
      let match
      while ((match = importRegex.exec(content)) !== null) {
        node.imports.push(match[1])
      }
    }
  }

  detectCommunities() {
    // Calculate in-degree and out-degree for each node
    const inDegree = new Map()
    const outDegree = new Map()

    for (const node of this.nodes) {
      inDegree.set(node.path, 0)
      outDegree.set(node.path, 0)
    }

    for (const edge of this.edges) {
      outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1)
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1)
    }

    // Identify god nodes (high in-degree or out-degree)
    const godNodes = []
    for (const node of this.nodes) {
      const inDeg = inDegree.get(node.path) || 0
      const outDeg = outDegree.get(node.path) || 0
      const totalDeg = inDeg + outDeg

      if (totalDeg >= 5) {
        godNodes.push({
          ...node,
          inDegree: inDeg,
          outDegree: outDeg,
          totalDegree: totalDeg
        })
      }
    }

    // Sort by total degree
    godNodes.sort((a, b) => b.totalDegree - a.totalDegree)

    // Group by directory (simple community detection)
    const dirGroups = new Map()
    for (const node of this.nodes) {
      const dir = path.dirname(node.path)
      if (!dirGroups.has(dir)) {
        dirGroups.set(dir, [])
      }
      dirGroups.get(dir).push(node)
    }

    this.communities.set("god_nodes", godNodes)
    this.communities.set("directories", Array.from(dirGroups.entries()))
  }

  generateReport() {
    const godNodes = this.communities.get("god_nodes") || []
    const directories = this.communities.get("directories") || []

    let report = `# Codebase Knowledge Graph Report

Generated: ${new Date().toISOString()}

## Overview

- **Total Files**: ${this.nodes.length}
- **Total Dependencies**: ${this.edges.length}
- **Communities**: ${directories.length}

## God Nodes (High Connectivity)

These files are central to the codebase architecture. Changes here affect many other files.

`

    for (const node of godNodes.slice(0, 10)) {
      report += `### ${node.path}

- **Type**: ${node.type}
- **Lines**: ${node.lines}
- **Incoming Dependencies**: ${node.inDegree}
- **Outgoing Dependencies**: ${node.outDegree}
- **Total Connections**: ${node.totalDegree}

`
    }

    report += `## Directory Structure

`

    for (const [dir, files] of directories) {
      if (files.length > 0) {
        report += `### ${dir || "root"}

- **Files**: ${files.length}
- **Types**: ${[...new Set(files.map(f => f.type))].join(", ")}

`
      }
    }

    report += `## Architecture Insights

When answering architecture questions:

1. **Start with God Nodes**: These files (${godNodes.slice(0, 3).map(n => n.name).join(", ")}) are architectural anchors
2. **Follow Dependencies**: Use the dependency graph to understand data flow
3. **Community Boundaries**: Each directory represents a logical module

## Usage

Before searching raw files, consult this report to understand:
- Which files are most important
- How modules connect
- Where to find specific functionality
`

    return report
  }

  async generateAgentConfigs() {
    // Verify all paths are within workspace
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) {
      throw new Error("No workspace folder open")
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath
    
    const configs = {
      claude: this.generateClaudeConfig(),
      cursor: this.generateCursorConfig(),
      gemini: this.generateGeminiConfig(),
      antigravity: this.generateAntigravityConfig(),
      agents: this.generateAgentsConfig()
    }

    // Collect all files that will be written outside workspace
    const outsideFiles = []
    const filesToWrite = [
      { path: path.join(this.workspaceRoot, "CLAUDE.md"), name: "CLAUDE.md" },
      { path: path.join(this.workspaceRoot, ".cursor", "rules", "graphify.mdc"), name: ".cursor/rules/graphify.mdc" },
      { path: path.join(this.workspaceRoot, "GEMINI.md"), name: "GEMINI.md" },
      { path: path.join(this.workspaceRoot, ".agent", "rules", "graphify.md"), name: ".agent/rules/graphify.md" },
      { path: path.join(this.workspaceRoot, "AGENTS.md"), name: "AGENTS.md" }
    ]

    for (const file of filesToWrite) {
      if (!file.path.startsWith(workspaceRoot)) {
        outsideFiles.push(file.name)
      }
    }

    // Ask for permission if any files are outside workspace
    if (outsideFiles.length > 0) {
      const answer = await vscode.window.showWarningMessage(
        `Graphify wants to create/modify these files outside the workspace:\n\n${outsideFiles.join('\n')}\n\nAllow this operation?`,
        { modal: true },
        "Allow",
        "Deny"
      )
      
      if (answer !== "Allow") {
        throw new Error("User denied permission to write outside workspace")
      }
    }

    // Write CLAUDE.md
    const claudePath = path.join(this.workspaceRoot, "CLAUDE.md")
    let claudeContent = ""
    try {
      claudeContent = await fs.readFile(claudePath, "utf8")
    } catch {
      claudeContent = "# Claude AI Instructions\n\n"
    }

    if (!claudeContent.includes("## Graphify Knowledge Graph")) {
      claudeContent += configs.claude
      await fs.writeFile(claudePath, claudeContent, "utf8")
    }

    // Write .cursor/rules/graphify.mdc
    const cursorDir = path.join(this.workspaceRoot, ".cursor", "rules")
    await fs.mkdir(cursorDir, { recursive: true })
    await fs.writeFile(
      path.join(cursorDir, "graphify.mdc"),
      configs.cursor,
      "utf8"
    )

    // Write GEMINI.md
    const geminiPath = path.join(this.workspaceRoot, "GEMINI.md")
    let geminiContent = ""
    try {
      geminiContent = await fs.readFile(geminiPath, "utf8")
    } catch {
      geminiContent = "# Gemini AI Instructions\n\n"
    }

    if (!geminiContent.includes("## Graphify Knowledge Graph")) {
      geminiContent += configs.gemini
      await fs.writeFile(geminiPath, geminiContent, "utf8")
    }

    // Write .agent/rules/graphify.md (Google Antigravity)
    const agentRulesDir = path.join(this.workspaceRoot, ".agent", "rules")
    await fs.mkdir(agentRulesDir, { recursive: true })
    await fs.writeFile(
      path.join(agentRulesDir, "graphify.md"),
      configs.antigravity,
      "utf8"
    )

    // Write AGENTS.md (for Aider, OpenClaw, Factory Droid, Trae, Hermes, Codex, OpenCode)
    const agentsPath = path.join(this.workspaceRoot, "AGENTS.md")
    let agentsContent = ""
    try {
      agentsContent = await fs.readFile(agentsPath, "utf8")
    } catch {
      agentsContent = "# AI Agent Instructions\n\n"
    }

    if (!agentsContent.includes("## Graphify Knowledge Graph")) {
      agentsContent += configs.agents
      await fs.writeFile(agentsPath, agentsContent, "utf8")
    }
  }

  generateClaudeConfig() {
    return `
## Graphify Knowledge Graph

**IMPORTANT**: Before answering architecture questions or searching files, read \`graphify-out/GRAPH_REPORT.md\`.

This report contains:
- **God Nodes**: Central files with high connectivity
- **Community Structure**: How modules are organized
- **Dependency Graph**: File relationships and data flow

Use the knowledge graph to navigate the codebase efficiently instead of grepping through every file.
`
  }

  generateCursorConfig() {
    return `---
alwaysApply: true
---

# Graphify Knowledge Graph

Before answering architecture questions or searching files, read \`graphify-out/GRAPH_REPORT.md\`.

This report contains:
- **God Nodes**: Central files with high connectivity
- **Community Structure**: How modules are organized
- **Dependency Graph**: File relationships and data flow

Use the knowledge graph to navigate the codebase efficiently.
`
  }

  generateGeminiConfig() {
    return `
## Graphify Knowledge Graph

**IMPORTANT**: Before file operations, check if \`graphify-out/GRAPH_REPORT.md\` exists.

If it exists:
1. Read the report first to understand architecture
2. Identify god nodes and community structure
3. Navigate via the dependency graph instead of searching raw files

This improves accuracy and reduces unnecessary file reads.
`
  }

  generateAntigravityConfig() {
    return `# Graphify Knowledge Graph

Before answering architecture questions or searching files, read \`graphify-out/GRAPH_REPORT.md\`.

This report contains:
- **God Nodes**: Central files with high connectivity
- **Community Structure**: How modules are organized
- **Dependency Graph**: File relationships and data flow

Use the knowledge graph to navigate the codebase efficiently.
`
  }

  generateAgentsConfig() {
    return `
## Graphify Knowledge Graph

**For all AI agents**: Before answering architecture questions or searching files, check if \`graphify-out/GRAPH_REPORT.md\` exists.

If the knowledge graph exists:
1. Read \`graphify-out/GRAPH_REPORT.md\` first
2. Identify god nodes (central files with high connectivity)
3. Understand community structure (how modules are organized)
4. Navigate via the dependency graph instead of grepping through every file

This approach:
- Improves accuracy by understanding architecture first
- Reduces unnecessary file reads
- Provides context for code changes

Supported platforms: Aider, OpenClaw, Factory Droid, Trae, Hermes, Codex, OpenCode
`
  }
}

module.exports = GraphifyAnalyzer
