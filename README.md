# Kiro Migration Assistant

Move your setup and your conversations from Claude Code, Cursor and Codex CLI into [Kiro](https://kiro.dev).
An MCP server plus a Kiro skill: paste one prompt into Kiro and it walks you through the move step by step. It shows what each tool has and what Kiro already has, you pick what comes over, and it can pick up a live session by its id.

## What It Does

What it copies into Kiro:

- Skills, with their scripts and assets.
- Slash commands and Codex prompts, as Kiro skills.
- Agents (Claude Code sub-agents).
- MCP servers.
- Hooks, including Kiro IDE `.kiro.hook` files.
- Rules (`CLAUDE.md`, `.cursorrules`, Cursor rules, Codex `AGENTS.md`), as steering.
- Sessions, as kiro-cli V3 sessions you can resume, one at a time, the newest few, or all.

What you can ask for, once it is installed. `kma` is the short name, so a prompt can start with it:

| You want to | Type this in Kiro |
|-------------|-------------------|
| Move everything, step by step | `kma` |
| See what can move, change nothing | `kma: preview` |
| Move from one tool only | `kma: migrate from Cursor only` |
| Move one kind of setting | `kma: list my MCP servers and let me pick` |
| Bring over recent sessions | `kma: import my last 5 sessions` |
| Continue a session from another tool | `kma: hand off claude session <session-id>` |
| Read a tool from another folder | `kma: my Claude Code config is in /data/claude` |

Ways to run it:

- Guided prompt: paste the [guided migration](#guided-migration-copy-this) prompt once. It installs everything and walks you through the move.
- Short prompts: after that, use `kma: …` prompts like the ones above, or the longer [templates](#templates). Templates are ready-made prompts for common tasks; copy one and fill in the `<…>` parts.
- CLI mode: run any tool from a terminal with no agent: `npx -y github:irshadc/kiro-migration-assistant call <tool> '<json>'`. See [Without an agent](#without-an-agent).

## Features

| Feature | Description |
|---------|-------------|
| Guided steps | Detect, pick settings, apply, pick sessions, apply, wrap up. The agent waits for your choice at each step. |
| Already-in-Kiro check | Every item is labelled new, already there (same), already there (different), or duplicate. |
| Source folders | Shows the folder each tool is read from and whether it exists; `paths` reads a tool from any other folder. |
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

It plugs into Kiro in two parts, and both run on your machine:

| Part | What it is | Where it lives |
|------|------------|----------------|
| Skill | `SKILL.md`, the step-by-step guide. It tells the Kiro agent which tool to call and when to stop and wait for your pick. | `~/.kiro/skills/kiro-migration-assistant/` |
| MCP server | A local Node process that Kiro starts. It reads the other tools' files and writes the Kiro files. | Registered in `~/.kiro/settings/mcp.json` as `npx -y github:irshadc/kiro-migration-assistant` |

GitHub only supplies the code. `npx` downloads the package from GitHub, caches it, and runs it on your machine. Your config and sessions are read and written locally and are never uploaded. Kiro loads a new MCP server only when a session starts, so on the very first run the skill calls the same tools from the shell (`npx … call <tool>`) instead.

It looks for each tool in its default folder (`~/.claude`, `~/.cursor`, `~/.codex`) and shows you those paths in the first step. If a tool is somewhere else, tell Kiro the folder and every tool call reads from there (the `paths` argument). Environment variables also work; see [DEPLOYMENT.md](DEPLOYMENT.md#optional-overrides-set-in-the-mcp-servers-env).

Inside the server, each source has an adapter that reads its files into one neutral format. Converters turn that into Kiro files, and a planner marks every target `create`, `unchanged`, `conflict` or `overwrite` before anything is written. Sessions become kiro-cli V3 records that `kiro-cli chat --v3 --list-sessions` shows in their project folder. Full details are in [ARCHITECTURE.md](ARCHITECTURE.md#kiro-integration).

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

1. A table of installed tools with their counts, the folder each is read from (found or not found), and what Kiro already has. You choose which tools to migrate from, and can give a different folder for any tool.
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

Templates are ready-made prompts for one task each. Once the first prompt has run, the skill is installed and they work in any Kiro session. Start with `kma:` (the skill's short name), and replace the `<…>` parts.

| Goal | Prompt |
|------|--------|
| Preview only | `kma: show what I can migrate and what Kiro already has. Change nothing.` |
| One tool | `kma: migrate from <Claude Code / Cursor / Codex> only, step by step.` |
| One kind | `kma: list my <MCP servers / skills / agents / hooks / rules> and let me pick which to move.` |
| Another folder | `kma: my <Claude Code> data is in <absolute path>, migrate from there.` |
| Pick sessions | `kma: list my last <20> sessions, then let me choose which to import.` |
| Sessions of one project | `kma: list my sessions from <absolute project path> and let me pick.` |
| Resume by session id | `kma: hand off <Claude Code> session <session-id> to Kiro and give me the resume command.` |
| Resume the latest here | `kma: continue my most recent <Cursor Agent> session from this folder in Kiro.` |
| Fresh copy | `kma: re-import <Codex> session <session-id> as a fork, I already continued the old copy.` |
| Kiro IDE hooks | `kma: convert my Kiro IDE hooks for kiro-cli V3.` |

Finding a session id: Claude Code uses the `.jsonl` file name under `~/.claude/projects/<project>/`, Codex the uuid at the end of `~/.codex/sessions/**/rollout-*.jsonl`. If you don't have it, use the "Pick sessions" prompt. A handoff returns the Kiro session id and a `resumeCommand` such as `cd '/home/me/app' && kiro-cli chat --v3 --resume-id sess_8a3e…`.

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

Every tool also accepts `paths` (`claudeDir`, `claudeJson`, `cursorDir`, `cursorUserDir`, `codexDir`) to read a tool from a non-default folder.

### Without an agent

Every tool also runs from a terminal and prints JSON:

```bash
npx -y github:irshadc/kiro-migration-assistant call scan_sources '{"workspace":"'"$PWD"'"}'
npx -y github:irshadc/kiro-migration-assistant call list_sessions '{"limit":10}'
npx -y github:irshadc/kiro-migration-assistant call import_sessions '{"all":true,"limit":5,"fallbackCwd":"'"$PWD"'","dryRun":false}'
npx -y github:irshadc/kiro-migration-assistant call handoff_session '{"source":"claude-code","sessionId":"<id>"}'
npx -y github:irshadc/kiro-migration-assistant call scan_sources '{"paths":{"claudeDir":"/data/claude"}}'
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
