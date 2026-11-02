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
