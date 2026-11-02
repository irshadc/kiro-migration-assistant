// Config migration use case: discover -> convert -> diff against disk -> apply.
// Planning never writes; apply only touches entries planned as create/overwrite
// and backs up anything it overwrites.
import fs from 'node:fs';
import path from 'node:path';
import { copyDir, isDir, isFile, listDir, readJson, readText, writeAtomic, writeJsonAtomic } from '../common/files.js';
import { CONFIG_SOURCES, configSource } from '../sources/index.js';
import { convertAgent, convertCommand, convertMcpServer, convertRule, convertSkill } from './converters.js';
import { convertHooks } from './hooks.js';

export const CONFIG_KINDS = ['skill', 'command', 'agent', 'mcp', 'hook', 'rule'];
const CONVERTERS = { skill: convertSkill, command: convertCommand, agent: convertAgent, hook: convertHooks, rule: convertRule };

export function scopeRoot(roots, scope, workspace) {
  if (scope === 'user') return roots.kiro.dir;
  if (!workspace) throw new Error('workspace scope needs a workspace path');
  return path.join(workspace, '.kiro');
}

/** Discover config items for the chosen sources/kinds (and optional name filter). */
export function discover(roots, { sources = Object.keys(CONFIG_SOURCES), kinds = CONFIG_KINDS, names, workspace } = {}) {
  const wanted = names?.length ? new Set(names) : null;
  return sources.flatMap((s) => configSource(s).discoverConfig(roots, { workspace }))
    .filter((i) => kinds.includes(i.kind) && (!wanted || wanted.has(i.name)));
}

function dirFiles(dir) {
  const out = new Map();
  const walk = (rel) => {
    for (const e of listDir(path.join(dir, rel))) {
      const r = path.join(rel, e.name);
      if (isDir(path.join(dir, r))) walk(r); else out.set(r, readText(path.join(dir, r)));
    }
  };
  walk('');
  return out;
}

function statusFor(op, absTarget, overwrite) {
  let same;
  if (op.copyFrom) {
    if (!isDir(absTarget)) return 'create';
    const want = dirFiles(op.copyFrom);
    for (const [rel, content] of Object.entries(op.overrides || {})) want.set(rel, content);
    const have = dirFiles(absTarget);
    same = want.size === have.size && [...want].every(([k, v]) => have.get(k) === v);
  } else {
    if (!isFile(absTarget)) return 'create';
    same = readText(absTarget) === op.content;
  }
  if (same) return 'unchanged';
  return overwrite ? 'overwrite' : 'conflict';
}

function planMcp(items, roots, workspace, overwrite) {
  const entries = [];
  const byScope = new Map();
  for (const item of items) {
    const root = scopeRoot(roots, item.scope, workspace);
    const target = path.join(root, 'settings', 'mcp.json');
    if (!byScope.has(target)) byScope.set(target, { existing: readJson(target, {})?.mcpServers || {}, planned: {} });
    const bucket = byScope.get(target);
    for (const [name, cfg] of Object.entries(item.servers)) {
      const { server, warnings } = convertMcpServer(name, cfg);
      const base = { kind: 'mcp', source: item.source, scope: item.scope, name, from: item.path, target, warnings };
      if (bucket.planned[name]) { entries.push({ ...base, status: 'conflict', warnings: [...warnings, `already planned from ${bucket.planned[name].from}`] }); continue; }
      const prev = bucket.existing[name];
      const status = !prev ? 'create' : JSON.stringify(prev) === JSON.stringify(server) ? 'unchanged' : overwrite ? 'overwrite' : 'conflict';
      bucket.planned[name] = { from: item.path };
      entries.push({ ...base, status, mcpServer: server });
    }
  }
  return entries;
}

/** Build the full plan. Pure with respect to the filesystem (reads only). */
export function planConfigMigration(roots, { sources, kinds, names, workspace, overwrite = false } = {}) {
  const items = discover(roots, { sources, kinds, names, workspace });
  const entries = [];
  const plannedTargets = new Map();
  for (const item of items.filter((i) => i.kind !== 'mcp')) {
    const root = scopeRoot(roots, item.scope, workspace);
    let result;
    try { result = CONVERTERS[item.kind](item); } catch (err) {
      entries.push({ kind: item.kind, source: item.source, scope: item.scope, name: item.name, from: item.path, status: 'error', warnings: [err.message] });
      continue;
    }
    if (!result.ops.length) entries.push({ kind: item.kind, source: item.source, scope: item.scope, name: item.name, from: item.path, status: 'skipped', warnings: result.warnings });
    for (const op of result.ops) {
      const target = path.join(root, op.target);
      const base = { kind: item.kind, source: item.source, scope: item.scope, name: item.name, from: item.path, target, op };
      if (plannedTargets.has(target)) {
        entries.push({ ...base, status: 'conflict', warnings: [...result.warnings, `same target already planned from ${plannedTargets.get(target)}`] });
        continue;
      }
      plannedTargets.set(target, item.path);
      entries.push({ ...base, status: statusFor(op, target, overwrite), warnings: result.warnings });
    }
  }
  entries.push(...planMcp(items.filter((i) => i.kind === 'mcp'), roots, workspace, overwrite));
  return entries;
}

function backup(target, stamp) {
  const dest = `${target}.kma-backup-${stamp}`;
  fs.renameSync(target, dest);
  return dest;
}

/** Apply create/overwrite entries. Returns entries annotated with `applied` / `backup`. */
export function applyConfigPlan(entries, { now = Date.now() } = {}) {
  const mcpTargets = new Map();
  const out = [];
  for (const e of entries) {
    if (e.status !== 'create' && e.status !== 'overwrite') { out.push({ ...e, applied: false }); continue; }
    if (e.kind === 'mcp') {
      if (!mcpTargets.has(e.target)) mcpTargets.set(e.target, readJson(e.target, {}) || {});
      const doc = mcpTargets.get(e.target);
      doc.mcpServers = { ...(doc.mcpServers || {}), [e.name]: e.mcpServer };
      out.push({ ...e, applied: true });
      continue;
    }
    const exists = e.op.copyFrom ? isDir(e.target) : isFile(e.target);
    const backupPath = exists ? backup(e.target, now) : undefined;
    if (e.op.copyFrom) {
      copyDir(e.op.copyFrom, e.target);
      for (const [rel, content] of Object.entries(e.op.overrides || {})) writeAtomic(path.join(e.target, rel), content);
    } else {
      writeAtomic(e.target, e.op.content);
    }
    out.push({ ...e, applied: true, ...(backupPath ? { backup: backupPath } : {}) });
  }
  for (const [target, doc] of mcpTargets) {
    if (isFile(target)) fs.copyFileSync(target, `${target}.kma-backup-${now}`);
    writeJsonAtomic(target, doc);
  }
  return out;
}

/** Strip internal fields for tool output. */
export function publicEntry(e) {
  const { op, mcpServer, ...rest } = e;
  return rest;
}

export function summarize(entries) {
  const counts = {};
  for (const e of entries) counts[e.status] = (counts[e.status] || 0) + 1;
  return counts;
}
