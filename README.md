# Kiro Migration Assistant

Move your setup and your conversations from Claude Code, Cursor and Codex CLI into [Kiro](https://kiro.dev).
An MCP server plus a Kiro skill: paste one prompt into Kiro and it ports your skills, agents, MCP servers, hooks and rules, imports your recent sessions, and can pick up a live session by its id.

## What It Does

- Finds Claude Code, Cursor and Codex configuration and sessions on your machine.
- Converts them to Kiro's formats, showing a dry-run plan before anything is written.
- Imports the newest, all, or selected sessions as Kiro V3 sessions you can resume.
- Hands off a session you are working in right now, by id or by folder.

## Features

| Feature | Description |
|---------|-------------|
| Skills | Copies skill folders (with scripts and assets) to `.kiro/skills/`, fixing the front matter Kiro requires. |
| Commands → skills | Claude/Cursor slash commands and Codex prompts become Kiro skills. |
| Agents | Claude Code sub-agents become `.kiro/agents/*.md`, with tool names mapped to Kiro ids. |
| MCP servers | Merges servers from `~/.claude.json`, `.mcp.json`, `~/.cursor/mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml` into `.kiro/settings/mcp.json`. |
| Hooks | Claude `settings.json` hooks and Cursor `hooks.json` become Kiro v1 hook files. |
| Rules → steering | `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `~/.codex/AGENTS.md` become steering files. |
| Session import | Claude Code, Cursor IDE, Cursor Agent and Codex sessions become Kiro V3 sessions. |
| Live handoff | Imports one session and returns `kiro-cli chat --v3 --resume-id …`. |
| One-line install | `npx -y github:irshadc/kiro-migration-assist install` registers the server and skill. |
| CLI mode | `… call <tool> '<json>'` runs any tool without an MCP client. |
| Safe by default | Dry run first, existing files never overwritten unless asked, backups for every replaced file. |
| Idempotent | Re-running is a no-op; re-importing updates the same Kiro session until you continue it in Kiro. |

## How It Works

Each source has a small adapter that reads its files (JSONL transcripts, JSON/TOML config, Cursor's SQLite stores) into a tool-neutral model. Converters turn config items into Kiro files. A planner compares every target with what is on disk and labels it `create`, `unchanged`, `conflict` or `overwrite`; nothing is written until you approve.

Sessions are written as Kiro V3 records (`session.json` + `messages.jsonl` under `~/.kiro/sessions/<folder-hash>/`) and registered in Kiro's session index, so `kiro-cli chat --v3 --list-sessions` shows them in their project folder. Tool calls from the other agent become readable text in the assistant turns, because those tools do not exist in Kiro. Long sessions keep their newest turns.

The bundled skill teaches the Kiro agent the workflow: scan, show the plan, ask, apply, verify. Details in [ARCHITECTURE.md](ARCHITECTURE.md).

## How to Use

Open Kiro in the project you want to migrate (`cd my-project && kiro-cli chat --v3`) and paste a prompt. The first prompt installs everything; the others assume it ran once.

### Full migration (copy this)

```text
Install and run the Kiro Migration Assistant:
1. Run `npx -y github:irshadc/kiro-migration-assist install`.
2. Read ~/.kiro/skills/kiro-migration-assistant/SKILL.md and follow its "full migration" workflow for this project.
Migrate everything from Claude Code, Cursor and Codex: skills, commands, agents, MCP servers, hooks and rules,
plus my 5 most recent sessions. Show me the plan first, ask before overwriting anything, then apply it and
give me the resume command for each imported session.
```

### Templates

Replace the `<…>` parts.

| Goal | Prompt |
|------|--------|
| Preview only | `Use the kiro-migration-assistant skill to scan what I can migrate from Claude Code, Cursor and Codex. Change nothing.` |
| Config only | `Use the kiro-migration-assistant skill to migrate my <Claude Code / Cursor / Codex> <skills, agents, MCP servers, hooks, rules> to Kiro. Show the plan first.` |
| Recent sessions | `Use the kiro-migration-assistant skill to import my <10> most recent <Claude Code> sessions into Kiro.` |
| Sessions of one project | `Use the kiro-migration-assistant skill to import all my sessions from <absolute project path> into Kiro.` |
| Pick sessions | `Use the kiro-migration-assistant skill to list my last <20> sessions, then let me choose which to import.` |
| Resume by session id | `Use the kiro-migration-assistant skill to hand off <Claude Code> session <session-id> to Kiro and give me the resume command.` |
| Resume the latest here | `Use the kiro-migration-assistant skill to continue my most recent <Cursor Agent> session from this folder in Kiro.` |
| Fresh copy | `Re-import <Codex> session <session-id> into Kiro as a fork, I already continued the old copy.` |

Finding a session id: Claude Code uses the `.jsonl` file name under `~/.claude/projects/<project>/`, Codex the uuid at the end of `~/.codex/sessions/**/rollout-*.jsonl`. If you don't have it, use the "Pick sessions" prompt.

Example handoff result:

```json
{
  "source": "claude-code",
  "kiroSessionId": "sess_8a3e…",
  "status": "created",
  "turns": 42,
  "omittedTurns": 0,
  "resumeCommand": "cd '/home/me/app' && kiro-cli chat --v3 --resume-id sess_8a3e…"
}
```

### Tools

| Tool | Writes | Purpose |
|------|--------|---------|
| `scan_sources` | no | Counts of migratable config and sessions per source |
| `migrate_config` | with `dryRun:false` | Plan or apply config migration |
| `list_sessions` | no | Sessions with ids, titles, folders |
| `import_sessions` | with `dryRun:false` | Import selected ids, or the newest `limit` across all sources |
| `handoff_session` | yes | Import one session now and return the resume command |

### Without an agent

Every tool also runs from a terminal and prints JSON:

```bash
npx -y github:irshadc/kiro-migration-assist call list_sessions '{"limit":10}'
npx -y github:irshadc/kiro-migration-assist call import_sessions '{"all":true,"limit":5,"fallbackCwd":"'"$PWD"'","dryRun":false}'
npx -y github:irshadc/kiro-migration-assist call handoff_session '{"source":"claude-code","sessionId":"<id>"}'
```

## Quick Start

Needs Node.js 22.13+ and `kiro-cli` with the V3 engine.

```bash
npx -y github:irshadc/kiro-migration-assist install   # adds the MCP server + skill to ~/.kiro
cd my-project && kiro-cli chat --v3                    # then paste the full-migration prompt
```

From a clone and other options: [DEPLOYMENT.md](DEPLOYMENT.md).

## Test

```bash
npm test          # unit, CLI and MCP protocol tests against generated fixtures (no real data touched)
npm run test:e2e  # needs a logged-in kiro-cli: resumes an imported session and runs the skill
```

After a migration, `kiro-cli chat --v3 --list-sessions` in the project folder lists the imported sessions.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): internals, data formats, mapping tables
- [DEPLOYMENT.md](DEPLOYMENT.md): install, configure, run
- [skills/kiro-migration-assistant/SKILL.md](skills/kiro-migration-assistant/SKILL.md): the agent workflow

Source-format knowledge for Cursor and Codex builds on [Agentlytics](https://github.com/f/agentlytics).

## License

MIT-0. See [LICENSE](LICENSE).

## About Author

Developed and maintained by Irshad Chohan.
