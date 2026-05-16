const vscode = require("vscode");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");

const SCRIPT_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];
const STYLE_EXTENSIONS = [".css", ".scss", ".sass", ".less"];
const TRACKED_TEXT_EXTENSIONS = new Set([
  ...SCRIPT_EXTENSIONS,
  ...STYLE_EXTENSIONS,
  ".html",
  ".htm",
  ".json",
  ".webmanifest",
  ".svg"
]);
const TRACKED_BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp"
]);

class GraphifyAnalyzer {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.nodes = [];
    this.edges = [];
    this.communities = new Map();
  }

  async generateKnowledgeGraph() {
    const outputDir = path.join(this.workspaceRoot, "graphify-out");
    
    // Check if we're writing outside workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || !outputDir.startsWith(workspaceFolders[0].uri.fsPath)) {
      // Ask for permission to write outside workspace
      const answer = await vscode.window.showWarningMessage(
        `Graphify wants to create files outside the workspace at:\n${outputDir}\n\nAllow this operation?`,
        { modal: true },
        "Allow",
        "Deny"
      );
      
      if (answer !== "Allow") {
        throw new Error("User denied permission to write outside workspace");
      }
    }
    
    await fs.mkdir(outputDir, { recursive: true });

    // Analyze codebase
    await this.analyzeCodebase();
    
    // Detect communities (god nodes, clusters)
    this.detectCommunities();

    // Generate GRAPH_REPORT.md
    const report = this.generateReport();
    await fs.writeFile(
      path.join(outputDir, "GRAPH_REPORT.md"),
      report,
      "utf8"
    );

    await fs.writeFile(
      path.join(outputDir, "graph.json"),
      JSON.stringify(this.getSerializableGraph(), null, 2),
      "utf8"
    );

    // Generate agent configurations
    await this.generateAgentConfigs();

    return {
      success: true,
      outputDir,
      nodeCount: this.nodes.length,
      edgeCount: this.edges.length,
      communityCount: this.communities.size
    };
  }

  async analyzeCodebase() {
    const ignoreDirs = new Set([".git", "node_modules", "dist", "build", "out", "venv", "__pycache__", "graphify-out"]);

    const scanDirectory = async (dirPath) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(this.workspaceRoot, fullPath);

          if (entry.isDirectory()) {
            if (ignoreDirs.has(entry.name)) continue;
            await scanDirectory(fullPath);
          } else if (this._shouldTrackFile(entry.name)) {
            try {
              const node = {
                path: relativePath.replace(/\\/g, "/"),
                name: entry.name,
                type: this.getFileType(entry.name),
                lines: 0,
                imports: [],
                exports: [],
                dependencies: []
              };

              if (this._isTextTrackedFile(entry.name)) {
                const content = await fs.readFile(fullPath, "utf8");
                node.lines = content.split("\n").length;

                const references = this.extractDependencies(content, node);
                const seenTargets = new Set();

                for (const reference of references) {
                  const resolvedDependency = this.resolveDependencyPath(
                    reference.specifier,
                    fullPath,
                    reference.kind
                  );
                  if (!resolvedDependency) continue;

                  if (!seenTargets.has(resolvedDependency)) {
                    seenTargets.add(resolvedDependency);
                    node.dependencies.push(resolvedDependency);
                  }

                  this.edges.push({
                    from: node.path,
                    to: resolvedDependency,
                    type: reference.type,
                    specifier: reference.specifier
                  });
                }
              }

              this.nodes.push(node);
            } catch (err) {
              // Skip files that can't be read
            }
          }
        }
      } catch (err) {
        console.error(`Error scanning ${dirPath}:`, err);
      }
    };

    await scanDirectory(this.workspaceRoot);
  }

  _shouldTrackFile(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return TRACKED_TEXT_EXTENSIONS.has(ext) ||
      TRACKED_BINARY_EXTENSIONS.has(ext) ||
      this._isCodeGraphFile(fileName);
  }

  _isTextTrackedFile(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return TRACKED_TEXT_EXTENSIONS.has(ext) || this._isCodeGraphFile(fileName);
  }

  _isCodeGraphFile(fileName) {
    return /\.(js|jsx|ts|tsx|py|java|c|cpp|h|hpp|ino|cs|go|rb|php|rs|mjs|cjs)$/i.test(
      fileName
    );
  }

  getFileType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
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
      ".rs": "rust",
      ".html": "html",
      ".htm": "html",
      ".css": "stylesheet",
      ".scss": "stylesheet",
      ".sass": "stylesheet",
      ".less": "stylesheet",
      ".json": "json",
      ".webmanifest": "manifest",
      ".svg": "asset",
      ".png": "asset",
      ".jpg": "asset",
      ".jpeg": "asset",
      ".gif": "asset",
      ".webp": "asset",
      ".avif": "asset",
      ".ico": "asset",
      ".bmp": "asset"
    };
    return typeMap[ext] || "unknown";
  }

  extractDependencies(content, node) {
    const ext = path.extname(node.name).toLowerCase();
    const references = [];

    if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
      // JavaScript/TypeScript
      const importRegex = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
      const requireRegex = /require\s*\(['"](.+?)['"]\)/g;
      const exportRegex = /export\s+(default\s+)?(class|function|const|let|var)\s+(\w+)/g;
      const dynamicImportRegex = /import\s*\(\s*['"](.+?)['"]\s*\)/g;
      const importMetaAssetRegex =
        /new\s+URL\(\s*['"](.+?)['"]\s*,\s*import\.meta\.url\s*\)/g;

      let match;
      while ((match = importRegex.exec(content)) !== null) {
        node.imports.push(match[1]);
        references.push({
          specifier: match[1],
          type: "imports",
          kind: "module"
        });
      }
      while ((match = requireRegex.exec(content)) !== null) {
        node.imports.push(match[1]);
        references.push({
          specifier: match[1],
          type: "requires",
          kind: "module"
        });
      }
      while ((match = dynamicImportRegex.exec(content)) !== null) {
        node.imports.push(match[1]);
        references.push({
          specifier: match[1],
          type: "dynamic-import",
          kind: "module"
        });
      }
      while ((match = importMetaAssetRegex.exec(content)) !== null) {
        references.push({
          specifier: match[1],
          type: "asset-url",
          kind: "asset"
        });
      }
      while ((match = exportRegex.exec(content)) !== null) {
        node.exports.push(match[3]);
      }
    } else if (ext === ".py") {
      // Python
      const fromImportRegex = /^\s*from\s+([.\w]+)\s+import\s+([^\n#]+)/gm;
      const importRegex = /^\s*import\s+([^\n#]+)/gm;
      let match;
      while ((match = fromImportRegex.exec(content)) !== null) {
        const moduleName = (match[1] || "").trim();
        if (!moduleName) continue;

        node.imports.push(moduleName);
        references.push({
          specifier: moduleName,
          type: "python-from",
          kind: "python-module"
        });

        const importedNames = this._splitCommaSeparatedSpecifiers(match[2]);
        for (const importedName of importedNames) {
          if (!importedName || importedName === "*") continue;
          references.push({
            specifier: `${moduleName}.${importedName}`,
            type: "python-from-member",
            kind: "python-module"
          });
        }
      }

      while ((match = importRegex.exec(content)) !== null) {
        const importedModules = this._splitCommaSeparatedSpecifiers(match[1]);
        for (const importedModule of importedModules) {
          if (!importedModule) continue;
          node.imports.push(importedModule);
          references.push({
            specifier: importedModule,
            type: "python-import",
            kind: "python-module"
          });
        }
      }
    } else if ([".c", ".cpp", ".h", ".hpp", ".ino"].includes(ext)) {
      // C/C++/Arduino
      const includeRegex = /#include\s+["<](.+?)[">]/g;
      let match;
      while ((match = includeRegex.exec(content)) !== null) {
        node.imports.push(match[1]);
        references.push({
          specifier: match[1],
          type: "include",
          kind: "module"
        });
      }
    } else if (ext === ".java") {
      // Java
      const importRegex = /import\s+([\w.]+);/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        node.imports.push(match[1]);
        references.push({
          specifier: match[1],
          type: "java-import",
          kind: "java-module"
        });
      }
    } else if (ext === ".html" || ext === ".htm") {
      this._collectHtmlReferences(content, references);
    } else if (STYLE_EXTENSIONS.includes(ext)) {
      this._collectCssReferences(content, references);
    }

    return references;
  }

  _splitCommaSeparatedSpecifiers(rawValue) {
    return String(rawValue || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/\s+as\s+.+$/i, "").trim())
      .filter(Boolean);
  }

  _collectHtmlReferences(content, references) {
    this._collectMatches(
      /<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi,
      content,
      (match, href) => {
        if (!this._shouldTrackHtmlLink(match[0], href)) return null;
        return {
          specifier: href,
          type: "link",
          kind: this._inferHtmlLinkKind(match[0], href)
        };
      },
      references
    );

    this._collectMatches(
      /<script\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi,
      content,
      (_, src) => ({
        specifier: src,
        type: "script-src",
        kind: "script"
      }),
      references
    );

    this._collectMatches(
      /<(?:img|audio|video|source|track)\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi,
      content,
      (_, src) => ({
        specifier: src,
        type: "asset-src",
        kind: "asset"
      }),
      references
    );

    this._collectMatches(
      /<video\b[^>]*poster\s*=\s*["']([^"']+)["'][^>]*>/gi,
      content,
      (_, src) => ({
        specifier: src,
        type: "poster",
        kind: "asset"
      }),
      references
    );

    const srcsetRegex = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
    let match = srcsetRegex.exec(content);
    while (match) {
      const entries = (match[1] || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

      for (const entry of entries) {
        const reference = entry.split(/\s+/)[0];
        if (!reference || this._shouldIgnoreSpecifier(reference)) continue;
        references.push({
          specifier: reference,
          type: "srcset",
          kind: "asset"
        });
      }

      match = srcsetRegex.exec(content);
    }
  }

  _collectCssReferences(content, references) {
    this._collectMatches(
      /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/gi,
      content,
      (_, src) => ({
        specifier: src,
        type: "css-import",
        kind: "stylesheet"
      }),
      references
    );

    this._collectMatches(
      /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
      content,
      (_, src) => ({
        specifier: src,
        type: "css-url",
        kind: "asset"
      }),
      references
    );
  }

  _collectMatches(regex, content, buildReference, references) {
    let match = regex.exec(content);
    while (match) {
      const reference = (match[1] || "").trim();
      const nextReference = buildReference(match, reference);
      if (nextReference && !this._shouldIgnoreSpecifier(nextReference.specifier)) {
        references.push(nextReference);
      }
      match = regex.exec(content);
    }
  }

  _shouldTrackHtmlLink(tagText, href) {
    if (this._shouldIgnoreSpecifier(href)) {
      return false;
    }

    const relMatch = tagText.match(/\brel\s*=\s*["']([^"']+)["']/i);
    const rel = relMatch ? relMatch[1].toLowerCase() : "";

    if (
      /stylesheet|icon|manifest|preload|modulepreload|prefetch|apple-touch-icon/.test(
        rel
      )
    ) {
      return true;
    }

    return /\.(css|scss|sass|less|json|webmanifest|svg|png|jpe?g|gif|webp|avif|ico)$/i.test(
      this._stripQueryAndHash(href)
    );
  }

  _inferHtmlLinkKind(tagText, href) {
    const relMatch = tagText.match(/\brel\s*=\s*["']([^"']+)["']/i);
    const rel = relMatch ? relMatch[1].toLowerCase() : "";
    const normalized = this._stripQueryAndHash(href).toLowerCase();
    return /stylesheet|modulepreload/.test(rel) ||
      STYLE_EXTENSIONS.some((candidateExt) => normalized.endsWith(candidateExt))
      ? "stylesheet"
      : "asset";
  }

  _shouldIgnoreSpecifier(specifier) {
    const trimmed = (specifier || "").trim();
    if (!trimmed) return true;

    return (
      /^__[\w.-]+__$/.test(trimmed) ||
      /^\$\{[^}]+\}$/.test(trimmed) ||
      /^\{\{[\s\S]+\}\}$/.test(trimmed) ||
      /^<%[-=]?[\s\S]+%>$/.test(trimmed) ||
      trimmed.startsWith("#") ||
      /^data:/i.test(trimmed) ||
      /^blob:/i.test(trimmed) ||
      /^about:/i.test(trimmed) ||
      /^mailto:/i.test(trimmed) ||
      /^tel:/i.test(trimmed) ||
      /^javascript:/i.test(trimmed) ||
      /^https?:/i.test(trimmed) ||
      /^\/\//.test(trimmed)
    );
  }

  resolveDependencyPath(specifier, currentFilePath, kind) {
    const normalizedSpecifier = this._stripQueryAndHash(specifier);
    if (!normalizedSpecifier || this._shouldIgnoreSpecifier(normalizedSpecifier)) {
      return null;
    }

    if (kind === "python-module") {
      return this._resolvePythonModulePath(normalizedSpecifier, currentFilePath);
    }

    if (kind === "java-module") {
      return this._resolveJavaModulePath(normalizedSpecifier);
    }

    const baseDir = path.dirname(currentFilePath);
    const isRootRelative =
      /^[\\/]/.test(normalizedSpecifier) &&
      !/^[a-zA-Z]:[\\/]/.test(normalizedSpecifier) &&
      !normalizedSpecifier.startsWith("//") &&
      !normalizedSpecifier.startsWith("\\\\");

    const basePath = isRootRelative
      ? path.join(this.workspaceRoot, normalizedSpecifier.replace(/^[\\/]+/, ""))
      : path.resolve(baseDir, normalizedSpecifier);
    const ext = path.extname(basePath).toLowerCase();
    const candidateBases = [basePath];

    if (
      ["asset", "stylesheet", "script"].includes(kind) &&
      !isRootRelative &&
      !/^\.\.?(?:[\\/]|$)/.test(normalizedSpecifier) &&
      /[\\/]/.test(normalizedSpecifier)
    ) {
      candidateBases.push(
        path.join(this.workspaceRoot, normalizedSpecifier.replace(/^[\\/]+/, ""))
      );
    }

    const candidates = [];
    candidateBases.forEach((candidateBase) => {
      candidates.push(candidateBase);
    });

    if (!ext) {
      if (kind === "module" || kind === "script") {
        candidateBases.forEach((candidateBase) => {
          for (const candidateExt of SCRIPT_EXTENSIONS) {
            candidates.push(candidateBase + candidateExt);
            candidates.push(path.join(candidateBase, "index" + candidateExt));
          }
        });
      } else if (kind === "stylesheet") {
        candidateBases.forEach((candidateBase) => {
          for (const candidateExt of STYLE_EXTENSIONS) {
            candidates.push(candidateBase + candidateExt);
            candidates.push(path.join(candidateBase, "index" + candidateExt));
          }
        });
      }
    }

    for (const candidate of candidates) {
      try {
        const stat = fsSync.statSync(candidate);
        if (stat.isFile()) {
          return path.relative(this.workspaceRoot, candidate).replace(/\\/g, "/");
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  _resolvePythonModulePath(specifier, currentFilePath) {
    const candidateBases = [];
    const normalizedSpecifier = String(specifier || "").trim();

    if (!normalizedSpecifier) {
      return null;
    }

    if (normalizedSpecifier.startsWith(".")) {
      const leadingDotsMatch = normalizedSpecifier.match(/^(\.+)/);
      const leadingDots = leadingDotsMatch ? leadingDotsMatch[1].length : 0;
      const remainder = normalizedSpecifier.slice(leadingDots).replace(/\./g, "/");
      let baseDir = path.dirname(currentFilePath);

      for (let i = 1; i < leadingDots; i++) {
        baseDir = path.dirname(baseDir);
      }

      candidateBases.push(remainder ? path.join(baseDir, remainder) : baseDir);
    } else {
      const dottedPath = normalizedSpecifier.replace(/\./g, "/");
      candidateBases.push(path.join(this.workspaceRoot, dottedPath));
      candidateBases.push(path.join(path.dirname(currentFilePath), dottedPath));
    }

    return this._resolveFirstExistingCandidate(
      candidateBases.flatMap((candidateBase) => [
        `${candidateBase}.py`,
        path.join(candidateBase, "__init__.py")
      ])
    );
  }

  _resolveJavaModulePath(specifier) {
    const modulePath = String(specifier || "").trim().replace(/\./g, "/");
    if (!modulePath) {
      return null;
    }

    return this._resolveFirstExistingCandidate([
      path.join(this.workspaceRoot, `${modulePath}.java`),
      path.join(this.workspaceRoot, "src", `${modulePath}.java`),
      path.join(this.workspaceRoot, "src", "main", "java", `${modulePath}.java`),
      path.join(this.workspaceRoot, "src", "test", "java", `${modulePath}.java`),
      path.join(this.workspaceRoot, "app", "src", "main", "java", `${modulePath}.java`)
    ]);
  }

  _resolveFirstExistingCandidate(candidates) {
    for (const candidate of candidates) {
      try {
        const stat = fsSync.statSync(candidate);
        if (stat.isFile()) {
          return path.relative(this.workspaceRoot, candidate).replace(/\\/g, "/");
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  _stripQueryAndHash(specifier) {
    return (specifier || "").trim().replace(/[?#].*$/, "");
  }

  detectCommunities() {
    // Calculate in-degree and out-degree for each node
    const inDegree = new Map();
    const outDegree = new Map();

    for (const node of this.nodes) {
      inDegree.set(node.path, 0);
      outDegree.set(node.path, 0);
    }

    for (const edge of this.edges) {
      outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    // Identify god nodes (high in-degree or out-degree)
    const godNodes = [];
    for (const node of this.nodes) {
      const inDeg = inDegree.get(node.path) || 0;
      const outDeg = outDegree.get(node.path) || 0;
      const totalDeg = inDeg + outDeg;

      if (totalDeg >= 5) {
        godNodes.push({
          ...node,
          inDegree: inDeg,
          outDegree: outDeg,
          totalDegree: totalDeg
        });
      }
    }

    // Sort by total degree
    godNodes.sort((a, b) => b.totalDegree - a.totalDegree);

    // Group by directory (simple community detection)
    const dirGroups = new Map();
    for (const node of this.nodes) {
      const dir = path.dirname(node.path);
      if (!dirGroups.has(dir)) {
        dirGroups.set(dir, []);
      }
      dirGroups.get(dir).push(node);
    }

    this.communities.set("god_nodes", godNodes);
    this.communities.set("directories", Array.from(dirGroups.entries()));
  }

  generateReport() {
    const godNodes = this.communities.get("god_nodes") || [];
    const directories = this.communities.get("directories") || [];

    let report = `# Codebase Knowledge Graph Report

Generated: ${new Date().toISOString()}

## Overview

- **Total Files**: ${this.nodes.length}
- **Total Dependencies**: ${this.edges.length}
- **Communities**: ${directories.length}

## God Nodes (High Connectivity)

These files are central to the codebase architecture. Changes here affect many other files.

`;

    for (const node of godNodes.slice(0, 10)) {
      report += `### ${node.path}

- **Type**: ${node.type}
- **Lines**: ${node.lines}
- **Incoming Dependencies**: ${node.inDegree}
- **Outgoing Dependencies**: ${node.outDegree}
- **Total Connections**: ${node.totalDegree}

`;
    }

    report += `## Directory Structure

`;

    for (const [dir, files] of directories) {
      if (files.length > 0) {
        report += `### ${dir || "root"}

- **Files**: ${files.length}
- **Types**: ${[...new Set(files.map(f => f.type))].join(", ")}

`;
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
`;

    return report;
  }

  getSerializableGraph() {
    const godNodes = (this.communities.get("god_nodes") || []).map((node) => ({
      path: node.path,
      name: node.name,
      type: node.type,
      lines: node.lines,
      inDegree: node.inDegree,
      outDegree: node.outDegree,
      totalDegree: node.totalDegree
    }));
    const directories = (this.communities.get("directories") || []).map(
      ([directoryPath, files]) => ({
        path: directoryPath || "",
        fileCount: files.length,
        types: [...new Set(files.map((file) => file.type))]
      })
    );

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      nodeCount: this.nodes.length,
      edgeCount: this.edges.length,
      communityCount: this.communities.size,
      nodes: this.nodes,
      edges: this.edges,
      communities: {
        godNodes,
        directories
      }
    };
  }

  async generateAgentConfigs() {
    // Verify all paths are within workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      throw new Error("No workspace folder open");
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    
    const configs = {
      claude: this.generateClaudeConfig(),
      cursor: this.generateCursorConfig(),
      gemini: this.generateGeminiConfig(),
      antigravity: this.generateAntigravityConfig(),
      agents: this.generateAgentsConfig()
    };

    // Collect all files that will be written outside workspace
    const outsideFiles = [];
    const filesToWrite = [
      { path: path.join(this.workspaceRoot, "CLAUDE.md"), name: "CLAUDE.md" },
      { path: path.join(this.workspaceRoot, ".cursor", "rules", "graphify.mdc"), name: ".cursor/rules/graphify.mdc" },
      { path: path.join(this.workspaceRoot, "GEMINI.md"), name: "GEMINI.md" },
      { path: path.join(this.workspaceRoot, ".agent", "rules", "graphify.md"), name: ".agent/rules/graphify.md" },
      { path: path.join(this.workspaceRoot, "AGENTS.md"), name: "AGENTS.md" }
    ];

    for (const file of filesToWrite) {
      if (!file.path.startsWith(workspaceRoot)) {
        outsideFiles.push(file.name);
      }
    }

    // Ask for permission if any files are outside workspace
    if (outsideFiles.length > 0) {
      const answer = await vscode.window.showWarningMessage(
        `Graphify wants to create/modify these files outside the workspace:\n\n${outsideFiles.join("\n")}\n\nAllow this operation?`,
        { modal: true },
        "Allow",
        "Deny"
      );
      
      if (answer !== "Allow") {
        throw new Error("User denied permission to write outside workspace");
      }
    }

    // Write CLAUDE.md
    const claudePath = path.join(this.workspaceRoot, "CLAUDE.md");
    let claudeContent = "";
    try {
      claudeContent = await fs.readFile(claudePath, "utf8");
    } catch {
      claudeContent = "# Claude AI Instructions\n\n";
    }

    if (!claudeContent.includes("## Graphify Knowledge Graph")) {
      claudeContent += configs.claude;
      await fs.writeFile(claudePath, claudeContent, "utf8");
    }

    // Write .cursor/rules/graphify.mdc
    const cursorDir = path.join(this.workspaceRoot, ".cursor", "rules");
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.writeFile(
      path.join(cursorDir, "graphify.mdc"),
      configs.cursor,
      "utf8"
    );

    // Write GEMINI.md
    const geminiPath = path.join(this.workspaceRoot, "GEMINI.md");
    let geminiContent = "";
    try {
      geminiContent = await fs.readFile(geminiPath, "utf8");
    } catch {
      geminiContent = "# Gemini AI Instructions\n\n";
    }

    if (!geminiContent.includes("## Graphify Knowledge Graph")) {
      geminiContent += configs.gemini;
      await fs.writeFile(geminiPath, geminiContent, "utf8");
    }

    // Write .agent/rules/graphify.md (Google Antigravity)
    const agentRulesDir = path.join(this.workspaceRoot, ".agent", "rules");
    await fs.mkdir(agentRulesDir, { recursive: true });
    await fs.writeFile(
      path.join(agentRulesDir, "graphify.md"),
      configs.antigravity,
      "utf8"
    );

    // Write AGENTS.md (for Aider, OpenClaw, Factory Droid, Trae, Hermes, Codex, OpenCode)
    const agentsPath = path.join(this.workspaceRoot, "AGENTS.md");
    let agentsContent = "";
    try {
      agentsContent = await fs.readFile(agentsPath, "utf8");
    } catch {
      agentsContent = "# AI Agent Instructions\n\n";
    }

    if (!agentsContent.includes("## Graphify Knowledge Graph")) {
      agentsContent += configs.agents;
      await fs.writeFile(agentsPath, agentsContent, "utf8");
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
`;
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
`;
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
`;
  }

  generateAntigravityConfig() {
    return `# Graphify Knowledge Graph

Before answering architecture questions or searching files, read \`graphify-out/GRAPH_REPORT.md\`.

This report contains:
- **God Nodes**: Central files with high connectivity
- **Community Structure**: How modules are organized
- **Dependency Graph**: File relationships and data flow

Use the knowledge graph to navigate the codebase efficiently.
`;
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
`;
  }
}

module.exports = GraphifyAnalyzer;
