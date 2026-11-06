# Kiro Migration Assistant

Kiro Migration Assistant (KMA) moves developer settings and sessions from Claude Code, Cursor, and Codex into Kiro. It combines a Kiro skill with a local MCP server and guides you through each choice before writing anything.

## What It Does

- Finds supported tools and shows the folders it scanned.
- Shows what can be moved and what Kiro already has.
- Lets you choose sources, items, and sessions.
- Imports sessions in kiro-cli V3 format.
- Hands off one active session by ID or project folder.
- Reads from a different source folder when you provide one.
- Keeps existing Kiro files unless you approve replacement.

## Features

| Feature | What KMA moves or does |
|---------|------------------------|
| Skills | Skill folders, scripts, and assets |
| Commands | Claude and Cursor commands, plus Codex prompts, converted to Kiro skills |
| Agents | Claude Code sub-agents converted to Kiro agents |
| MCP servers | MCP definitions merged into Kiro settings |
| Hooks | Claude, Cursor, and Kiro IDE hooks converted to kiro-cli V3 hook files |
| Rules | `CLAUDE.md`, Cursor rules, and Codex `AGENTS.md` converted to Kiro steering |
| Sessions | Selected or recent sessions imported as resumable kiro-cli V3 sessions |
| Live handoff | One session imported immediately with a resume command |
| Guided choices | Every item shown as new, same, different, or duplicate |
| Safe writes | Dry run first; replaced files are backed up |
| Custom folders | Shows default source paths and accepts another path |
| CLI mode | Runs every MCP tool directly from a terminal |

## How It Works

KMA has two local parts:

| Part | Purpose |
|------|---------|
| Kiro skill | Teaches Kiro the guided migration steps and provides the short name `kma` |
| MCP server | Reads local source files and writes selected Kiro files |

`npx` downloads the project code from GitHub and caches it locally. KMA does not upload your settings or sessions. The MCP server runs on your computer through stdio.

Kiro loads newly registered MCP servers when a session starts. During the first session, the skill can run the same tools through CLI mode. See [ARCHITECTURE.md](ARCHITECTURE.md#kiro-integration) for the full flow.

## How to Use

## Guided Setup

Open Kiro and paste:

```text
Set up Kiro Migration Assistant from:
https://github.com/irshadc/kiro-migration-assistant

Read its skill and run the guided migration for this project.
Show which tools you found, every folder you scanned, and what Kiro already has.
Ask me what to copy. Change nothing until I choose.
```

Kiro will:

1. Check Node.js and install KMA.
2. Show Claude Code, Cursor, and Codex source folders.
3. Ask for another folder when a tool is not found.
4. List settings and sessions that can move.
5. Wait for your choices.
6. Apply only approved items and return session resume commands.

## Short Prompts

After setup, use `kma` as the skill's short name:

| Task | Prompt |
|------|--------|
| Start guided migration | `kma` |
| Preview only | `kma: preview; change nothing` |
| Use one source | `kma: migrate from Cursor only` |
| Pick MCP servers | `kma: list my MCP servers and let me choose` |
| Import recent sessions | `kma: import my last 5 sessions` |
| Use another folder | `kma: my Claude Code data is in /data/claude` |
| Resume by ID | `kma: hand off Claude session <session-id>` |
| Resume latest session | `kma: continue my latest Cursor session from this folder` |
| Convert Kiro IDE hooks | `kma: convert my Kiro IDE hooks for kiro-cli V3` |

These prompts are templates: copy one, replace values inside `<…>`, and send it to Kiro.

## Automatic Setup

Requirements: Node.js 22.13 or newer, with `npm` and `npx` included.

```bash
node --version
npx --version
npx -y github:irshadc/kiro-migration-assistant install
```

The installer copies the skill and safely merges the MCP entry. Start a new Kiro session, then run `kma`.

## Manual Setup

Use this when you want to review every setup step.

1. Clone and install dependencies:

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

3. Add this server inside `mcpServers` in `~/.kiro/settings/mcp.json`. Keep any existing entries and replace the example path with the clone's absolute path:

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

4. Start a new Kiro session and verify it:

```text
kma: preview; change nothing
```

Kiro should show the source folders it scanned and what it found.

## CLI Mode

Run tools without a Kiro agent:

```bash
npx -y github:irshadc/kiro-migration-assistant call scan_sources '{"workspace":"/absolute/project/path"}'
npx -y github:irshadc/kiro-migration-assistant call list_sessions '{"limit":10}'
npx -y github:irshadc/kiro-migration-assistant call scan_sources '{"paths":{"claudeDir":"/data/claude"}}'
```

Writing tools use a dry run by default. See [ARCHITECTURE.md](ARCHITECTURE.md#mcp-tools) for tool behavior.

## Quick Start

```bash
npx -y github:irshadc/kiro-migration-assistant install
cd my-project
kiro-cli chat --v3
```

Then type `kma`.

## Test

Testing design, coverage, and commands are documented in [ARCHITECTURE.md](ARCHITECTURE.md#testing-strategy).

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): design, data flow, tools, and testing
- [DEPLOYMENT.md](DEPLOYMENT.md): requirements, setup, paths, and verification
- [SKILL.md](skills/kiro-migration-assistant/SKILL.md): guided agent workflow

## License

MIT-0. See [LICENSE](LICENSE).

## About Author

Developed and maintained by Irshad Chohan.
