// Claude Code configuration locations (user = <claude dir>, workspace = <ws>).
import path from 'node:path';
import { readJson } from '../../common/files.js';
import { fileItem, scanCommands, scanMarkdownFiles, scanMcpFile, scanSkills } from '../../config/discover.js';

const SOURCE = 'claude-code';

function hooksItem(file, scope) {
  const hooks = readJson(file, null)?.hooks;
  if (!hooks || typeof hooks !== 'object' || Object.keys(hooks).length === 0) return [];
  return [{ source: SOURCE, kind: 'hook', scope, format: 'claude', name: path.basename(file), path: file, hooks }];
}

/** MCP servers Claude stores per project inside ~/.claude.json ("local" scope). */
function localProjectMcp(globalFile, workspace) {
  const servers = readJson(globalFile, null)?.projects?.[workspace]?.mcpServers;
  if (!servers || Object.keys(servers).length === 0) return [];
  return [{ source: SOURCE, kind: 'mcp', scope: 'workspace', name: 'claude.json#local', path: globalFile, servers }];
}

export function discoverConfig(roots, { workspace } = {}) {
  const c = roots.claude;
  const user = { source: SOURCE, scope: 'user' };
  const items = [
    ...scanSkills(path.join(c.dir, 'skills'), user),
    ...scanCommands(path.join(c.dir, 'commands'), user),
    ...scanMarkdownFiles(path.join(c.dir, 'agents'), { ...user, kind: 'agent', format: 'claude-agent' }),
    ...scanMcpFile(c.globalConfigFile, user),
    ...hooksItem(path.join(c.dir, 'settings.json'), 'user'),
    ...fileItem(path.join(c.dir, 'CLAUDE.md'), { ...user, kind: 'rule', format: 'claude-md', name: 'claude-user' }),
  ];
  if (workspace) {
    const ws = { source: SOURCE, scope: 'workspace' };
    items.push(
      ...scanSkills(path.join(workspace, '.claude', 'skills'), ws),
      ...scanCommands(path.join(workspace, '.claude', 'commands'), ws),
      ...scanMarkdownFiles(path.join(workspace, '.claude', 'agents'), { ...ws, kind: 'agent', format: 'claude-agent' }),
      ...scanMcpFile(path.join(workspace, '.mcp.json'), ws),
      ...localProjectMcp(c.globalConfigFile, workspace),
      ...hooksItem(path.join(workspace, '.claude', 'settings.json'), 'workspace'),
      ...hooksItem(path.join(workspace, '.claude', 'settings.local.json'), 'workspace'),
      ...fileItem(path.join(workspace, 'CLAUDE.md'), { ...ws, kind: 'rule', format: 'claude-md', name: 'claude-project' }),
      ...fileItem(path.join(workspace, '.claude', 'CLAUDE.md'), { ...ws, kind: 'rule', format: 'claude-md', name: 'claude-project-dir' }),
    );
  }
  return items;
}
