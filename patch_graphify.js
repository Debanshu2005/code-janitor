const fs = require('fs');

let c = fs.readFileSync('src/ai-agent/chat-panel.js', 'utf8');

const methods = `
  _shouldInjectGraphifyContext(message) {
    const text = String(message || "");
    return /\\b(codebase|repo|repository|project|architecture|structure|overview|graph|dependencies|modules?)\\b/i.test(text) &&
      /\\b(show|explain|describe|summarize|overview|understand|analyze|analyse|what does|how (is|does)|structure of)\\b/i.test(text);
  }

  async _buildGraphifySystemOverlay(workspaceFolder) {
    if (!workspaceFolder) return null;
    if (this._lastGraphifySummary && this._lastGraphifySummary.workspaceFolder === workspaceFolder) {
      return this._lastGraphifySummary.text;
    }
    const fs = require("fs");
    const path = require("path");
    const reportPath = path.join(workspaceFolder, "graphify-out", "GRAPH_REPORT.md");
    if (!fs.existsSync(reportPath)) return null;
    try {
      const content = fs.readFileSync(reportPath, "utf8");
      const sections = content.split(/^## /m);
      let extracted = "";
      for (const section of sections) {
        if (section.trim().startsWith("Overview") || section.trim().startsWith("God Nodes")) {
          extracted += "## " + section.trim() + "\\n\\n";
        }
      }
      if (!extracted) return null;
      const text = \`Current Graphify knowledge graph for this workspace (use this to answer codebase-wide/architecture questions accurately):\\n\${extracted.trim()}\`;
      this._lastGraphifySummary = { text, workspaceFolder, generatedAt: Date.now() };
      return text;
    } catch (err) {
      console.warn("Failed to read graphify report for system overlay:", err);
      return null;
    }
  }
`;

c = c.replace('  _previewDiagnosticsHasIssues(diagnostics) {', methods + '\n  _previewDiagnosticsHasIssues(diagnostics) {');

const injection1 = `            const mcpSystemOverlay = await this._buildMcpSystemOverlay(
              workspaceFolder
            );
            const graphifySystemOverlay = this._shouldInjectGraphifyContext(requestText)
              ? await this._buildGraphifySystemOverlay(workspaceFolder)
              : null;
            const combinedSystemOverlay = [systemOverlay, mcpSystemOverlay, graphifySystemOverlay]
              .filter(Boolean)
              .join("\\n\\n");`;

c = c.replace(`            const mcpSystemOverlay = await this._buildMcpSystemOverlay(
              workspaceFolder
            );
            const combinedSystemOverlay = [systemOverlay, mcpSystemOverlay]
              .filter(Boolean)
              .join("\\n\\n");`, injection1);


const injection2 = `          const mcpSystemOverlay = await this._buildMcpSystemOverlay(
            workspaceFolder
          );
          const graphifySystemOverlay = this._shouldInjectGraphifyContext(requestText)
            ? await this._buildGraphifySystemOverlay(workspaceFolder)
            : null;
          const combinedSystemOverlay = [systemOverlay, mcpSystemOverlay, graphifySystemOverlay]
            .filter(Boolean)
            .join("\\n\\n");`;

c = c.replace(`          const mcpSystemOverlay = await this._buildMcpSystemOverlay(
            workspaceFolder
          );
          const combinedSystemOverlay = [systemOverlay, mcpSystemOverlay]
            .filter(Boolean)
            .join("\\n\\n");`, injection2);


const injection3 = `                await vscode.commands.executeCommand("codeJanitor.openGraphify");
                
                this._lastGraphifySummary = null;
                const summary = await this._buildGraphifySystemOverlay(workspaceFolder);
                const appliedText = summary 
                  ? "\u2705 Graphify panel opened. Current codebase state:\\n\\n" + summary
                  : "\u2705 Graphify panel opened. You can now visualize the codebase structure.";

                console.log("[ChatPanel] Graphify command executed successfully");
                this._postMessage({
                  type: "applied",
                  text: appliedText
                });`;

c = c.replace(`                await vscode.commands.executeCommand("codeJanitor.openGraphify");
                console.log("[ChatPanel] Graphify command executed successfully");
                this._postMessage({
                  type: "applied",
                  text: "\\u2705 Graphify panel opened. You can now visualize the codebase structure."
                });`, injection3);

fs.writeFileSync('src/ai-agent/chat-panel.js', c);
console.log('Patched chat-panel.js');
