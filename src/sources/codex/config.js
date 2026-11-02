// Codex CLI configuration (user scope only; Kiro already reads workspace AGENTS.md).
import path from 'node:path';
import { isFile, readText } from '../../common/files.js';
import { fileItem, scanCommands, scanSkills } from '../../config/discover.js';
import { parseToml } from './toml.js';

const SOURCE = 'codex';

/** Codex `[mcp_servers.x]` -> mcpServers-shaped object (url servers keep `url`). */
export function codexMcpServers(configFile) {
  if (!isFile(configFile)) return {};
  const servers = parseToml(readText(configFile)).mcp_servers || {};
  const out = {};
  for (const [name, s] of Object.entries(servers)) {
    out[name] = {
      ...(s.command ? { command: s.command } : {}),
      ...(s.args ? { args: s.args } : {}),
      ...(s.env ? { env: s.env } : {}),
      ...(s.url ? { url: s.url } : {}),
      ...(s.http_headers ? { headers: s.http_headers } : {}),
      ...(s.enabled === false ? { disabled: true } : {}),
    };
  }
  return out;
}

export function discoverConfig(roots) {
  const dir = roots.codex.dir;
  const user = { source: SOURCE, scope: 'user' };
  const configFile = path.join(dir, 'config.toml');
  const servers = codexMcpServers(configFile);
  return [
    ...scanSkills(path.join(dir, 'skills'), user),
    ...scanCommands(path.join(dir, 'prompts'), user),
    ...(Object.keys(servers).length ? [{ ...user, kind: 'mcp', name: 'config.toml', path: configFile, servers }] : []),
    ...fileItem(path.join(dir, 'AGENTS.md'), { ...user, kind: 'rule', format: 'agents-md', name: 'codex-agents' }),
  ];
}
