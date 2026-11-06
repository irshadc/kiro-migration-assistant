# Deployment — Kiro Migration Assistant

## Prerequisites

- Tools:
  - Node.js 22.13 or newer (`node --version`); uses the built-in `node:sqlite`. Tested with Node 24.19.
    - macOS: `brew install node` (or `nvm install 22`)
    - Linux: `nvm install 22` ([nvm](https://github.com/nvm-sh/nvm)) or the NodeSource packages
    - Windows: `winget install OpenJS.NodeJS.LTS`
  - npm and npx, bundled with Node (`npx --version`). npx needs no setup: it fetches `github:irshadc/kiro-migration-assistant` on first use and caches it. Tested with npm 11.17.
  - kiro-cli with the V3 engine (`kiro-cli chat --v3`), logged in. Tested with kiro-cli 2.26.1. Needed only to resume sessions and for `npm run test:e2e`.
  - git, only for installing from a clone.
- Access: read access to your own `~/.claude`, `~/.cursor`, Cursor's app-data folder and `~/.codex`; write access to `~/.kiro`.
- AWS resources: none. Everything runs locally.

## Environment Variables

### .env

None. The server has no account-specific settings.

### Optional overrides (set in the MCP server's `env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code config dir (Claude's own variable) |
| `KMA_CLAUDE_JSON` | `~/.claude.json` | Claude Code global config file |
| `KMA_CURSOR_DIR` | `~/.cursor` | Cursor home dir |
| `KMA_CURSOR_USER_DIR` | `~/Library/Application Support/Cursor/User` (macOS), `%APPDATA%/Cursor/User` (Windows), `~/.config/Cursor/User` (Linux) | Cursor IDE user data |
| `CODEX_HOME` | `~/.codex` | Codex home (Codex's own variable) |
| `KMA_KIRO_DIR` | `~/.kiro` | Kiro target dir |

Without a variable, you can tell Kiro the folder during the guided flow. The skill then passes it to every tool as `paths` (`claudeDir`, `claudeJson`, `cursorDir`, `cursorUserDir`, `codexDir`). In CLI mode, add it to the JSON arguments, for example `'{"paths":{"claudeDir":"/data/claude"}}'`. A `paths` value takes precedence over the variable for that call.

## Local Development

### Install from GitHub (users)

```bash
npx -y github:irshadc/kiro-migration-assistant install
```

This adds the entry below to `~/.kiro/settings/mcp.json` (the old file is kept as `mcp.json.kma-backup-<ts>`) and copies the skill to `~/.kiro/skills/kiro-migration-assistant/`. Re-running changes nothing.

```json
{
  "mcpServers": {
    "kiro-migration-assistant": { "command": "npx", "args": ["-y", "github:irshadc/kiro-migration-assistant"] }
  }
}
```

### Install from a clone (development)

```bash
git clone https://github.com/irshadc/kiro-migration-assistant.git
cd kiro-migration-assistant
npm ci
```

Register with Kiro by adding this to `~/.kiro/settings/mcp.json` (use your absolute path):

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

Install the skill:

```bash
mkdir -p ~/.kiro/skills
cp -r skills/kiro-migration-assistant ~/.kiro/skills/
```

Run:

```bash
kiro-cli chat --v3
> Use the kiro-migration-assistant skill to scan what I can migrate.
```

Verify: the agent calls `scan_sources` and reports counts per source. Running the server by hand (`node src/cli.js`) waits silently on stdin; that is expected for a stdio MCP server.

Run a tool without an MCP client:

```bash
node src/cli.js tools                                   # names + descriptions
node src/cli.js call scan_sources '{"workspace":"'"$PWD"'"}'
```

## Data Setup

No seed data. Tests build their own fixture home under the OS temp dir (`test/helpers/fixtures.js`).

## Deploy

Nothing to deploy to AWS. Publishing is pushing to GitHub; users install with `npx -y github:irshadc/kiro-migration-assistant`, which installs the dependencies from `package.json`.

```bash
npm test
git push origin main
```

To publish on npm as well (optional): `npm publish --access public`, then the `mcp.json` entry can use `"args": ["-y", "kiro-migration-assistant"]`.

## Monitoring & Verification

- `npm test`: unit tests, CLI tests (install, `call`) and an MCP protocol test that spawns the server over stdio.
- `npm run test:e2e`: imports a fixture Claude Code session into the real `~/.kiro`, resumes it with `kiro-cli chat --v3 --resume-id`, checks the model recalls it, then runs a Kiro agent that uses the skill and server. The test removes the sessions it wrote.
- Kiro's MCP status (`/mcp` in kiro-cli) shows whether the server started.
