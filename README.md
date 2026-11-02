# Kiro Migration Assistant

Move your setup and your conversations from Claude Code, Cursor and Codex CLI into [Kiro](https://kiro.dev).
An MCP server plus a Kiro skill: paste one prompt into Kiro and it walks you through the move step by step. It shows what each tool has and what Kiro already has, you pick what comes over, and it can pick up a live session by its id.

## What It Does

- Detects which of Claude Code, Cursor and Codex are installed, and what Kiro already has.
- Lists every skill, command, agent, MCP server, hook, rule and session it could move, marked new, already in Kiro, or different.
- Moves only what you tick, after a dry-run plan; nothing is overwritten unless you say so.
- Imports the sessions you pick as kiro-cli V3 sessions you can resume.
- Hands off a session you are working in right now, by id or by folder.
- Converts Kiro IDE hooks (`.kiro.hook`) to the hook files kiro-cli V3 reads.

## Features

| Feature | Description |
|---------|-------------|
| Guided steps | Detect, pick settings, apply, pick sessions, apply, wrap up. The agent waits for your choice at each step. |
| Already-in-Kiro check | Every item is labelled new, already there (same), already there (different), or duplicate. |
| Skills | Copies skill folders (with scripts and assets) to `.kiro/skills/`, fixing the front matter Kiro requires. |
| Commands → skills | Claude/Cursor slash commands and Codex prompts become Kiro skills. |
| Agents | Claude Code sub-agents become `.kiro/agents/*.md`, with tool names mapped to Kiro ids. |
| MCP servers | Merges servers from `~/.claude.json`, `.mcp.json`, `~/.cursor/mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml` into `.kiro/settings/mcp.json`. |
| Hooks | Claude `settings.json` hooks, Cursor `hooks.json` and Kiro IDE `*.kiro.hook` become kiro-cli V3 hook files (`.kiro/hooks/*.json`). |
| Rules → steering | `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `~/.codex/AGENTS.md` become steering files. |
| Session import | Claude Code, Cursor IDE, Cursor Agent and Codex sessions become kiro-cli V3 sessions. |
| Live handoff | Imports one session and returns `kiro-cli chat --v3 --resume-id …`. |
| One-line install | `npx -y github:irshadc/kiro-migration-assistant install` registers the server and skill. |
| CLI mode | `… call <tool> '<json>'` runs any tool without an MCP client. |
| Safe by default | Dry run first, only picked items written, backups for every replaced file. |
| Idempotent | Re-running is a no-op; re-importing updates the same Kiro session until you continue it in Kiro. |

## How It Works

Each source has a small adapter that reads its files (JSONL transcripts, JSON/TOML config, Cursor's SQLite stores) into a tool-neutral model. Converters turn config items into Kiro files. A planner compares every target with what is on disk and labels it `create`, `unchanged`, `conflict` or `overwrite`, and gives each item a stable `id` so exactly the items you picked are written.

Sessions are written as kiro-cli V3 records (`session.json` + `messages.jsonl` under `~/.kiro/sessions/<folder-hash>/`) and registered in Kiro's session index, so `kiro-cli chat --v3 --list-sessions` shows them in their project folder. Tool calls from the other agent become readable text in the assistant turns, because those tools do not exist in Kiro. Long sessions keep their newest turns.

The bundled skill teaches the Kiro agent the guided steps. Details in [ARCHITECTURE.md](ARCHITECTURE.md).

## Requirements

| Tool | Version | Check | Install |
|------|---------|-------|---------|
| Node.js (includes `npm` and `npx`) | 22.13 or newer | `node --version`, `npx --version` | macOS: `brew install node` · Linux: `nvm install 22` ([nvm](https://github.com/nvm-sh/nvm)) · Windows: `winget install OpenJS.NodeJS.LTS` |
| kiro-cli with the V3 engine | tested with 2.26.1 | `kiro-cli --version` | [kiro.dev](https://kiro.dev) |
| git | any | `git --version` | only needed for the clone fallback |

`npx` needs no setup of its own: it ships with Node and downloads this package from GitHub the first time it runs. Node 22.13 is the minimum because Cursor's SQLite files are read with Node's built-in `node:sqlite`. Tested with Node 24.19 and npm 11.17.

## How to Use

Open Kiro in the project you want to migrate (`cd my-project && kiro-cli chat --v3`) and paste a prompt.

### Guided migration (copy this)

```text
Set up and run the Kiro Migration Assistant, step by step:
1. Read its guide at https://raw.githubusercontent.com/irshadc/kiro-migration-assistant/main/skills/kiro-migration-assistant/SKILL.md
   If you can't fetch it, git clone https://github.com/irshadc/kiro-migration-assistant.git into a temp folder
   and read skills/kiro-migration-assistant/SKILL.md there.
2. Follow its "guided migration" workflow for this project. Show me which of Claude Code, Cursor and Codex
   are installed and what Kiro already has, then let me pick which skills, commands, agents, MCP servers,
   hooks, rules and sessions to move. Change nothing until I have picked.
```

Kiro checks Node, installs the server with `npx`, and then takes you through the steps:

1. A table of installed tools with their counts, plus what Kiro already has. You choose which tools to migrate from.
2. A numbered checklist of settings, each marked new, already there (same or different), or duplicate. You reply with numbers, `all new` or `none`, and decide keep or replace for each "different" item.
3. Kiro writes only the picked items and lists every file and backup.
4. A numbered list of recent sessions. You pick which to import (suggested: the 5 newest).
5. If you used Kiro IDE, an offer to convert its `.kiro.hook` files for kiro-cli V3.
6. A summary with a resume command for every imported session.

### Move everything at once

```text
Read https://raw.githubusercontent.com/irshadc/kiro-migration-assistant/main/skills/kiro-migration-assistant/SKILL.md
and follow its guided migration workflow for this project. I want everything: all installed tools, every new item,
and my 5 most recent sessions. Show me the full list once, keep Kiro's version of anything already there,
then apply it and give me the resume command for each imported session.
```

### Templates

Once the first prompt has run, the skill is installed and these work in any Kiro session. Replace the `<…>` parts.

| Goal | Prompt |
|------|--------|
| Preview only | `Use the kiro-migration-assistant skill to show what I can migrate and what Kiro already has. Change nothing.` |
| One tool | `Use the kiro-migration-assistant skill to migrate from <Claude Code / Cursor / Codex> only, step by step.` |
| One kind | `Use the kiro-migration-assistant skill to list my <MCP servers / skills / agents / hooks / rules> and let me pick which to move.` |
| Pick sessions | `Use the kiro-migration-assistant skill to list my last <20> sessions, then let me choose which to import.` |
| Sessions of one project | `Use the kiro-migration-assistant skill to list my sessions from <absolute project path> and let me pick.` |
| Resume by session id | `Use the kiro-migration-assistant skill to hand off <Claude Code> session <session-id> to Kiro and give me the resume command.` |
| Resume the latest here | `Use the kiro-migration-assistant skill to continue my most recent <Cursor Agent> session from this folder in Kiro.` |
| Fresh copy | `Re-import <Codex> session <session-id> into Kiro as a fork, I already continued the old copy.` |
| Kiro IDE hooks | `Use the kiro-migration-assistant skill to convert my Kiro IDE hooks for kiro-cli V3.` |

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

### Coming from an older kiro-cli or Kiro IDE

| What | What to do |
|------|------------|
| kiro-cli V2 sessions (`~/.kiro/sessions/cli`) | Nothing. `kiro-cli chat --v3 --list-sessions` lists them and `--resume-id <id>` continues them in V3. |
| kiro-cli V2 JSON agents (`~/.kiro/agents/*.json`) | Nothing. kiro-cli V3 upgrades each one in place the first time it loads, and keeps the original as `<name>.json.bak`. |
| Kiro IDE hooks (`.kiro/hooks/*.kiro.hook`) | Use the "Kiro IDE hooks" prompt. The `.kiro.hook` files stay for the IDE. |

### Tools

| Tool | Writes | Purpose |
|------|--------|---------|
| `scan_sources` | no | Installed tools, config and session counts, what Kiro already has |
| `migrate_config` | with `dryRun:false` | Plan or apply config migration; `ids` applies only picked items |
| `list_sessions` | no | Sessions with ids, titles, folders |
| `import_sessions` | with `dryRun:false` | Import selected ids, or the newest `limit` across all sources |
| `handoff_session` | yes | Import one session now and return the resume command |

### Without an agent

Every tool also runs from a terminal and prints JSON:

```bash
npx -y github:irshadc/kiro-migration-assistant call scan_sources '{"workspace":"'"$PWD"'"}'
npx -y github:irshadc/kiro-migration-assistant call list_sessions '{"limit":10}'
npx -y github:irshadc/kiro-migration-assistant call import_sessions '{"all":true,"limit":5,"fallbackCwd":"'"$PWD"'","dryRun":false}'
npx -y github:irshadc/kiro-migration-assistant call handoff_session '{"source":"claude-code","sessionId":"<id>"}'
```

## Quick Start

```bash
node --version                                           # v22.13 or newer
npx -y github:irshadc/kiro-migration-assistant install   # adds the MCP server + skill to ~/.kiro
cd my-project && kiro-cli chat --v3                      # then paste the guided-migration prompt
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
- [skills/kiro-migration-assistant/SKILL.md](skills/kiro-migration-assistant/SKILL.md): the guided agent workflow

Source-format knowledge for Cursor and Codex builds on [Agentlytics](https://github.com/f/agentlytics).

## License

MIT-0. See [LICENSE](LICENSE).

## About Author

Developed and maintained by Irshad Chohan.
