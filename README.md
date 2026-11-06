# Kiro Migration Assistant

Kiro Migration Assistant (KMA) helps you move from Claude Code, Cursor, or Codex to Kiro without rebuilding your setup by hand. It finds each tool's skills, commands, agents, MCP servers, hooks, rules, and conversations, then compares them with what Kiro already has.

In guided mode, KMA asks about one source or item at a time. It copies only approved settings and imports chosen conversations as resumable Kiro V3 sessions.

Everything runs locally. KMA does not change or delete the source files, and it does not upload your settings or conversations.

## What It Does

- Copies skills, agents, commands, MCP servers, hooks, and rules into Kiro.
- Imports conversations so you can continue them with kiro-cli V3.
- Shows one item at a time and lets you copy, skip, keep, or replace it.
- Finds standard source folders and accepts a different folder when needed.
- Previews every change and backs up files you choose to replace.
- Runs through Kiro or directly from a terminal.

## Features

| Priority | Feature | What you can do |
|----------|---------|-----------------|
| 1 | Setup copy | Copy skills, agents, commands, MCP servers, hooks, and rules |
| 2 | Session import | Import selected or recent conversations as resumable Kiro V3 sessions |
| 3 | Live handoff | Continue one Claude Code, Cursor, or Codex session by ID or project folder |
| 4 | Guided migration | Review one source, setting, hook, or session at a time |
| 5 | CLI mode | Scan, preview, copy, or import without a Kiro agent |

Supported source matrix:

| Source | Skills | Commands or prompts | Agents | MCP servers | Hooks | Rules | Sessions |
|--------|--------|---------------------|--------|-------------|-------|-------|----------|
| Claude Code | Yes | Yes | Yes | Yes | Yes | User and project | Yes |
| Cursor | Yes | Yes | — | Yes | Yes | Project | IDE and Agent |
| Codex | Yes | Prompts | — | Yes | — | User | Yes |
| Kiro IDE | — | — | — | — | Yes | — | — |

Destination matrix:

| Source item | Kiro destination |
|-------------|------------------|
| Skills | `skills/<name>/`, including scripts and assets |
| Commands and Codex prompts | `skills/<name>/SKILL.md` |
| Claude Code sub-agents | `agents/<name>.md` |
| MCP server definitions | `settings/mcp.json` |
| Claude Code, Cursor, and Kiro IDE hooks | `hooks/<name>.json` for kiro-cli V3 |
| Source rules | `steering/<name>.md` |
| Conversations | Kiro V3 session store |

KMA preserves scope. User settings go to `~/.kiro/`; project settings go to `<project>/.kiro/`. Workspace Codex `AGENTS.md` files are not copied because Kiro already reads them.

## How It Works

KMA has two local parts. The Kiro skill controls the conversation and waits for your choices. The MCP server scans local files, prepares previews, and applies only approved changes.

`npx` downloads KMA from GitHub and caches the code on your computer. KMA has no hosted service and does not upload your settings or conversations. See [ARCHITECTURE.md](ARCHITECTURE.md#kiro-integration) for the internal flow.

## How to Use

### First-Time Setup Prompt

Paste this into Kiro:

```text
Install Kiro Migration Assistant for all my Kiro projects:
npx -y github:irshadc/kiro-migration-assistant install
Confirm the skill is in ~/.kiro/skills/kiro-migration-assistant/ and the MCP server is registered.
Load the installed skill and guide this project migration step by step:
1. Ask which source tool to use, then show what it contains.
2. Ask what to copy, one setting or session at a time.
3. Show the final plan before writing anything.
Apply only my approved choices, test the result, and report what was done.
```

The installed MCP server loads automatically in your next Kiro session.

### Guided Migration

Install KMA, start a new Kiro session, then type:

```text
kma
```

KMA will:

1. Show one source tool and the folder it scanned.
2. Ask whether to use, skip, or locate that source elsewhere.
3. Present one setting at a time.
4. Present one session at a time.
5. Show a short final plan and ask before writing.
6. Return a resume command for each imported session.

Type `stop reviewing` at any point to finish the current list.

### Short Prompts

| Task | Prompt |
|------|--------|
| Start the guided flow | `kma` |
| Show the complete inventory | `kma: preview all; change nothing` |
| Copy every new item quickly | `kma: migrate everything; keep existing Kiro files` |
| Use one source | `kma: migrate from Cursor only` |
| Review MCP servers | `kma: review my MCP servers` |
| Import recent sessions | `kma: review my 5 most recent sessions` |
| Use another folder | `kma: my Claude Code data is in /data/claude` |
| Continue by session ID | `kma: hand off Claude session <session-id>` |
| Continue the latest session | `kma: continue my latest Cursor session in this folder` |
| Convert Kiro IDE hooks | `kma: convert my Kiro IDE hooks for kiro-cli V3` |

Replace values inside `<…>` before sending a prompt.

### Automatic Setup

KMA requires Node.js 22.13 or newer. `npm` and `npx` come with Node.js.

```bash
node --version
npx --version
npx -y github:irshadc/kiro-migration-assistant install
```

The installer copies the skill and adds the MCP server to Kiro settings. Start a new Kiro session so the server loads.

### Manual Setup

1. Clone the project and install its packages:

```bash
git clone https://github.com/irshadc/kiro-migration-assistant.git
cd kiro-migration-assistant
npm ci
```

2. Copy the skill:

```bash
mkdir -p ~/.kiro/skills
cp -R skills/kiro-migration-assistant ~/.kiro/skills/
```

3. Add the server under `mcpServers` in `~/.kiro/settings/mcp.json`. Keep existing entries and use the clone's absolute path:

```json
{
  "mcpServers": {
    "kiro-migration-assistant": {
      "command": "node",
      "args": ["/absolute/path/to/kiro-migration-assistant/src/server.js"]
    }
  }
}
```

4. Start a new Kiro session and type `kma`.

### CLI Mode

Run the same MCP tools without an agent:

```bash
npx -y github:irshadc/kiro-migration-assistant call scan_sources '{"workspace":"/absolute/project/path"}'
npx -y github:irshadc/kiro-migration-assistant call list_sessions '{"limit":10}'
npx -y github:irshadc/kiro-migration-assistant call scan_sources '{"paths":{"claudeDir":"/data/claude"}}'
```

Writing tools preview by default. See [ARCHITECTURE.md](ARCHITECTURE.md#mcp-tools) for every tool.

## Quick Start

```bash
npx -y github:irshadc/kiro-migration-assistant install
cd my-project
kiro-cli chat --v3
```

Then type `kma`.

## Test

```bash
npm test
npm run test:e2e
```

See [ARCHITECTURE.md](ARCHITECTURE.md#testing-strategy) for coverage and isolation details.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): design, tools, data flow, and tests
- [DEPLOYMENT.md](DEPLOYMENT.md): requirements, setup, and verification
- [SKILL.md](skills/kiro-migration-assistant/SKILL.md): agent workflow

## License

MIT-0. See [LICENSE](LICENSE).

## About Author

Developed and maintained by Irshad Chohan.
