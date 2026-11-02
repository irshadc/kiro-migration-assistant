---
name: kiro-migration-assistant
description: Step-by-step guide that moves a developer from Claude Code, Cursor or Codex to Kiro. Detects which tools are installed, shows what Kiro already has, lets the user tick which skills, commands, agents, MCP servers, hooks, rules and sessions to bring over, then applies only those. Also converts Kiro IDE hooks for kiro-cli V3 and hands off a live session by id. Use when the user mentions migrating, porting, importing or switching from Claude Code, Cursor or Codex, or wants to resume another agent's session in Kiro.
---

# Kiro Migration Assistant

You are guiding the user one step at a time. At every step: show what you found, say what you suggest, and wait for their choice. Never move anything they did not pick.

Tools (from the `kiro-migration-assistant` MCP server):

| Tool | Writes? | Use |
|------|---------|-----|
| `scan_sources` | no | Which tools are installed, what each has, what Kiro already has. Always first. |
| `migrate_config` | only with `dryRun:false` | Skills, commands, agents, MCP servers, hooks, rules. |
| `list_sessions` | no | Sessions with ids, titles, folders. |
| `import_sessions` | only with `dryRun:false` | Copy past sessions into Kiro. |
| `handoff_session` | yes | Continue one session in Kiro now. |

## Step 0: check the setup

1. Run `node --version`. It must be v22.13 or newer (the tool reads Cursor's SQLite files with Node's built-in `node:sqlite`). `npx` comes with Node; check it with `npx --version`.
   If Node is missing or older, stop and tell the user how to install it, then wait:
   - macOS: `brew install node` (or `nvm install 22`)
   - Linux: `nvm install 22` (nvm: https://github.com/nvm-sh/nvm), or the NodeSource packages
   - Windows: `winget install OpenJS.NodeJS.LTS`
2. If the tools above are available as MCP tools, use them.
   Otherwise run `npx -y github:irshadc/kiro-migration-assistant install` (registers the server in `~/.kiro/settings/mcp.json`, backing up the old file, and copies this skill to `~/.kiro/skills/`). Then, for the rest of THIS session, run each tool from the shell:
   `npx -y github:irshadc/kiro-migration-assistant call <tool> '<json args>'`
   It prints the same JSON the MCP tool returns. Unknown arguments are rejected, so use the names below exactly. New Kiro sessions get the tools natively.
3. Use the current project folder as `workspace` (absolute path) in every call below.

## Workflow: guided migration (default)

Use this for any "migrate", "move", "port" or "switch" request, including the README prompt.

### Step 1: what is installed

Call `scan_sources`. Show one table:

| Tool | Installed | Skills | Commands | Agents | MCP servers | Hooks | Rules | Sessions |

Use `detected`, `config.<tool>` counts and `sessions.<source>.count` (Cursor has two session sources, `cursor` and `cursor-agent`; add them). `countIsAtLeast` means "N or more". Below it, one line on what Kiro already has (`kiro.user`, `kiro.workspace`: skills, agents, MCP servers, hooks, steering).

Ask which tools to migrate from. Suggest every installed tool. Skip tools that are not installed without asking.

### Step 2: pick the settings

Call `migrate_config` (dry run) with the chosen `sources` and `workspace`. Show every entry as a numbered checklist, grouped by kind (skills, commands, agents, MCP servers, hooks, rules):

| # | Name | From | In Kiro | Notes |

- From = `source` + `scope` (user = `~/.kiro`, workspace = this project's `.kiro`).
- In Kiro, from `status`:
  - `create`: "new"
  - `unchanged`: "already there, same" (nothing to do; do not offer it)
  - `conflict` with a "same target already planned" warning: "duplicate of #n" (two tools have the same name; only one can win)
  - `conflict` otherwise: "already there, different"
  - `skipped` / `error`: "can't move" and the reason
- Notes = the warnings, shortened. They say what will not carry over.

Then ask: "Which ones should I move? Reply with numbers (for example `1-4, 7`), `all new`, or `none`." For each "already there, different" item they pick, ask: keep Kiro's version, or replace it (the old file is kept as `*.kma-backup-<ts>`).

### Step 3: apply the settings

Call `migrate_config` with `dryRun:false`, `ids` = the `id` of every picked entry, and the same `sources`/`workspace`. Add `overwrite:true` only if the user chose "replace" for every picked "already there, different" item; otherwise leave those out of `ids` or make two calls (one with `overwrite:true` for the replace ids only). Report what was written, where, and every backup.

### Step 4: pick the sessions

Call `list_sessions` with the chosen tools' session sources (`claude-code`, `cursor`, `cursor-agent`, `codex`), `limit` 20, and `cwd` = workspace only if the user wants this project's sessions. Show a numbered list: title, tool, folder, last update. Suggest the 5 newest. Ask which to import (numbers, `newest 5`, or `none`).

Dry run first: `import_sessions` with `source` + `ids` (one call per tool) and `fallbackCwd` = workspace. Show title and status (`would-create`, `would-update`, `kept` = already continued in Kiro). After the user says yes, repeat with `dryRun:false`. Give every `resumeCommand`.

### Step 5: Kiro IDE hooks (only if `kiroUpgrade.ideHooks` > 0)

Kiro IDE stores hooks as `.kiro/hooks/*.kiro.hook`; kiro-cli V3 reads `.kiro/hooks/*.json`. Offer to convert them: `migrate_config` with `sources:["kiro"]`, same checklist and approval as Step 2, then apply as in Step 3. The `.kiro.hook` files stay for the IDE.

### Step 6: wrap up

- Summarize: settings moved, sessions imported (with resume commands), everything skipped and why.
- Tell the user to start a new Kiro session so new MCP servers, agents and hooks load. Hooks run only in trusted workspaces.
- `kiro-cli chat --v3 --list-sessions` in a project folder lists its imported sessions.

Shortcut: if the user asked for "everything" (the README's full-migration prompt), pre-tick all installed tools, all `new` items and the 5 newest sessions, show the checklists in one message, and ask once. Still ask per "already there, different" item.

## Workflow: live handoff

When the user says "continue my Claude Code / Cursor / Codex session here", or gives a session id:

1. `handoff_session` with `source` and `sessionId` if given, else `cwd` = the project path (takes the most recent session there). Add `fallbackCwd` = project path. This writes immediately; the request is the approval.
2. If the source is unclear from the id, call `list_sessions` with a high `limit` and match the id.
3. Return the `resumeCommand`. Tell the user to stop the other agent first so both do not edit the same files.
4. Status `kept` means it was already continued in Kiro: say so and offer `fork:true` for a fresh copy.

## Older Kiro data

- kiro-cli V2 sessions (`~/.kiro/sessions/cli`) need no migration: `kiro-cli chat --v3 --list-sessions` lists them and `--resume-id <id>` continues them in V3.
- kiro-cli V2 JSON agents (`~/.kiro/agents/*.json`) need no migration either: kiro-cli V3 upgrades them in place the first time they load and keeps the original as `<name>.json.bak`.
- Kiro IDE hooks: Step 5 above.

## Rules

- One step at a time. Never call a writing tool with `dryRun:false` before the user picked the items in that plan.
- Pass `ids` so only picked items are written. Never set `overwrite:true` without a per-item "replace".
- Report every warning; they mark what did not carry over (unmapped tools, unsupported hook events, `${VAR}` placeholders, `@file` imports, Cursor hook stdin format).
- Long checklists: show the first 30 rows per kind and offer the rest.
- A per-session `status:"error"` (for example a corrupt Cursor chat) does not stop the batch; report it.
- Imported tool calls are text inside assistant turns. Kiro sees what happened but cannot replay them.
- Long sessions keep the newest turns within `maxChars` (default 400000); `omittedTurns` says how many were dropped.
- Only kiro-cli V3 sessions are written (`~/.kiro/sessions/<bucket>/sess_*`).

## What maps to what

| From | To Kiro |
|------|---------|
| `~/.claude/skills/*`, `.claude/skills/*`, `~/.cursor/skills/*`, `~/.codex/skills/*` | `skills/<name>/` (front matter `name` fixed to the folder name) |
| Claude/Cursor commands, Codex prompts | `skills/<name>/SKILL.md` |
| `~/.claude/agents/*.md`, `.claude/agents/*.md` | `agents/<name>.md`; tools mapped (Read→read_file, Bash→execute_bash, …), model dropped |
| `~/.claude.json`, `.mcp.json`, `~/.cursor/mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml` | `settings/mcp.json` (merged) |
| Claude `settings.json` hooks, Cursor `hooks.json` | `hooks/<source>-<file>.json` (kiro-cli V3 hook file; its `"version": "v1"` is the file schema version) |
| Kiro IDE `.kiro/hooks/*.kiro.hook` | `hooks/<name>.json` (same V3 hook file) |
| `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `~/.codex/AGENTS.md` | `steering/*.md` (`always` / `fileMatch` / `auto` / `manual`) |

User-scope items go to `~/.kiro/`, workspace-scope items to `<workspace>/.kiro/`.
