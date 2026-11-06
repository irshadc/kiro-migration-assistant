# Kiro Migration Assistant — Progress

Goal: public MCP server + Kiro skill that migrates Claude Code / Cursor / Codex
config and sessions into Kiro (V3 session store only).

## Verified facts (from kiro-cli 2.26.1 KAS bundle + live probes)
- V3 session dir: `~/.kiro/sessions/<sha256(normalizedCwd)[:16]>/sess_<uuid>/{session.json,messages.jsonl}`; no cwd -> bucket `_global`.
- Index: `~/.kiro/session-index/<bucket>.jsonl` line `{"op":"add","sessionPath":"<bucket>/<id>","at":<ms>}`.
- Hand-written session with `user`/`assistant`/`tool_call`/`tool_result` records resumes via `kiro-cli chat --v3 --resume-id <id>` and the model recalls it (probe passed).
- Skills: `~/.kiro/skills/<name>/SKILL.md`; name must equal dir name.
- Agents: `~/.kiro/agents/*.md` frontmatter (name, description, tools string|list, model, mcpServers) + prompt body.
- Hooks: `~/.kiro/hooks/*.json` = `{version:"v1",hooks:[{name,trigger,matcher?,action:{type:command|agent},timeout?}]}`.
- MCP: `~/.kiro/settings/mcp.json` + `<ws>/.kiro/settings/mcp.json` (`mcpServers`, command/args/env/url/headers/type/disabled).
- Steering: `.kiro/steering/*.md`, frontmatter `inclusion: always|fileMatch|manual|auto`, `fileMatchPattern`.

## Decisions
- Node ESM, deps: `@modelcontextprotocol/sdk` + `zod` only; SQLite via built-in `node:sqlite` (no native build).
- Foreign tool calls rendered as text in assistant turns (foreign tool names are not in Kiro's toolset).
- Deterministic Kiro session id (uuid v5 of source+id) -> idempotent re-import; refuse refresh once Kiro has continued the session.
- Every write tool defaults to `dryRun: true`.
- Large sessions: char budget keeps the newest turns, notes the omitted count.

## Checklist
- [x] Scaffold package, common helpers
- [x] Source adapters: claude-code, cursor (IDE + agent CLI), codex
- [x] Config converters: skills, commands->skills, agents, MCP, hooks, rules->steering
- [x] V3 session writer + import/handoff
- [x] MCP server tools
- [x] Skill `skills/kiro-migration-assistant/SKILL.md`
- [x] Unit tests (node:test) + MCP protocol test
- [x] E2E: kiro-cli --v3 resumes an imported Claude fixture session
- [x] README / ARCHITECTURE / DEPLOYMENT / LICENSE, git init

## v0.2.0 — publishable via GitHub
- [x] Verified with real kiro-cli: imported sessions appear in `--list-sessions` per folder; `_global` (no-cwd) sessions are resumable by id but never listed; `--all-cwds` lists V2 only (kiro-cli limit)
- [x] `fallbackCwd` on import/handoff so folder-less sessions land in the project folder
- [x] Corrupt Cursor composer rows skipped in listing; named per-item error on read
- [x] `import_sessions` all=true without `source` = newest N across every source
- [x] CLI `src/cli.js`: MCP server (no args), `install`, `tools`, `call <tool> <json>`
- [x] `install` registers `npx -y github:irshadc/kiro-migration-assistant` in `~/.kiro/settings/mcp.json` (backup) + copies skill
- [x] Skill: Step 0 bootstrap (install + shell `call` in the same session), full-migration workflow
- [x] README copy-paste full-migration prompt + templates (by id, latest, recent N, per project, preview, fork)
- [x] Tests: 51 unit/CLI/protocol; 4 e2e (resume, handoff via skill, list visibility, full migration via skill)
- [x] npx from packed tarball: `install` and stdio `tools/list` verified
- [ ] Push to github.com/irshadc/kiro-migration-assistant (user)
- [ ] After push: run the README prompt on a machine with real Claude/Cursor/Codex data

## v0.3.0: guided migration + Kiro IDE hooks (2026-11-02)
- [x] Skill rewritten as step-by-step guided flow: detect tools -> pick tools -> numbered checklist (new / already there / different / duplicate) -> apply picked `ids` -> pick sessions -> import -> wrap up. Live-handoff workflow unchanged.
- [x] README prompt reads SKILL.md from GitHub raw (clone fallback); Requirements table (Node 22.13+, npx bundled, kiro-cli 2.26.1 tested).
- [x] `migrate_config` `ids` param + per-entry `id` (`source/kind/scope/name`); `names` still works.
- [x] `scan_sources`: `detected`, per-source session `count` (cap 500), `kiro` inventory, `kiroUpgrade.ideHooks`.
- [x] Opt-in config source `kiro`: Kiro IDE `*.kiro.hook` -> V3 `hooks/<name>.json` (not in defaults, so existing calls unchanged).
- [x] Verified with kiro-cli 2.26.1: V3 lists + resumes V2 sessions by id (HERON-58 probe) and upgrades V2 JSON agents in place (`.json.bak`, allowedTools -> permissions). So no V2 session/agent migrator was shipped (built, then removed).
- [ ] Converted hook files match the V3 schema read from the bundle, but no hook (converted or hand-written) fired in headless `--no-interactive` runs, so runtime firing is unverified.
- [x] 57 unit/CLI/protocol tests, 4 e2e tests against real kiro-cli pass.

## v0.4.0: README overview, kma shortcut, source folders (2026-11-06)
- [x] README: "What It Does" now lists what it copies, `kma:` prompts per task, and the three ways to run it (guided prompt, short prompts/templates, CLI) before the technical Features table. Templates use `kma:`.
- [x] README "How It Works" + ARCHITECTURE "Kiro Integration": skill + local stdio MCP server; GitHub only supplies code via npx; data stays local; first-session CLI fallback.
- [x] `kma` short name in the skill description and body; plain `kma` runs the guided migration.
- [x] `scan_sources` returns `locations` (folders read + exists). Skill step 1 shows "Reading from", asks about tools not found, and offers a different path.
- [x] Every tool accepts optional `paths` (`claudeDir`, `claudeJson`, `cursorDir`, `cursorUserDir`, `codexDir`; absolute or `~/`); Kiro target unchanged. Env vars still work.
- [x] Tests: 60 unit (3 new in test/source-paths.test.js), 5 e2e (new: `kma:` prompt with a relocated Claude folder).

## Documentation rewrite: manual setup and testing (2026-11-06)
- [x] Rewrote README in plain language (177 lines): capabilities, short prompts, automatic setup, manual skill + MCP setup, CLI mode.
- [x] Rewrote DEPLOYMENT.md (125 lines): requirements, source paths, automatic/manual setup, verification.
- [x] Simplified ARCHITECTURE.md and added a testing strategy: 60 unit/protocol tests, 5 real kiro-cli integration tests, coverage map, isolation, release checks, and current gaps (no percentage threshold or CI).
- [x] Verified: 60/60 unit and protocol tests; 5/5 integration tests; no added real Kiro session buckets/indexes; `git diff --check` clean.

## v0.5.0: one-decision flow and product copy (2026-11-06)
- [x] Default `kma` flow reviews one source, setting, hook, or session per turn; full tables require `kma: preview all`.
- [x] Kept the existing fast path as explicit `kma: migrate everything`; MCP tool names and schemas are unchanged.
- [x] Rewrote README around setup copy, session import, live handoff, guided migration, and CLI mode.
- [x] Added source capability and Kiro destination matrices, including user vs project scope behavior.
- [x] First-time prompt installs the skill globally, starts the guided flow, applies approved choices, and tests the result.
- [x] Added copy/workflow contract tests and a real kiro-cli first-turn test.
- [x] Verified: 64/64 unit and protocol tests; 6/6 integration tests; README 199 lines; `git diff --check` clean.

## v0.6.0: global/project scope and safe conflict rename (2026-11-06)
- [x] `scan_sources` keeps flat paths/counts and adds `locationsByScope` plus `configByScope` for exact global (`user`) and current-project (`workspace`) discoveries.
- [x] `migrate_config` adds optional `scopes` and per-item `renames`; existing calls still scan both scopes and keep original names.
- [x] Same-name targets remain conflicts. Guided mode offers keep existing, rename incoming, or explicitly replace with backup; KMA never deletes existing items.
- [x] Guided mode asks global, current project, or both as a separate decision before item review.
- [x] README now has one Quick Start, one Manual Setup with two verification commands, and one CLI section. It explains that `kma` is a Kiro prompt, not a global shell command.
- [x] Verified: 67/67 unit and protocol tests; 7/7 real kiro-cli integration tests; README 199 lines; `git diff --check` clean.
