// What Kiro already has, per scope, so the guided flow can show "already in
// Kiro" next to what other tools offer. Read-only.
import path from 'node:path';
import { isDir, isFile, listDir, readJson } from '../common/files.js';

const names = (dir, { dirs = false, ext } = {}) => listDir(dir)
  .filter((e) => (dirs ? isDir(path.join(dir, e.name)) : isFile(path.join(dir, e.name)) && (!ext || e.name.endsWith(ext))))
  .filter((e) => !e.name.startsWith('._') && !e.name.includes('.kma-backup-'))
  .map((e) => (ext ? e.name.slice(0, -ext.length) : e.name))
  .sort();

function uniqueAgentNames(root) {
  const dir = path.join(root, 'agents');
  return [...new Set([...names(dir, { ext: '.json' }), ...names(dir, { ext: '.md' })])].sort();
}

function inventory(root) {
  return {
    dir: root,
    skills: names(path.join(root, 'skills'), { dirs: true }),
    agents: uniqueAgentNames(root),
    mcpServers: Object.keys(readJson(path.join(root, 'settings', 'mcp.json'), {})?.mcpServers || {}).sort(),
    hooks: names(path.join(root, 'hooks'), { ext: '.json' }),
    steering: names(path.join(root, 'steering'), { ext: '.md' }),
  };
}

/** Kiro's current skills, agents, MCP servers, hooks and steering for user (and workspace) scope. */
export function kiroInventory(roots, { workspace } = {}) {
  return {
    user: inventory(roots.kiro.dir),
    ...(workspace ? { workspace: inventory(path.join(workspace, '.kiro')) } : {}),
  };
}
