# Kiro Migration Assistant

Kiro Migration Assistant (KMA) helps you move from Claude Code, Cursor, or Codex to Kiro without rebuilding your setup by hand. It finds each tool's skills, commands, agents, MCP servers, hooks, rules, and conversations, then compares them with what Kiro already has.

In guided mode, KMA asks about one source or item at a time. It copies only approved settings and imports chosen conversations as resumable Kiro V3 sessions.

Everything runs locally. KMA does not change or delete the source files, and it does not upload your settings or conversations.

## What It Does

- Copies skills, agents, commands, MCP servers, hooks, and rules into Kiro.
- Imports conversations so you can continue them with kiro-cli V3.
- Shows one item at a time and lets you copy, skip, keep, rename, or replace it.
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
1. Ask which source tool to use, then show its global and project items.
2. Ask whether to copy global items, project items, or both.
3. Ask what to copy, one setting or session at a time.
4. Show the final plan before writing anything.
Apply only my approved choices, test the result, and report what was done.
```

### Guided Migration

Install KMA, start a new Kiro session, then type:

```text
kma
```

KMA will:

1. Show one source with its global and project folders, then ask whether to use it.
2. Ask whether to review global settings, this project's settings, or both.
3. Present one setting or session at a time and stop on every name conflict.
4. Show a short final plan and ask before writing.
5. Apply approved choices and return session resume commands.

Type `stop reviewing` at any point to finish the current list.

When the same name already exists in Kiro, KMA stops and asks you to keep the existing item, rename the incoming item, or replace the existing item with a backup. It never deletes an existing item.

### Short Prompts

| Task | Prompt |
|------|--------|
| Start the guided flow | `kma` |
| Show the complete inventory | `kma: preview all; change nothing` |
| Copy every new item quickly | `kma: migrate everything; keep existing Kiro files` |
| Use another folder | `kma: my Claude Code data is in /data/claude` |
| Continue by session ID | `kma: hand off Claude session <session-id>` |
| Continue the latest session | `kma: continue my latest Cursor session in this folder` |

## Quick Start

KMA requires Node.js 22.13 or newer. `npm` and `npx` come with Node.js.

```bash
node --version
npx -y github:irshadc/kiro-migration-assistant install
cd /absolute/path/to/your-project
kiro-cli chat --v3
```

Then type `kma`.

The installer copies the skill to global Kiro skills and registers the MCP server. `npx` runs and caches the package; it does not create a global `kma` shell command.

To start Kiro with the prompt already supplied, run this separately:

```bash
kiro-cli chat --v3 "kma"
```

## Manual Setup

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

4. Check that the local server lists five tools:

```bash
node src/cli.js tools
```

5. Check that Kiro scans sources without writing:

```bash
kiro-cli chat --v3 --no-interactive "kma: preview all; change nothing"
```

## CLI Mode

Run the same MCP tools without an agent:

```bash
npx -y github:irshadc/kiro-migration-assistant call scan_sources '{"workspace":"/absolute/project/path"}'
```

Writing tools preview by default. See [ARCHITECTURE.md](ARCHITECTURE.md#mcp-tools) for every tool.

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
