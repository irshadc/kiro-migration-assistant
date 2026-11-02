// Scanners shared by the per-tool config adapters. Each returns "config items",
// the neutral input of the converters:
//   { source, kind, scope: 'user'|'workspace', name, path, ...kind-specific }
import path from 'node:path';
import { isDir, isFile, listDir, readJson } from '../common/files.js';

/** `<dir>/<name>/SKILL.md` -> skill items. */
export function scanSkills(dir, { source, scope }) {
  return listDir(dir)
    .filter((e) => isFile(path.join(dir, e.name, 'SKILL.md')))
    .map((e) => ({ source, kind: 'skill', scope, name: e.name, path: path.join(dir, e.name) }));
}

/** Markdown slash commands, recursively; nested `a/b.md` becomes name `a-b`. */
export function scanCommands(dir, { source, scope }) {
  const items = [];
  const walk = (rel) => {
    for (const e of listDir(path.join(dir, rel))) {
      const childRel = path.join(rel, e.name);
      const full = path.join(dir, childRel);
      if (isDir(full)) walk(childRel);
      else if (e.name.endsWith('.md')) {
        const name = childRel.slice(0, -3).split(path.sep).join('-');
        items.push({ source, kind: 'command', scope, name, path: full });
      }
    }
  };
  walk('');
  return items;
}

/** Flat `*.md` files in a directory, one item per file. */
export function scanMarkdownFiles(dir, { source, kind, scope, extensions = ['.md'], format }) {
  const items = [];
  const walk = (rel) => {
    for (const e of listDir(path.join(dir, rel))) {
      const childRel = path.join(rel, e.name);
      const full = path.join(dir, childRel);
      if (isDir(full)) { walk(childRel); continue; }
      const ext = extensions.find((x) => e.name.endsWith(x));
      if (ext) items.push({ source, kind, scope, format, name: childRel.slice(0, -ext.length).split(path.sep).join('-'), path: full });
    }
  };
  walk('');
  return items;
}

/** One `mcpServers` JSON file -> a single mcp item (absent file -> none). */
export function scanMcpFile(file, { source, scope, key = 'mcpServers' }) {
  const data = readJson(file, null);
  const servers = data?.[key];
  if (!servers || typeof servers !== 'object' || Object.keys(servers).length === 0) return [];
  return [{ source, kind: 'mcp', scope, name: path.basename(file), path: file, servers }];
}

export function fileItem(file, fields) {
  return isFile(file) ? [{ ...fields, name: fields.name || path.basename(file), path: file }] : [];
}
