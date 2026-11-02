// Kiro IDE hooks (*.kiro.hook) for kiro-cli V3, which reads only hooks/*.json.
// Opt-in source ("kiro"), not part of the default set, so existing migrations
// are unchanged. The .kiro.hook files stay in place for Kiro IDE.
import path from 'node:path';
import { isFile, listDir } from '../../common/files.js';

const SOURCE = 'kiro';
const IDE_HOOK_EXT = '.kiro.hook';

function ideHooks(dir, scope) {
  return listDir(dir).filter((e) => e.name.endsWith(IDE_HOOK_EXT) && isFile(path.join(dir, e.name)))
    .map((e) => ({ source: SOURCE, kind: 'hook', format: 'kiro-ide-hook', scope, name: e.name.slice(0, -IDE_HOOK_EXT.length), path: path.join(dir, e.name) }));
}

export function discoverConfig(roots, { workspace } = {}) {
  const items = ideHooks(path.join(roots.kiro.dir, 'hooks'), 'user');
  if (workspace) items.push(...ideHooks(path.join(workspace, '.kiro', 'hooks'), 'workspace'));
  return items;
}
