// `install`: register this MCP server in Kiro's user mcp.json and copy the
// bundled skill into ~/.kiro/skills. Idempotent; a changed mcp.json is backed up.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyDir, isFile, readJson, writeJsonAtomic } from './common/files.js';
import { isWindows } from './common/platform.js';

export const SERVER_NAME = 'kiro-migration-assistant';
// Released git tag the installer pins, so `npx` runs reviewed code instead of whatever main holds today.
// Derived from package.json so a version bump cannot leave the pin behind.
const { version } = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8'));
export const RELEASE_TAG = `v${version}`;
export const PACKAGE_SPEC = `github:irshadc/kiro-migration-assistant#${RELEASE_TAG}`;
const SKILL_DIR = fileURLToPath(new URL('../skills/kiro-migration-assistant', import.meta.url));

/**
 * The mcp.json entry that starts this server. On Windows npx is `npx.cmd`, which a
 * client that spawns without a shell cannot find, so it runs through `cmd /c`.
 */
export const serverEntry = (platform = process.platform) => (isWindows(platform)
  ? { command: 'cmd', args: ['/c', 'npx', '-y', PACKAGE_SPEC] }
  : { command: 'npx', args: ['-y', PACKAGE_SPEC] });

/**
 * How to run one tool from the user's default shell. PowerShell hands npx.cmd its
 * arguments with bare double quotes stripped, so on Windows each quote is written \".
 */
export function callHint(platform = process.platform) {
  const call = `npx -y ${PACKAGE_SPEC} call <tool>`;
  return isWindows(platform) ? `${call} '<json args, every " written as \\">'` : `${call} '<json args>'`;
}

function registerServer(mcpFile, now, platform) {
  const exists = isFile(mcpFile);
  const config = exists ? readJson(mcpFile) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${mcpFile} must hold a JSON object; fix it, then re-run install`);
  const servers = config.mcpServers ?? {};
  const wanted = serverEntry(platform);
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
  const mcp = registerServer(path.join(roots.kiro.dir, 'settings', 'mcp.json'), now, roots.platform);
  const skillTarget = path.join(roots.kiro.dir, 'skills', SERVER_NAME);
  const files = copyDir(SKILL_DIR, skillTarget);
  return {
    mcp,
    skill: { dir: skillTarget, files },
    next: `Start a new Kiro session to load the MCP tools. In the current session, run the same tools with: ${callHint(roots.platform)}`,
  };
}
