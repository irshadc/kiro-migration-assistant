// `install`: register this MCP server in Kiro's user mcp.json and copy the
// bundled skill into ~/.kiro/skills. Idempotent; a changed mcp.json is backed up.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyDir, isFile, readJson, writeJsonAtomic } from './common/files.js';

export const SERVER_NAME = 'kiro-migration-assistant';
export const PACKAGE_SPEC = 'github:irshadc/kiro-migration-assist';
const SKILL_DIR = fileURLToPath(new URL('../skills/kiro-migration-assistant', import.meta.url));

export const serverEntry = () => ({ command: 'npx', args: ['-y', PACKAGE_SPEC] });

function registerServer(mcpFile, now) {
  const exists = isFile(mcpFile);
  const config = exists ? readJson(mcpFile) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${mcpFile} must hold a JSON object; fix it, then re-run install`);
  const servers = config.mcpServers ?? {};
  const wanted = serverEntry();
  if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(wanted)) return { file: mcpFile, status: 'unchanged' };
  let backup = null;
  if (exists) {
    backup = `${mcpFile}.kma-backup-${now}`;
    fs.copyFileSync(mcpFile, backup);
  }
  writeJsonAtomic(mcpFile, { ...config, mcpServers: { ...servers, [SERVER_NAME]: wanted } });
  return { file: mcpFile, status: servers[SERVER_NAME] ? 'updated' : 'added', backup };
}

export function install(roots, { now = Date.now() } = {}) {
  const mcp = registerServer(path.join(roots.kiro.dir, 'settings', 'mcp.json'), now);
  const skillTarget = path.join(roots.kiro.dir, 'skills', SERVER_NAME);
  const files = copyDir(SKILL_DIR, skillTarget);
  return {
    mcp,
    skill: { dir: skillTarget, files },
    next: 'Start a new Kiro session to load the MCP tools. In the current session, run the same tools with: '
      + `npx -y ${PACKAGE_SPEC} call <tool> '<json args>'`,
  };
}
