# Kiro Migration Assistant

MCP server and Kiro skill that move your setup and your conversations from Claude Code, Cursor and Codex CLI into Kiro.
It converts skills, commands, agents, MCP servers, hooks and rules, imports sessions into Kiro's V3 session store, and hands off a live session so you can continue it in Kiro.

## What It Does

- Finds Claude Code, Cursor and Codex configuration and sessions on your machine.
- Converts them to Kiro's formats, with a dry-run plan before anything is written.
- Imports all or selected sessions as Kiro V3 sessions you can resume.
- Hands off the session you are working in right now: run one command and keep going in Kiro.

## Features

| Feature | Description |
|---------|-------------|
| Skills | Copies skill folders (with scripts and assets) to `.kiro/skills/`, fixing front matter Kiro requires. |
| Commands → skills | Claude/Cursor slash commands and Codex prompts become Kiro skills. |
| Agents | Claude Code sub-agents become `.kiro/agents/*.md`, with tool names mapped to Kiro ids. |
| MCP servers | Merges servers from `~/.claude.json`, `.mcp.json`, `~/.cursor/mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml` into `.kiro/settings/mcp.json`. |
| Hooks | Claude `settings.json` hooks and Cursor `hooks.json` become Kiro v1 hook files. |
| Rules → steering | `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `~/.codex/AGENTS.md` become steering with matching inclusion modes. |
| Session import | Claude Code, Cursor IDE, Cursor Agent and Codex sessions → Kiro V3 sessions. |
| Live handoff | Imports the latest (or a given) session and returns `kiro-cli chat --v3 --resume-id …`. |
| Safe by default | Dry run by default, conflicts never overwritten unless asked, backups for every replaced file. |
| Idempotent | Re-running is a no-op; re-importing updates the same Kiro session until you continue it in Kiro. |

## How It Works

Each source has a small adapter that reads its files (JSONL transcripts, JSON/TOML config, Cursor's SQLite stores) into a tool-neutral model. Converters turn config items into Kiro files. A planner compares every target with what is already on disk and labels it `create`, `unchanged`, `conflict` or `overwrite`, and nothing is written until you approve.

Sessions are rewritten as Kiro V3 records (`session.json` + `messages.jsonl` under `~/.kiro/sessions/<workspace-hash>/`) and registered in Kiro's session index. Tool calls from the other agent become readable text in the assistant turns, because those tools do not exist in Kiro. Long sessions keep their newest turns within a character budget.

The bundled skill teaches a Kiro agent the workflow: scan, show the plan, ask, apply, verify. See [ARCHITECTURE.md](ARCHITECTURE.md).

## How to Use

Ask Kiro in plain language once the server and skill are installed (see Quick Start):

```text
> Migrate my Claude Code and Cursor setup to Kiro for this project.
> Import my last 10 Claude Code sessions.
> Continue my current Cursor Agent session here in Kiro.
```

Example handoff result:

```json
{
  "source": "claude-code",
  "id": "4f1c…",
  "kiroSessionId": "sess_8a3e…",
  "status": "created",
  "turns": 42,
  "omittedTurns": 0,
  "resumeCommand": "cd '/home/me/app' && kiro-cli chat --v3 --resume-id sess_8a3e…"
}
```

Tools exposed by the server:

| Tool | Writes | Purpose |
|------|--------|---------|
| `scan_sources` | no | Counts of migratable config and sessions per source |
| `migrate_config` | with `dryRun:false` | Plan or apply config migration |
| `list_sessions` | no | Sessions with ids, titles, directories |
| `import_sessions` | with `dryRun:false` | Import selected or newest sessions |
| `handoff_session` | yes | Import a live session and return the resume command |

## Quick Start

```bash
git clone https://github.com/<you>/kiro-migration-assistant.git
cd kiro-migration-assistant && npm ci
mkdir -p ~/.kiro/skills && cp -r skills/kiro-migration-assistant ~/.kiro/skills/
# add the server to ~/.kiro/settings/mcp.json (see DEPLOYMENT.md), then:
kiro-cli chat --v3
```

Full setup: [DEPLOYMENT.md](DEPLOYMENT.md).

## Test

```bash
npm test          # unit + MCP protocol tests against generated fixtures (no real data touched)
npm run test:e2e  # needs a logged-in kiro-cli: resumes an imported session and runs the skill
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): internals, data formats, mapping tables
- [DEPLOYMENT.md](DEPLOYMENT.md): install, configure, run
- [skills/kiro-migration-assistant/SKILL.md](skills/kiro-migration-assistant/SKILL.md): the agent workflow

Source-format knowledge for Cursor and Codex builds on [Agentlytics](https://github.com/f/agentlytics).

## License

MIT-0. See [LICENSE](LICENSE).

## About Author

Developed and maintained by Irshad Chohan.
