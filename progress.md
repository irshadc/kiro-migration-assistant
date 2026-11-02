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
