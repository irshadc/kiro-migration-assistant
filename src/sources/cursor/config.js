// Cursor configuration locations (user = ~/.cursor, workspace = <ws>/.cursor).
import path from 'node:path';
import { readJson } from '../../common/files.js';
import { fileItem, scanCommands, scanMarkdownFiles, scanMcpFile, scanSkills } from '../../config/discover.js';

const SOURCE = 'cursor';

function hooksItem(file, scope) {
  const hooks = readJson(file, null)?.hooks;
  if (!hooks || typeof hooks !== 'object' || Object.keys(hooks).length === 0) return [];
  return [{ source: SOURCE, kind: 'hook', scope, format: 'cursor', name: path.basename(file), path: file, hooks }];
}

export function discoverConfig(roots, { workspace } = {}) {
  const dir = roots.cursor.dir;
  const user = { source: SOURCE, scope: 'user' };
  const items = [
    ...scanSkills(path.join(dir, 'skills'), user),
    ...scanCommands(path.join(dir, 'commands'), user),
    ...scanMcpFile(path.join(dir, 'mcp.json'), user),
    ...hooksItem(path.join(dir, 'hooks.json'), 'user'),
  ];
  if (workspace) {
    const ws = { source: SOURCE, scope: 'workspace' };
    const wsDir = path.join(workspace, '.cursor');
    items.push(
      ...scanSkills(path.join(wsDir, 'skills'), ws),
      ...scanCommands(path.join(wsDir, 'commands'), ws),
      ...scanMcpFile(path.join(wsDir, 'mcp.json'), ws),
      ...hooksItem(path.join(wsDir, 'hooks.json'), 'workspace'),
      ...scanMarkdownFiles(path.join(wsDir, 'rules'), { ...ws, kind: 'rule', format: 'cursor-mdc', extensions: ['.mdc', '.md'] }),
      ...fileItem(path.join(workspace, '.cursorrules'), { ...ws, kind: 'rule', format: 'cursorrules', name: 'cursorrules' }),
    );
  }
  return items;
}
