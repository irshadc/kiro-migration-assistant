# Deployment — Kiro Migration Assistant

## Prerequisites

| Tool | Minimum | Check | Install |
|------|---------|-------|---------|
| Node.js | 22.13 | `node --version` | macOS: `brew install node`; Linux: `nvm install 22`; Windows: `winget install OpenJS.NodeJS.LTS` |
| npm and npx | Bundled with Node | `npm --version`; `npx --version` | Install Node.js |
| kiro-cli V3 | Tested with 2.26.1 | `kiro-cli --version` | [Kiro](https://kiro.dev) |
| Git | Any current version | `git --version` | Needed only for manual setup |

KMA needs read access to your source-tool folders and write access to `~/.kiro`. It uses no AWS resources and needs no cloud credentials.

## Environment Variables

KMA has no `.env` file and no required environment variables.

Optional source overrides:

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code directory |
| `KMA_CLAUDE_JSON` | `~/.claude.json` | Claude global settings |
| `KMA_CURSOR_DIR` | `~/.cursor` | Cursor directory |
| `KMA_CURSOR_USER_DIR` | OS-specific Cursor `User` folder | Cursor IDE database and workspace data |
| `CODEX_HOME` | `~/.codex` | Codex directory |
| `KMA_KIRO_DIR` | `~/.kiro` | Kiro destination |

You can also provide source folders during the guided flow. The skill passes them as `paths`: `claudeDir`, `claudeJson`, `cursorDir`, `cursorUserDir`, or `codexDir`. A per-call path overrides the environment variable for that call.

## Local Development

## Quick Setup

```bash
npx -y github:irshadc/kiro-migration-assistant install
```

The installer:

1. Copies the skill to `~/.kiro/skills/kiro-migration-assistant/`.
2. Adds the MCP server to `~/.kiro/settings/mcp.json`.
3. Backs up changed MCP settings as `mcp.json.kma-backup-<timestamp>`.
4. Leaves matching existing setup unchanged.

Start a new Kiro session so it loads the MCP server. `npx` runs and caches KMA; it does not install a global `kma` shell command. Inside Kiro, `kma` is the skill prompt.

## Manual Setup

1. Clone the project:

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

3. Merge this entry into `~/.kiro/settings/mcp.json`. Do not remove existing servers:

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

4. Check the local MCP server:

```bash
node src/cli.js tools
```

Expected result: five tools are listed.

5. Test the installed Kiro skill and MCP server in a new non-interactive session:

```bash
kiro-cli chat --v3 --no-interactive "kma: preview all; change nothing"
```

Expected result: KMA shows global and project source locations and writes nothing.

## Run Without Kiro

```bash
node src/cli.js tools
node src/cli.js call scan_sources '{"workspace":"/absolute/project/path"}'
node src/cli.js call list_sessions '{"limit":10}'
```

Running `node src/cli.js` with no arguments starts the stdio MCP server. It waits silently for an MCP client.

## Data Setup

No data setup is needed. Tests create isolated Claude, Cursor, Codex, and Kiro fixtures. Cursor fixtures include real SQLite databases.

## Deploy

There is no AWS deployment. Publish the repository to GitHub; users run it through `npx`.

Before publishing:

```bash
npm ci
npm test
npm run test:e2e
git status --short
```

## Monitoring & Verification

| Check | Expected result |
|-------|-----------------|
| `node src/cli.js tools` | Lists five MCP tools |
| `node src/cli.js call scan_sources '{}'` | Prints source paths and counts as JSON |
| `kiro-cli chat --v3 --no-interactive "kma: preview all; change nothing"` | Loads the skill and MCP server, shows sources, and writes nothing |
| `kiro-cli chat --v3 --list-sessions` | Shows imported sessions in their project folder |
| `/mcp` in kiro-cli | Shows `kiro-migration-assistant` connected |

For test scope and isolation guarantees, see [ARCHITECTURE.md](ARCHITECTURE.md#testing-strategy).
