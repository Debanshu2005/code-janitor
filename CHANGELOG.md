# Changelog

All notable changes to Code Janitor are documented here.

## [1.1.0] - 2026-07-05

### Added

- Added GitHub Actions CI for install, lint, tests, and VS Code extension packaging.
- Added Marketplace-visible release notes through this changelog.
- Added issue templates, a pull request template, and a security policy for responsible disclosure.

### Changed

- Updated package and lockfile versions to 1.1.0.
- Switched VS Code packaging and publishing scripts to cross-platform `vsce` commands.

## [1.0.0] - 2026-07-05

### Added

- Initial Marketplace-ready VS Code extension release for Code Janitor.
- Multi-language formatting and repair support for JavaScript, TypeScript, Python, Java, C, C++, Arduino, HTML, CSS, JSON, Markdown, SVG, Vue, and Svelte workflows.
- AI-assisted syntax fixing and chat workflows with Ollama, Groq, OpenRouter, Anthropic, NVIDIA, and custom providers.
- Live preview for frontend, Markdown, JSON, SVG, Vue, Svelte, and related file types.
- Graphify project visualization for understanding codebase relationships.
- Shared workspace memory with `workspacememory.md` and structured `workspace.json` handoff data.
- Self-healing performance and self-diagnosing error handling for AI/provider workflows.
- Project planner, GitHub context, edge-case generation, test execution, and documentation generation commands.
- Local CLI entry point for batch cleanup outside the extension UI.
- Jest test coverage across AI agent, Graphify, MCP services, self-healing, core fixer, and utility modules.
