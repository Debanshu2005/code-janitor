# AI Agent Instructions


## Graphify Knowledge Graph

**For all AI agents**: Before answering architecture questions or searching files, check if `graphify-out/GRAPH_REPORT.md` exists.

If the knowledge graph exists:
1. Read `graphify-out/GRAPH_REPORT.md` first
2. Identify god nodes (central files with high connectivity)
3. Understand community structure (how modules are organized)
4. Navigate via the dependency graph instead of grepping through every file

This approach:
- Improves accuracy by understanding architecture first
- Reduces unnecessary file reads
- Provides context for code changes

Supported platforms: Aider, OpenClaw, Factory Droid, Trae, Hermes, Codex, OpenCode
