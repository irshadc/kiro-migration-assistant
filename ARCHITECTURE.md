# Kiro Migration Assistant Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      INTERFACE TIER                          │
│  ┌──────────────────────┐     ┌───────────────────────────┐  │
│  │ Kiro agent + SKILL.md│ ──▶ │ MCP stdio server          │  │
│  │ (kiro-cli --v3 / IDE)│     │ src/server.js, tools.js   │  │
│  └──────────────────────┘     └─────────────┬─────────────┘  │
└─────────────────────────────────────────────┼────────────────┘
┌─────────────────────────────────────────────┼────────────────┐
│                      COMPUTE TIER           ▼                │
│  ┌───────────────────────────┐   ┌─────────────────────────┐ │
│  │ config/migrate-config.js  │   │ sessions/import-sessions│ │
│  │ discover→convert→plan→    │   │ read→turns→budget→write │ │
│  │ apply (backups)           │   │ handoff                 │ │
│  └────────────┬──────────────┘   └───────────┬─────────────┘ │
│               │  sources/<tool>/{config,sessions}.js         │
└───────────────┼──────────────────────────────┼───────────────┘
┌───────────────┼──────────────────────────────┼───────────────┐
│               ▼          DATA TIER (local)   ▼               │
│  READ: ~/.claude, ~/.claude.json, ~/.cursor, Cursor          │
│        state.vscdb (SQLite), ~/.codex, <workspace>           │
│  WRITE: ~/.kiro/{skills,agents,hooks,steering,settings},     │
│         <ws>/.kiro/..., ~/.kiro/sessions, ~/.kiro/session-index│
└──────────────────────────────────────────────────────────────┘
```

## Three-Tier Architecture

| Tier | Layer | Components | Purpose |
|------|-------|------------|---------|
| 1 | Interface | `src/cli.js`, `src/install.js`, `src/server.js`, `src/tools.js`, `skills/kiro-migration-assistant/SKILL.md` | MCP tools with zod-validated input; skill that drives them |
| 2 | Business | `src/config/*`, `src/sessions/*` | Conversion, planning, conflict policy, session rewriting |
| 3 | Data | `src/sources/*`, `src/common/*` | Reading each tool's files and SQLite stores, atomic writes |

## Components

| Name | File | Runtime | Purpose | Trigger |
|------|------|---------|---------|---------|
| CLI entry | `src/cli.js` | Node ≥ 22.13 | npm bin: no args = MCP server; `install`, `tools`, `call <tool> <json>` | `npx`, Kiro `mcp.json` |
| Installer | `src/install.js` | Node | Adds the server to `~/.kiro/settings/mcp.json` (backup), copies the skill | `install` |
| MCP server | `src/server.js` | Node ≥ 22.13 | stdio transport, registers tools | CLI with no args; `node src/server.js` |
| Tool layer | `src/tools.js` | Node | Schemas, error envelope, no logic | MCP `tools/call`, CLI `call` |
| Config use case | `src/config/migrate-config.js` | Node | Discover, plan, apply, backup | `migrate_config`, `scan_sources` |
| Converters | `src/config/converters.js` | Node | Skill, command, agent, MCP, rule conversion (pure) | planner |
| Hook converter | `src/config/hooks.js` | Node | Claude/Cursor hooks → Kiro v1 hook file | planner |
| Tool names | `src/config/tool-names.js` | Node | Claude tool → Kiro tool id map | converters |
| Session use case | `src/sessions/import-sessions.js` | Node | List, import, handoff, overwrite policy | session tools |
| Transcript model | `src/sessions/transcript.js` | Node | Neutral messages → alternating turns, budget | session use case |
| V3 writer | `src/sessions/kiro-v3-writer.js` | Node | Bucket hash, ids, records, index | session use case |
| Claude Code | `src/sources/claude-code/*` | Node | Sessions JSONL, config | registry |
| Cursor | `src/sources/cursor/*` | Node + `node:sqlite` | IDE composer DB, agent store/transcripts, config | registry |
| Codex | `src/sources/codex/*` | Node | Rollout JSONL, `config.toml` subset parser | registry |
| Roots | `src/roots.js` | Node | All paths; env overrides | every adapter |

## Project Structure

```
kiro-migration-assistant/
├── src/
│   ├── cli.js, install.js              # npm bin: server, install, one-shot tool calls
│   ├── server.js, tools.js, roots.js   # interface + path resolution
│   ├── common/                         # files, front matter, sqlite helpers
│   ├── config/                         # config discovery, converters, planner
│   ├── sessions/                       # transcript model, V3 writer, import/handoff
│   └── sources/                        # claude-code/, cursor/, codex/, index.js registry
├── skills/kiro-migration-assistant/    # Kiro skill (SKILL.md)
├── test/                               # node:test unit, CLI + MCP protocol tests
│   ├── helpers/fixtures.js             # generated fake home (incl. SQLite DBs)
│   └── e2e/                            # opt-in tests against real kiro-cli
└── progress.md                         # build checklist and verified facts
```

## Event Flow

```mermaid
sequenceDiagram
  participant U as User
  participant K as Kiro agent (skill)
  participant M as MCP server
  participant FS as Disk
  U->>K: "move my Claude Code setup to Kiro"
  K->>M: scan_sources(workspace)
  M->>FS: read ~/.claude, ~/.cursor, ~/.codex
  K->>M: migrate_config(dryRun=true)
  M-->>K: plan (create / unchanged / conflict + warnings)
  K->>U: show plan, ask
  U->>K: approve
  K->>M: migrate_config(dryRun=false, names=…)
  M->>FS: write ~/.kiro/…, back up replaced files
  U->>K: "continue my Claude session here"
  K->>M: handoff_session(source, cwd)
  M->>FS: write ~/.kiro/sessions/<bucket>/sess_<id>
  M-->>K: resumeCommand
```

## Data Flow

Sessions: source file → adapter → `Message[]` `{role, text, toolCalls, toolResults, timestamp}` → `toTurns` (merge same role, fold tool results into the assistant turn, truncate tool I/O) → `fitBudget` (newest turns within `maxChars`) → provenance note on the first user turn, closing assistant turn if needed → V3 records.

### Kiro V3 session store (written)

| Path | Content |
|------|---------|
| `~/.kiro/sessions/<bucket>/sess_<uuid>/session.json` | `schemaVersion, dataModelVersion, id, title, agentMode, workspacePaths, rootPaths, createdAt, lastModifiedAt, status` |
| `~/.kiro/sessions/<bucket>/sess_<uuid>/messages.jsonl` | `{id, timestamp, payload}`; payload `user` / `turn_start` / `assistant (operationType: Say)` / `turn_end` |
| `~/.kiro/session-index/<bucket>.jsonl` | `{"op":"add","sessionPath":"<bucket>/<id>","at":<ms>}` |

`bucket` = first 16 hex chars of SHA-256 of the normalized workspace path (`_global` without one). `sess_<uuid>` is a v5-style UUID of `source:sourceSessionId`, so a re-import targets the same session. Records this tool writes have ids prefixed `kma-`; any other record means the user continued in Kiro, and the session is then left alone (or forked).

These formats were read from the kiro-cli 2.26.1 agent engine and checked by the e2e test.

### Sources (read)

| Source | Location | Format |
|--------|----------|--------|
| Claude Code | `~/.claude/projects/<encoded-cwd>/<id>.jsonl` | JSONL; `isSidechain`/`isMeta` skipped |
| Cursor IDE | `<Cursor>/User/globalStorage/state.vscdb` `cursorDiskKV` | `composerData:<id>`, `bubbleId:<id>:<bubble>`; folder from `workspaceStorage` |
| Cursor Agent | `~/.cursor/projects/<enc>/agent-transcripts/*.jsonl`, `~/.cursor/chats/<h>/<id>/store.db` | JSONL; content-addressed blob tree |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | `session_meta` + `response_item` |

### Config mapping

| Kind | Target | Notes |
|------|--------|-------|
| skill | `skills/<name>/` | folder copied; `name` forced to folder name; missing `description` derived |
| command | `skills/<name>/SKILL.md` | `$ARGUMENTS` note added; `allowed-tools` reported |
| agent | `agents/<name>.md` | `tools` mapped (absent → `*`); `model` dropped |
| mcp | `settings/mcp.json` | merged per scope; first source wins a name collision |
| hook | `hooks/<source>-<file>.json` | Claude events map 1:1 (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`); matchers mapped to Kiro tool ids |
| rule | `steering/<name>.md` | `.mdc`: `alwaysApply`→always, `globs`→fileMatch, description only→auto, else manual |

## Orchestration Pattern

| File | Wraps | Pattern |
|------|-------|---------|
| `skills/kiro-migration-assistant/SKILL.md` | all tools | Sequential: scan → dry run → approval → apply → verify |
| `src/config/migrate-config.js` | source config adapters + converters | Sequential plan, then apply |
| `src/sessions/import-sessions.js` | session adapters + writer | Sequential per session; per-item errors |

## MCP/Tool Integration

| Name | Server | Purpose | Auth |
|------|--------|---------|------|
| `scan_sources`, `migrate_config`, `list_sessions`, `import_sessions`, `handoff_session` | `kiro-migration-assistant` (stdio) | See README | Local process; user's own file permissions |

## Behavioral Notes

- Planning reads only. Applying writes temp files and renames them, so a crash never leaves a half-written file.
- Existing targets with different content are `conflict` unless `overwrite:true`; replaced files and `mcp.json` are renamed to `*.kma-backup-<ts>`.
- Large JSONL files are streamed line by line; listing parses only the newest `limit` sessions and only their first lines.
- SQLite is opened read-only through `node:sqlite`, so there is no native build and Cursor's databases are never modified.
- Malformed JSONL lines (for example a live writer mid-line) are skipped; malformed JSON config files raise an error that names the file.
- Sessions with no recorded folder go to the `_global` bucket unless `fallbackCwd` is given; Kiro lists sessions per folder, so `_global` ones are resumable only by id.
- Corrupt Cursor composer records are left out of listings and fail per item with a named error.
- Tool inputs are truncated to 600 chars and outputs to 1500 chars per call in imported transcripts.
- Names from disk are sanitized to `[a-z0-9_-]`, so no target path can escape the Kiro directories.
