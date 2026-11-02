---
name: kiro-migration-assistant
description: Move a developer from Claude Code, Cursor or Codex to Kiro. Migrates skills, slash commands, sub-agents, MCP servers, hooks and rules, imports past sessions into Kiro V3 sessions, and hands off a live session so it continues in Kiro. Use when the user mentions migrating, porting, importing or switching from Claude Code, Cursor or Codex, or wants to resume another agent's session in Kiro.
---

# Kiro Migration Assistant

Uses the `kiro-migration-assistant` MCP server. Its tools:

| Tool | Writes? | Use |
|------|---------|-----|
| `scan_sources` | no | What exists on this machine. Always first. |
| `migrate_config` | only with `dryRun:false` | Skills, commands, agents, MCP, hooks, rules. |
| `list_sessions` | no | Find sessions and their ids. |
| `import_sessions` | only with `dryRun:false` | Copy past sessions into Kiro. |
| `handoff_session` | yes | Continue a live session in Kiro now. |

If the tools are missing, tell the user to add the server to `~/.kiro/settings/mcp.json` (see the project README) and stop.

## Workflow: configuration

1. `scan_sources` with `workspace` set to the current project path. Report counts per source and kind in a short table.
2. Ask which sources and kinds to migrate, unless the user already said ("everything" is a valid answer).
3. `migrate_config` with those `sources`/`kinds`/`workspace` and the default dry run. Show:
   - items to `create`, items `unchanged`,
   - every `conflict` (target already exists with different content, or two sources map to the same name),
   - every warning, verbatim, grouped by item.
4. Get explicit approval. For conflicts ask per item: keep the existing Kiro file, or overwrite (`overwrite:true`, the old file is kept as `*.kma-backup-<ts>`). Use `names` to apply only approved items.
5. Re-run `migrate_config` with `dryRun:false` and the approved filters. Report what was written and where.
6. Tell the user to restart Kiro (or start a new session) so new MCP servers, agents and hooks load. Hooks run only in trusted workspaces.

## Workflow: past sessions

1. `list_sessions` (optionally `sources`, `cwd`). Show id, source, title, directory, last update.
2. Let the user pick ids, or confirm "all" (then `all:true` with a `limit`).
3. `import_sessions` dry run, then `dryRun:false` after approval.
4. Give each `resumeCommand`. Imported sessions also appear in `kiro-cli chat --v3 --resume-picker` from that directory.

## Workflow: live handoff

When the user says "continue my Claude Code / Cursor / Codex session here":

1. Call `handoff_session` with `source` and either the `sessionId` they give or `cwd` = the project path (takes the most recently active session there). This writes immediately; the user's request is the approval.
2. Return the `resumeCommand` and tell the user to close or pause the other agent first, so both do not edit the same files.
3. If status is `kept`, the session was already continued in Kiro: say so, and offer `fork:true` for a fresh copy of the latest source state.

## Rules

- Never call a writing tool with `dryRun:false` before the user approved that exact plan.
- Never set `overwrite:true` without per-item approval.
- Report every warning; they mark things that did not carry over (unmapped tools, unsupported hook events, `${VAR}` placeholders, `@file` imports, Cursor hook stdin format).
- Tool calls from imported sessions are text inside assistant turns. Kiro sees what happened but cannot replay those calls.
- Long sessions are trimmed to `maxChars` (default 400000), keeping the newest turns; `omittedTurns` says how many were dropped. Raise `maxChars` only if the user needs older context.
- Only Kiro V3 sessions are written (`~/.kiro/sessions/<bucket>/sess_*`). The older V2 store is not supported.

## What maps to what

| From | To Kiro |
|------|---------|
| `~/.claude/skills/*`, `.claude/skills/*`, `~/.cursor/skills/*`, `~/.codex/skills/*` | `skills/<name>/` (copied, front matter `name` fixed to the folder name) |
| Claude/Cursor commands, Codex prompts | `skills/<name>/SKILL.md` |
| `~/.claude/agents/*.md`, `.claude/agents/*.md` | `agents/<name>.md`; tools mapped (Read→read_file, Bash→execute_bash, …), model dropped |
| `~/.claude.json`, `.mcp.json`, `~/.cursor/mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml` | `settings/mcp.json` (merged) |
| Claude `settings.json` hooks, Cursor `hooks.json` | `hooks/<source>-<file>.json` (Kiro v1 hook file) |
| `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `~/.codex/AGENTS.md` | `steering/*.md` (`always` / `fileMatch` / `auto` / `manual`) |

User-scope items go to `~/.kiro/`, workspace-scope items to `<workspace>/.kiro/`.
