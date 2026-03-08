# Changelog

## v1.1.2

### Fixes

- Release workflow no longer depends on GitHub Actions expression parsing for `VSCE_PAT`
- Marketplace publish step now degrades cleanly when the publisher token is not configured

## v1.1.1

### Fixes

- GitHub Actions release workflow validation fixed for Marketplace publish gating
- CI packaging step now creates the `artifacts/` directory before calling `vsce`

## v1.1.0

### Features

- DigiSpace branding, command IDs, and dedicated VS Code panel
- External bridge support for Codex, Claude, Gemini, and Vibe-based orchestration lanes
- Dedicated `.digispace/external-agents.json` state file with compatibility bridge from AllMyStack

### Release

- GitHub release and VS Code Marketplace publication workflow prepared for the DigiSpace fork
- Local patch/build/package/install pipeline automated through AllMyStack

### Compatibility

- Coexists cleanly with upstream Pixel Agents command IDs and workspace storage
- Marketplace metadata prepared for the `byhdn.digispace-pixel-agent` publisher namespace

## v1.0.2

### Bug Fixes

- **macOS path sanitization and file watching reliability** ([#45](https://github.com/pablodelucca/pixel-agents/pull/45)) — Comprehensive path sanitization for workspace paths with underscores, Unicode/CJK chars, dots, spaces, and special characters. Added `fs.watchFile()` as reliable secondary watcher on macOS. Fixes [#32](https://github.com/pablodelucca/pixel-agents/issues/32), [#39](https://github.com/pablodelucca/pixel-agents/issues/39), [#40](https://github.com/pablodelucca/pixel-agents/issues/40).

### Features

- **Workspace folder picker for multi-root workspaces** ([#12](https://github.com/pablodelucca/pixel-agents/pull/12)) — Clicking "+ Agent" in a multi-root workspace now shows a picker to choose which folder to open Claude Code in.

### Maintenance

- **Lower VS Code engine requirement to ^1.107.0** ([#13](https://github.com/pablodelucca/pixel-agents/pull/13)) — Broadens compatibility with older VS Code versions and forks (Cursor, etc.) without code changes.

### Contributors

Thank you to the contributors who made this release possible:

- [@johnnnzhub](https://github.com/johnnnzhub) — macOS path sanitization and file watching fixes
- [@pghoya2956](https://github.com/pghoya2956) — multi-root workspace folder picker, VS Code engine compatibility

## v1.0.1

Initial public release.
