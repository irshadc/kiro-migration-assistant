# Kiro Migration Assistant Architecture

## System Overview

```
┌───────────────────────────────────────────────────────────┐
│ INTERFACE                                                 │
│ User prompt → Kiro agent → KMA skill → MCP/CLI tool call │
└──────────────────────────────┬────────────────────────────┘
                               │ stdio
┌──────────────────────────────▼────────────────────────────┐
│ COMPUTE                                                   │
│ MCP schemas → source adapters → planner/converters        │
│                                  → session importer       │
└──────────────────────────────┬────────────────────────────┘
                               │ local files only
┌──────────────────────────────▼────────────────────────────┐
│ DATA                                                      │
│ Read: ~/.claude, ~/.cursor, ~/.codex, project settings    │
│ Write: ~/.kiro, <project>/.kiro, Kiro V3 session store    │
└───────────────────────────────────────────────────────────┘
```

## Three-Tier Architecture

| Tier | Layer | Components | Purpose |
|------|-------|------------|---------|
| 1 | Interface | `src/cli.js`, `src/server.js`, `src/tools.js`, `SKILL.md` | Validate requests and guide the user |
| 2 | Business | `src/config/`, `src/sessions/` | Plan, convert, import, and apply |
| 3 | Data | `src/sources/`, `src/common/`, `src/roots.js` | Read source formats and write local files |

## Kiro Integration

KMA contains a skill and an MCP server. Both run locally.

| Part | Installed location | Job |
|------|--------------------|-----|
| Skill | `~/.kiro/skills/kiro-migration-assistant/` | Tells Kiro how to scan, present choices, wait, and apply |
| MCP server | Registered in `~/.kiro/settings/mcp.json` | Provides five tools over stdio |

With automatic setup, Kiro starts the server through:

```json
{
  "command": "npx",
  "args": ["-y", "github:irshadc/kiro-migration-assistant"]
}
```

`npx` gets the code from GitHub and caches it. Source settings and sessions stay on the local computer. KMA has no remote API and sends no migrated data to GitHub.

A newly added MCP server loads in the next Kiro session. During initial setup, the skill can call the same tools with `npx … call <tool>`.

```mermaid
sequenceDiagram
    participant U as User
    participant K as Kiro
    participant S as KMA skill
    participant M as Local MCP server
    participant F as Local files
    U->>K: kma
    K->>S: Read guided workflow
    K->>M: scan_sources
    M->>F: Read source folders and Kiro inventory
    M-->>K: Paths, counts, and statuses
    K-->>U: Show choices and wait
    U->>K: Select items
    K->>M: Dry run, then approved apply
    M->>F: Write selected Kiro files
    M-->>K: Results and resume commands
```

## Components

| Name | File | Purpose | Trigger |
|------|------|---------|---------|
| CLI | `src/cli.js` | Start server, install, list tools, or call one tool | `npx`, `node` |
| Installer | `src/install.js` | Copy skill and merge MCP config | `install` |
| MCP server | `src/server.js` | Open stdio transport | Kiro or CLI |
| Tool definitions | `src/tools.js` | Zod schemas and result envelopes | MCP call |
| Root resolver | `src/roots.js` | Defaults, environment overrides, per-call paths | Every tool |
| Config planner | `src/config/migrate-config.js` | Discover, compare, filter, and apply | Config tools |
| Converters | `src/config/converters.js`, `src/config/hooks.js`, `src/config/kiro-legacy.js` | Convert settings to Kiro formats | Planner |
| Kiro inventory | `src/config/kiro-inventory.js` | List existing Kiro items | Scan |
| Session importer | `src/sessions/import-sessions.js` | List, import, and hand off sessions | Session tools |
| Transcript converter | `src/sessions/transcript.js` | Build valid alternating turns and limit size | Importer |
| V3 writer | `src/sessions/kiro-v3-writer.js` | Write sessions and index entries | Importer |
| Source adapters | `src/sources/` | Read Claude Code, Cursor, Codex, and Kiro IDE data | Scan/import |

## Project Structure

```
kiro-migration-assistant/
├── src/
│   ├── cli.js, install.js, server.js, tools.js
│   ├── roots.js
│   ├── common/
│   ├── config/
│   ├── sessions/
│   └── sources/
│       ├── claude-code/
│       ├── cursor/
│       ├── codex/
│       └── kiro/
├── skills/kiro-migration-assistant/SKILL.md
├── test/
│   ├── helpers/fixtures.js
│   └── e2e/kiro-cli.test.js
├── README.md
├── DEPLOYMENT.md
└── package.json
```

## Event Flow

```mermaid
flowchart LR
    A[Scan sources] --> B[Review one source]
    B -->|Use, custom path, or skip| B
    B --> C[Preview settings]
    C --> D[Review one setting]
    D -->|Copy, keep, replace, or skip| D
    D --> E[Approve settings]
    E --> F[Review one session]
    F -->|Import, skip, or stop| F
    F --> G[Approve session imports]
    G --> H[Resume commands]
```

The loops represent separate user turns. Full tables appear only in explicit preview-all mode.

## Data Flow

Config flow:

```text
Local source files → adapter → neutral item → converter → plan → selected Kiro file
```

Session flow:

```text
JSONL/SQLite → Message[] → alternating turns → size limit → Kiro V3 records → session index
```

| Source | Main data |
|--------|-----------|
| Claude Code | `~/.claude`, `~/.claude.json`, project files |
| Cursor | `~/.cursor`, Cursor `User` folder, SQLite stores, project files |
| Codex | `~/.codex`, rollout JSONL, `config.toml` |
| Kiro IDE | `.kiro/hooks/*.kiro.hook` |

Every source tool supports a per-call `paths` override. `scan_sources` returns the actual path and whether it exists. A source override never changes the Kiro destination.

Source scope is preserved. User items go to `~/.kiro/`; workspace items go to `<workspace>/.kiro/`. Claude Code supports both scopes. Cursor rules are workspace-scoped. Codex `~/.codex/AGENTS.md` is user-scoped; a workspace `AGENTS.md` stays in place because Kiro already reads it.

Kiro V3 sessions use:

| Path | Content |
|------|---------|
| `~/.kiro/sessions/<bucket>/sess_<uuid>/session.json` | Session metadata |
| `~/.kiro/sessions/<bucket>/sess_<uuid>/messages.jsonl` | User and assistant turns |
| `~/.kiro/session-index/<bucket>.jsonl` | Session registration |

## Orchestration Pattern

| File | Pattern |
|------|---------|
| `skills/kiro-migration-assistant/SKILL.md` | Guided: one decision per turn; preview-all: read-only inventory; fast: one combined plan |
| `src/config/migrate-config.js` | Sequential plan and apply |
| `src/sessions/import-sessions.js` | Sequential import with per-session errors |

## MCP Tools

| Tool | Writes | Purpose |
|------|--------|---------|
| `scan_sources` | No | Show source paths, counts, and current Kiro items |
| `migrate_config` | Only with `dryRun:false` | Plan or apply selected settings |
| `list_sessions` | No | List source sessions |
| `import_sessions` | Only with `dryRun:false` | Import selected or recent sessions |
| `handoff_session` | Yes | Import one session and return a resume command |

Every tool accepts `paths`. Writing tools validate names, keep unrelated files, and back up replaced files.

## Testing Strategy

The test suite has two levels. Unit and protocol tests use an isolated generated home. End-to-end tests use the real kiro-cli but clean up the sessions they create.

Current verified state: 64 unit/protocol tests and 6 integration tests pass. The project does not yet collect line or branch coverage percentages, enforce a coverage threshold, or run tests in GitHub Actions. Coverage here means tested behavior, not a measured percentage.

### Unit and Protocol Tests

Run:

```bash
npm test
```

This runs 64 tests with Node's built-in test runner.

| Test file | Coverage |
|-----------|----------|
| `test/parsing.test.js` | Front matter, TOML, tool-name mapping, safe target names |
| `test/sources.test.js` | Claude JSONL, Cursor Agent, Cursor IDE SQLite, Codex JSONL, missing sources |
| `test/migrate-config.test.js` | Every config kind, dry run, apply, conflicts, backups, idempotency, scope |
| `test/import-sessions.test.js` | Listing, import, handoff, forks, limits, corrupt rows, fallback folders |
| `test/kiro-v3-writer.test.js` | Folder hash, stable IDs, V3 files, index records, turn validation |
| `test/kiro-upgrade.test.js` | Kiro IDE hook conversion, item IDs, inventory, default behavior |
| `test/source-paths.test.js` | Reported scan paths, custom paths, `~/` expansion, invalid paths |
| `test/skill-flow.test.js` | One-decision guided flow, explicit bulk modes, README feature order and length |
| `test/cli.test.js` | Installer, idempotency, CLI calls, invalid input |
| `test/mcp-server.test.js` | Real MCP client/server exchange over stdio and error envelopes |

Fixtures create realistic source trees and Cursor SQLite databases. They test reads and writes without touching the user's real settings or sessions.

### Integration Tests

Run only on a machine with a logged-in kiro-cli:

```bash
npm run test:e2e
```

The six integration tests in `test/e2e/kiro-cli.test.js` verify:

| Scenario | Proof |
|----------|-------|
| Resume imported history | Kiro answers from a converted Claude session |
| Skill and MCP handoff | A Kiro agent uses the skill and server, then returns a resume command |
| Session visibility | Imported sessions appear in `kiro-cli --v3 --list-sessions` |
| Guided migration | A Kiro agent migrates config and five sessions from generated sources |
| `kma` default flow | The first turn asks about one source and writes nothing |
| `kma` and custom folder | The short prompt scans relocated Claude data, prints that path, and writes nothing in preview mode |

The tests create a unique fixture project and session bucket. Cleanup removes that bucket and its index. A before/after check should show no unrelated change in `~/.kiro`.

### Release Checks

```bash
npm ci
npm test
npm run test:e2e
git diff --check
git status --short
```

A release is ready when both suites pass, docs match the current tool schemas, and only intended files are committed.

## Behavioral Notes

- Planning is read-only.
- Applying uses atomic file replacement.
- Existing different files remain conflicts until `overwrite:true`.
- Every replaced file gets a timestamped backup.
- SQLite opens read-only.
- Large JSONL files stream line by line.
- Imported tool calls become readable text; Kiro does not replay them.
- Long sessions keep the newest turns within `maxChars`.
- Sessions without a source folder use `fallbackCwd` or the global bucket.
- kiro-cli V2 sessions already resume in V3 and are not copied.
- Kiro V2 JSON agents are upgraded by kiro-cli and are not copied.
