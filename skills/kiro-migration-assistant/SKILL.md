---
name: kiro-migration-assistant
description: Move a developer from Claude Code, Cursor or Codex to Kiro. Migrates skills, slash commands, sub-agents, MCP servers, hooks and rules, imports recent or selected past sessions into Kiro V3 sessions, and hands off a live session by id so it continues in Kiro. Use when the user mentions migrating, porting, importing or switching from Claude Code, Cursor or Codex, or wants to resume another agent's session in Kiro.
---

# Kiro Migration Assistant

Tools (from the `kiro-migration-assistant` MCP server):

| Tool | Writes? | Use |
|------|---------|-----|
| `scan_sources` | no | What exists on this machine. Always first. |
| `migrate_config` | only with `dryRun:false` | Skills, commands, agents, MCP servers, hooks, rules. |
| `list_sessions` | no | Find sessions and their ids. |
| `import_sessions` | only with `dryRun:false` | Copy past sessions into Kiro. |
| `handoff_session` | yes | Continue one session in Kiro now. |

## Step 0: make sure the tools are reachable

If the tools above are available as MCP tools, use them and skip this step.

Otherwise (first run, the server was just installed and this session has not loaded it):

1. Run in the shell: `npx -y github:irshadc/kiro-migration-assistant install`. It registers the server in `~/.kiro/settings/mcp.json` (backing up the old file) and copies this skill to `~/.kiro/skills/`. Asking for a migration is consent to this install.
2. For the rest of THIS session, run each tool from the shell instead:
   `npx -y github:irshadc/kiro-migration-assistant call <tool> '<json args>'`
   Example: `npx -y github:irshadc/kiro-migration-assistant call scan_sources '{"workspace":"/abs/project"}'`.
   It prints the same JSON the MCP tool returns. Unknown arguments are rejected, so use the names below exactly.
3. Tell the user that new Kiro sessions will have the tools natively.

Needs Node.js 22.13 or newer. If `node --version` is older, stop and say so.

## Workflow: full migration (settings + recent sessions)

Use when the user asks to "move everything" or pastes the README's full-migration prompt. Defaults: all sources, all kinds, the 5 newest sessions, workspace = the current project directory.

1. `scan_sources` with `workspace`. Show a short table: source × kind counts, plus newest session per source.
2. `migrate_config` with `workspace` (dry run). Show creates, unchanged, conflicts and warnings (see the configuration workflow).
3. `import_sessions` with `{"all":true,"limit":5,"fallbackCwd":"<workspace>"}` (dry run, no `source` = across all sources). Show title, source, folder and status per session.
4. Ask once for approval of both plans. Ask per conflict whether to overwrite.
5. Apply both with `dryRun:false` (same arguments, `overwrite`/`names` as approved).
6. Report: files written, sessions imported with their `resumeCommand`, every warning. Tell the user to start a new Kiro session so new MCP servers, agents and hooks load.

## Workflow: configuration only

1. `scan_sources` with `workspace` set to the current project path.
2. Ask which sources and kinds, unless the user said ("everything" is valid). Kinds: `skill`, `command`, `agent`, `mcp`, `hook`, `rule`. Sources: `claude-code`, `cursor`, `codex`.
3. `migrate_config` dry run with those `sources`/`kinds`/`workspace`. Show items to `create`, `unchanged`, every `conflict` (target exists with different content, or two sources map to one name) and every warning, verbatim.
4. Get explicit approval. Per conflict: keep the Kiro file, or `overwrite:true` (old file kept as `*.kma-backup-<ts>`). Use `names` to apply only approved items.
5. Re-run with `dryRun:false`. Report what was written and where.
6. Tell the user to start a new Kiro session. Hooks run only in trusted workspaces.

## Workflow: past sessions

1. `list_sessions` (optionally `sources`, `cwd`, `limit`). Show id, source, title, folder, last update.
2. User picks ids, or "newest N" (`all:true`, `limit:N`, optionally `source` or `cwd`).
3. `import_sessions` dry run, then `dryRun:false` after approval. Picking by id needs `source`.
4. Always pass `fallbackCwd` = the current project path. Some sessions (often Cursor Agent) record no folder; without it they land in Kiro's global bucket, which `kiro-cli --list-sessions` never shows (still resumable by id).
5. Give each `resumeCommand`. Imported sessions show in `kiro-cli chat --v3 --list-sessions` and `--resume-picker` run from their folder.

## Workflow: live handoff

When the user says "continue my Claude Code / Cursor / Codex session here", or gives a session id:

1. `handoff_session` with `source` and `sessionId` if given, else `cwd` = the project path (takes the most recent session there). Add `fallbackCwd` = project path. This writes immediately; the request is the approval.
2. If the source is unclear from the id, call `list_sessions` with a high `limit` and match the id.
3. Return the `resumeCommand`. Tell the user to stop the other agent first so both do not edit the same files.
4. Status `kept` means it was already continued in Kiro: say so and offer `fork:true` for a fresh copy.

## Rules

- Never call a writing tool with `dryRun:false` before the user approved that plan.
- Never set `overwrite:true` without per-item approval.
- Report every warning; they mark what did not carry over (unmapped tools, unsupported hook events, `${VAR}` placeholders, `@file` imports, Cursor hook stdin format).
- A per-session `status:"error"` (for example a corrupt Cursor chat) does not stop the batch; report it.
- Imported tool calls are text inside assistant turns. Kiro sees what happened but cannot replay them.
- Long sessions keep the newest turns within `maxChars` (default 400000); `omittedTurns` says how many were dropped.
- Only Kiro V3 sessions are written (`~/.kiro/sessions/<bucket>/sess_*`).

## What maps to what

| From | To Kiro |
|------|---------|
| `~/.claude/skills/*`, `.claude/skills/*`, `~/.cursor/skills/*`, `~/.codex/skills/*` | `skills/<name>/` (front matter `name` fixed to the folder name) |
| Claude/Cursor commands, Codex prompts | `skills/<name>/SKILL.md` |
| `~/.claude/agents/*.md`, `.claude/agents/*.md` | `agents/<name>.md`; tools mapped (Read→read_file, Bash→execute_bash, …), model dropped |
| `~/.claude.json`, `.mcp.json`, `~/.cursor/mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml` | `settings/mcp.json` (merged) |
| Claude `settings.json` hooks, Cursor `hooks.json` | `hooks/<source>-<file>.json` (Kiro v1 hook file) |
| `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `~/.codex/AGENTS.md` | `steering/*.md` (`always` / `fileMatch` / `auto` / `manual`) |

User-scope items go to `~/.kiro/`, workspace-scope items to `<workspace>/.kiro/`.
