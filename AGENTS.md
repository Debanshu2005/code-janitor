# AI Agent Instructions

## Repository Context Priority

**For all AI agents**: Before broad repo scans or repo-level answers, use this order:

1. Read `workspace.json` first when it exists
2. Read `graphify-out/GRAPH_REPORT.md` next when it exists
3. Read `graphify-out/WORKSPACE_MEMORY.md` and `workspacememory.md` after that when they exist

Use `workspace.json` for structured repo metadata such as file inventory, package details, Git status, Graphify summary, recent changes, and suggested starting points.


## Graphify Knowledge Graph

**For all AI agents**: Before answering architecture questions or searching files, check if `graphify-out/GRAPH_REPORT.md` exists.

If the knowledge graph exists:
1. Read `workspace.json` first when it exists so you inherit machine-readable repo context
2. Read `graphify-out/GRAPH_REPORT.md`
3. Read `graphify-out/WORKSPACE_MEMORY.md` or `workspacememory.md` for handoff notes and recent activity
4. Identify god nodes (central files with high connectivity)
5. Understand community structure (how modules are organized)
6. Navigate via the dependency graph instead of grepping through every file

This approach:
- Improves accuracy by understanding architecture first
- Reduces unnecessary file reads
- Provides context for code changes

Supported platforms: Aider, OpenClaw, Factory Droid, Trae, Hermes, Codex, OpenCode
