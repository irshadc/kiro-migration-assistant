---
name: kiro-migration-assistant
description: Kiro Migration Assistant, short name "kma". Copies selected skills, commands, agents, MCP servers, hooks, rules and sessions from Claude Code, Cursor or Codex into Kiro. Guides the user through one decision at a time, supports custom source folders, converts Kiro IDE hooks for kiro-cli V3, and hands off a session by ID. Use when the user says "kma", asks to migrate or switch to Kiro, or wants to continue another coding agent's session in Kiro.
---

# Kiro Migration Assistant (KMA)

Guide the user through one decision per turn. After asking, stop and wait for the answer.

A decision is one source, one custom path, one setting, one hook, one session, or one final approval. Never combine decisions. Never print the complete inventory unless the user asks for `preview all`.

## Tools

| Tool | Writes | Use |
|------|--------|-----|
| `scan_sources` | Never | Find source tools, scanned folders, counts, and current Kiro items |
| `migrate_config` | Only with `dryRun:false` | Preview or copy settings |
| `list_sessions` | Never | Find source sessions |
| `import_sessions` | Only with `dryRun:false` | Preview or import selected sessions |
| `handoff_session` | Immediately | Import one session and return its resume command |

Every tool accepts an optional `paths` object for non-default source folders.

## Request Modes

Choose the mode from the user's words:

| Request | Mode |
|---------|------|
| `kma`, migrate, move, port, or switch | Guided mode |
| `kma: preview all` | Full read-only inventory |
| `kma: migrate everything` | Fast mode with one combined plan and one approval |
| A specific task, such as review MCP servers | Guided mode limited to that task |
| Continue or hand off a session | Live handoff |

Do not silently turn guided mode into fast mode.

## Setup

1. Check `node --version`; Node.js 22.13 or newer is required. `npx` comes with Node.js.
2. If the MCP tools are loaded, use them.
3. Otherwise run `npx -y github:irshadc/kiro-migration-assistant install`. In the current session, call tools with:

```bash
npx -y github:irshadc/kiro-migration-assistant call <tool> '<json args>'
```

4. Use the current project's absolute path as `workspace` in every applicable call.

If Node.js is missing or too old, give the matching command and stop:

| System | Command |
|--------|---------|
| macOS | `brew install node` or `nvm install 22` |
| Linux | `nvm install 22` |
| Windows | `winget install OpenJS.NodeJS.LTS` |

## Guided Mode

After asking, stop and wait for the answer. Never process the next decision in the same turn.

Keep the selected sources, custom `paths`, selected item IDs, replacement choices, and selected session IDs in the conversation until the final approvals.

### 1. Review sources

Call `scan_sources` once. Review sources in this order: Claude Code, Cursor, Codex.

For one source only, show:

- Source name.
- Installed or not found.
- Exact folders scanned and whether each exists.
- Short counts: settings and sessions.
- Recommendation: use or skip.

Ask only: use this source, use another folder, or skip it? Then stop.

If the user gives another folder, call `scan_sources` with the matching `paths` key and show that same source again. Ask whether to use it. Pass the accepted `paths` to every later call.

Repeat until each source has been reviewed. Do not ask again about a skipped or still-missing source.

Path keys: `claudeDir`, `claudeJson`, `cursorDir`, `cursorUserDir`, and `codexDir`. Paths must be absolute or begin with `~/`.

### 2. Review settings

Call `migrate_config` with `dryRun:true`, the selected `sources`, `workspace`, and accepted `paths`. Keep the returned entries as a queue in this order:

1. Skills
2. Agents
3. MCP servers
4. Commands
5. Rules
6. Hooks

Do not display the queue.

Skip `unchanged` entries without asking. Keep their count for the final summary. Keep `error` and `skipped` entries for the final summary unless the user can fix the problem by choosing a path.

For one actionable entry only, show:

- Kind and name.
- Source and scope.
- Status in Kiro.
- One short warning when information will not carry over.
- Recommendation.

Ask one question:

| Status | Choices |
|--------|---------|
| `create` | Copy or skip |
| Existing different file | Keep Kiro's version or replace it |
| Duplicate target | Choose the named source or skip both |

Then stop. Continue with the next entry after the answer. Let `stop reviewing` end the queue.

### 3. Approve and copy settings

After the queue ends, show only:

- Number selected by kind.
- Number skipped.
- Files that will be replaced.

Ask: apply these setting changes, review again, or cancel? Then stop.

After approval, call `migrate_config` with `dryRun:false` and only the selected `ids`. Use `overwrite:true` only for IDs the user explicitly chose to replace. Make a separate call for replacement IDs when needed.

Report written files and backups briefly.

### 4. Review sessions

Call `list_sessions` for the selected session sources with `limit:20`. Use `cwd:workspace` only when the user asked for this project's sessions.

Present one session only:

- Title.
- Source.
- Project folder.
- Last update.
- Recommendation, including whether it looks like background work or a failed session.

Ask: import, skip, or stop reviewing sessions? Then stop.

Continue one session at a time. When review ends, call `import_sessions` with `dryRun:true` for only the selected IDs. Report errors before asking: import these sessions or cancel? Then stop.

After approval, repeat with `dryRun:false` and return every `resumeCommand`.

### 5. Review Kiro IDE hooks

Run this step only when `scan_sources.kiroUpgrade.ideHooks` is greater than zero.

Ask whether to review Kiro IDE hooks for conversion. Then stop. If accepted, call `migrate_config` with `sources:["kiro"]` and `dryRun:true`.

Review one hook at a time using the same rules as settings. Warn when the same hook exists at user and workspace scope because both may run. Get one final approval before applying selected hook IDs.

The original `.kiro.hook` files remain unchanged.

### 6. Finish

Report:

- Settings copied by kind.
- Sessions imported with resume commands.
- Replacements and backup paths.
- Skipped or unsupported items and why.

Tell the user to start a new Kiro session so new MCP servers, agents, and hooks load. Run `kiro-cli chat --v3 --list-sessions` from a project folder to see its imported sessions.

## Full Preview Mode

For `kma: preview all`, call the read-only tools and show the complete source, settings, hook, and session inventories. Make no writing calls. Full tables are allowed only in this mode.

## Fast Mode

For an explicit `kma: migrate everything` request:

1. Scan all installed sources.
2. Dry-run all settings and the five newest sessions.
3. Preselect new items only. Keep existing Kiro files.
4. Show one combined plan.
5. Ask once before writing.
6. Apply only after approval.

Ask separately about every replacement. Existing tool arguments and safety rules remain unchanged.

## Live Handoff

When the user asks to continue one session:

1. Call `handoff_session` with `source` and `sessionId`, or with `cwd` to use the latest session in that folder. Add `fallbackCwd` for sessions without a recorded folder.
2. If the source is unclear, call `list_sessions` and match the ID first.
3. Return the `resumeCommand` and tell the user to stop the other agent before both edit the same files.
4. If the status is `kept`, explain that Kiro already continued it and offer `fork:true` for a fresh copy.

The handoff request itself approves this immediate write.

## Older Kiro Data

- kiro-cli V2 sessions need no migration. V3 lists and resumes them.
- kiro-cli V2 JSON agents need no migration. V3 upgrades them and keeps a `.json.bak` copy.
- Kiro IDE hooks use Guided Mode step 5.

## Safety Rules

- Guided mode asks exactly one decision per turn.
- Never write before the final approval for that group.
- Apply only selected `ids`.
- Never use `overwrite:true` without explicit approval for each replacement.
- Report every conversion warning in the item review or final summary.
- Preserve accepted custom `paths` in every later call.
- A corrupt session does not stop other imports.
- Imported tool calls become text; Kiro does not replay them.
- Long sessions keep the newest turns within `maxChars` and report `omittedTurns`.
- Write sessions only in kiro-cli V3 format.
