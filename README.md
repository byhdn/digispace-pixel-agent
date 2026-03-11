# DigiSpace

DigiSpace is a VS Code extension that turns your AI delivery lanes into a local-first project cockpit: animated pixel agents, a synchronized kanban, and persistent handoff context stored inside the project.

It keeps the terminal-driven Pixel Agents experience for Claude Code, and extends it with project-aware launches for Codex and Gemini plus an external bridge model for orchestration lanes.

![DigiSpace screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **One agent, one character** — every tracked lane gets its own animated character
- **Live activity tracking** — characters animate based on what the agent is actually doing (writing, reading, running commands)
- **Project-local board** — every workspace gets `.digispace/kanban.json`, `.digispace/context.json`, `.digispace/journal.ndjson`, and `.digispace/sessions/`
- **Integrated Board and Context views** — manage cards, sessions, and project metadata without leaving the DigiSpace panel
- **Provider-aware launch flow** — `+ Agent` can start Claude, Codex, or Gemini and inject the current project handoff plus selected board card
- **External bridge support** — visualize Codex, Gemini, Claude arbitration lanes, and Vibe workspaces from `.digispace/external-agents.json`
- **Office layout editor** — design your office with floors, walls, and furniture using a built-in editor
- **Speech bubbles** — visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** — optional chime when an agent finishes its turn
- **Sub-agent visualization** — Task tool sub-agents spawn as separate characters linked to their parent
- **Persistent project state** — office layout, board selection, journal, and handoff survive reloads and sync across VS Code windows on the same project
- **Diverse characters** — 6 diverse characters. These are based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

<p align="center">
  <img src="webview-ui/public/characters.png" alt="DigiSpace characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- VS Code 1.107.0 or later
- Optional: Claude Code CLI for terminal-native agents
- Optional: an external bridge that writes `.digispace/external-agents.json`

## Getting Started

If you just want to use DigiSpace, install the VSIX or the Marketplace build once it is published. If you want to develop or contribute, use the fork directly:

### Install from source

```bash
git clone https://github.com/byhdn/digispace-pixel-agent.git
cd digispace-pixel-agent
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Usage

1. Open the **DigiSpace** panel
2. Use `+ Agent` to choose `Claude`, `Codex`, or `Gemini`
3. Open the `Board` tab to create or select a card for the current task
4. Launch an agent from the selected card or assign an existing agent to it
5. Use the `Context` tab to inspect project metadata, active agents, and recent session summaries
6. Click a character to select it, then click a seat to reassign it
7. Click **Layout** to open the office editor and customize your space

### Local Project Storage

For every project, DigiSpace stores its runtime state under `.digispace/`:

- `kanban.json` — local-first board and selected card
- `context.json` — project metadata and detected instruction files
- `journal.ndjson` — append-only board and agent activity log
- `agent-handoff.md` — shared handoff brief for newly launched agents
- `sessions/*.md` — session summaries captured from the panel

If the workspace is inside a Git repository, DigiSpace automatically adds `.digispace/` to `.git/info/exclude` so this local runtime state stays out of version control.

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — Share layouts as JSON files via the Settings modal

The grid is expandable up to 64×64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

The office tileset used in this project and available via the extension is **[Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset)** by **Donarg**, available on itch.io for **$2 USD**.

This is the only part of the project that is not freely available. The tileset is not included in this repository due to its license. To use DigiSpace locally with the full set of office furniture and decorations, purchase the tileset and run the asset import pipeline:

```bash
npm run import-tileset
```

Fair warning: the import pipeline is not exactly straightforward — the out-of-the-box tileset assets aren't the easiest to work with, and while I've done my best to make the process as smooth as possible, it may require some manual tweaking. If you have experience creating pixel art office assets and would like to contribute freely usable tilesets for the community, that would be hugely appreciated.

The extension will still work without the tileset — you'll get the default characters and basic layout, but the full furniture catalog requires the imported assets.

## How It Works

DigiSpace supports two observation modes:

- Claude Code transcript watching for terminal-native agents
- External bridge watching via `.digispace/external-agents.json`

For Codex and Gemini, DigiSpace uses a lighter model: provider-aware launch commands, project handoff files, selected board card context, and board-driven lifecycle state (`active`, `review`, `blocked`, `done`) when transcript telemetry is not available.

When an agent uses a tool, waits for approval, or finishes a lane, DigiSpace updates the character state accordingly. No direct modification of the agents themselves is required.

The webview runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle → walk → type/read). Everything is pixel-perfect at integer zoom levels.

## Tech Stack

- **Extension**: TypeScript, VS Code Webview API, esbuild
- **Webview**: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- **Agent-terminal sync** — the way agents are connected to Claude Code terminal instances is not super robust and sometimes desyncs, especially when terminals are rapidly opened/closed or restored across sessions.
- **Heuristic-based status detection** — Claude Code's JSONL transcript format does not provide clear signals for when an agent is waiting for user input or when it has finished its turn. The current detection is based on heuristics (idle timers, turn-duration events) and often misfires — agents may briefly show the wrong status or miss transitions.
- **Provider telemetry parity** — Claude still has the richest live telemetry. Codex and Gemini currently rely on launch context, board lifecycle state, and saved summaries rather than a fully parsed live transcript stream.
- **Windows-only testing** — the extension has only been tested on Windows 11. It may work on macOS or Linux, but there could be unexpected issues with file watching, paths, or terminal behavior on those platforms.

## Roadmap

There are several areas where contributions would be very welcome:

- **Improve agent-terminal reliability** — more robust connection and sync between characters and Claude Code instances
- **Better status detection** — find or propose clearer signals for agent state transitions (waiting, done, permission needed)
- **Community assets** — freely usable pixel art tilesets or characters that anyone can use without purchasing third-party assets
- **Agent creation and definition** — define agents with custom skills, system prompts, names, and skins before launching them
- **Desks as directories** — click on a desk to select a working directory, drag and drop agents or click-to-assign to move them to specific desks/projects
- **Claude Code agent teams** — native support for [agent teams](https://code.claude.com/docs/en/agent-teams), visualizing multi-agent coordination and communication
- **Git worktree support** — agents working in different worktrees to avoid conflict from parallel work on the same files
- **Support for other agentic frameworks** — [OpenCode](https://github.com/nichochar/opencode), or really any kind of agentic experiment you'd want to run inside a pixel art interface (see [simile.ai](https://simile.ai/) for inspiration)
- **Marketplace release hardening** — release automation, publisher pipeline, and richer bridge status rendering
- **Provider telemetry parity** — deeper structured event parsing for Codex and Gemini if their CLIs expose stable machine-readable session signals

If any of these interest you, feel free to open an issue or submit a PR.

## Contributions

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for instructions on how to contribute to this project.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Release

To build and ship DigiSpace from the AllMyStack workspace:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\patch-pixel-agents.ps1 -Action publish -RefreshUpstream
```

Marketplace publication is handled by GitHub Actions when a `v*` tag is pushed and `VSCE_PAT` is configured in the fork repository secrets.

## Supporting the Project

If you find Pixel Agents useful, consider supporting its development:

<a href="https://github.com/sponsors/pablodelucca">
  <img src="https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>
<a href="https://ko-fi.com/pablodelucca">
  <img src="https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=ko-fi" alt="Ko-fi">
</a>

## License

This project is licensed under the [MIT License](LICENSE).
