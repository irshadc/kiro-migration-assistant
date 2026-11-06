// Config migration use case: discover -> convert -> diff against disk -> apply.
// Planning never writes; apply only touches entries planned as create/overwrite
// and backs up anything it overwrites.
import fs from 'node:fs';
import path from 'node:path';
import { copyDir, isDir, isFile, listDir, readJson, readText, writeAtomic, writeJsonAtomic } from '../common/files.js';
import { DEFAULT_CONFIG_SOURCES, configSource } from '../sources/index.js';
import { convertMcpServer, convertCommand, convertRule, convertSkill, safeName } from './converters.js';
import { convertAgent } from './agent-converters.js';
import { convertHooks } from './hooks.js';
import { convertIdeHook } from './kiro-legacy.js';

export const CONFIG_KINDS = ['skill', 'command', 'agent', 'mcp', 'hook', 'rule'];
export const CONFIG_SCOPES = ['user', 'workspace'];
const CONVERTERS = { skill: convertSkill, command: convertCommand, agent: convertAgent, hook: convertHooks, rule: convertRule };
const FORMAT_CONVERTERS = { 'kiro-ide-hook': convertIdeHook };

/** Stable selector for one plan item, e.g. "claude-code/skill/user/pdf". */
export const itemId = ({ source, kind, scope, name }) => `${source}/${kind}/${scope}/${name}`;

export function scopeRoot(roots, scope, workspace) {
  if (scope === 'user') return roots.kiro.dir;
  if (!workspace) throw new Error('workspace scope needs a workspace path');
  return path.join(workspace, '.kiro');
}

/** Discover config items for the chosen sources/kinds/scopes (and optional name filter). */
export function discover(roots, { sources = DEFAULT_CONFIG_SOURCES, kinds = CONFIG_KINDS, scopes = CONFIG_SCOPES, names, workspace } = {}) {
  const wanted = names?.length ? new Set(names) : null;
  return sources.flatMap((s) => configSource(s).discoverConfig(roots, { workspace }))
    .filter((i) => kinds.includes(i.kind) && scopes.includes(i.scope) && (!wanted || wanted.has(i.name)));
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

function agentTargetStatus(op, target, overwrite) {
  const ext = path.extname(target);
  const alternate = ext === '.json' ? `${target.slice(0, -5)}.md` : ext === '.md' ? `${target.slice(0, -3)}.json` : null;
  if (alternate && isFile(alternate)) {
    if (isFile(target)) return {
      status: 'conflict',
      existingTargets: [target, alternate],
      warning: 'both JSON and Markdown Kiro agents already use this name; rename the incoming agent or resolve the existing duplicate manually',
    };
    return { status: overwrite ? 'overwrite' : 'conflict', replaces: alternate };
  }
  return { status: statusFor(op, target, overwrite) };
}

function renamedTarget(id, originalName, renames) {
  if (!renames?.[id]) return originalName;
  return safeName(renames[id]);
}

function planMcp(items, roots, workspace, overwrite, selected, renames) {
  const entries = [];
  const byScope = new Map();
  for (const item of items) {
    const root = scopeRoot(roots, item.scope, workspace);
    const target = path.join(root, 'settings', 'mcp.json');
    if (!byScope.has(target)) byScope.set(target, { existing: readJson(target, {})?.mcpServers || {}, planned: {} });
    const bucket = byScope.get(target);
    for (const [name, cfg] of Object.entries(item.servers)) {
      const id = itemId({ ...item, name });
      if (!selected(id)) continue;
      const targetName = renamedTarget(id, name, renames);
      const { server, warnings } = convertMcpServer(targetName, cfg);
      const renameWarnings = targetName === name ? warnings : [`will be copied as "${targetName}"`, ...warnings];
      const base = { id, kind: 'mcp', source: item.source, scope: item.scope, name, ...(targetName !== name ? { targetName } : {}), from: item.path, target, warnings: renameWarnings };
      if (bucket.planned[targetName]) { entries.push({ ...base, status: 'conflict', warnings: [...renameWarnings, `already planned from ${bucket.planned[targetName].from}`] }); continue; }
      const prev = bucket.existing[targetName];
      const status = !prev ? 'create' : JSON.stringify(prev) === JSON.stringify(server) ? 'unchanged' : overwrite ? 'overwrite' : 'conflict';
      bucket.planned[targetName] = { from: item.path };
      entries.push({ ...base, status, mcpServer: server });
    }
  }
  return entries;
}

/** Build the full plan. Pure with respect to the filesystem (reads only). */
export function planConfigMigration(roots, { sources, kinds, scopes, names, ids, renames, workspace, overwrite = false } = {}) {
  const wantedIds = ids?.length ? new Set(ids) : null;
  const selected = (id) => !wantedIds || wantedIds.has(id);
  const items = discover(roots, { sources, kinds, scopes, names, workspace });
  const entries = [];
  const plannedTargets = new Map();
  for (const item of items.filter((i) => i.kind !== 'mcp' && selected(itemId(i)))) {
    const root = scopeRoot(roots, item.scope, workspace);
    const id = itemId(item);
    const targetName = renamedTarget(id, item.name, renames);
    const convertedItem = targetName === item.name ? item : { ...item, targetName };
    let result;
    try { result = (FORMAT_CONVERTERS[item.format] || CONVERTERS[item.kind])(convertedItem); } catch (err) {
      entries.push({ id, kind: item.kind, source: item.source, scope: item.scope, name: item.name, from: item.path, status: 'error', warnings: [err.message] });
      continue;
    }
    const warnings = targetName === item.name ? result.warnings : [`will be copied as "${targetName}"`, ...result.warnings];
    const renamed = targetName === item.name ? {} : { targetName };
    if (!result.ops.length) entries.push({ id, kind: item.kind, source: item.source, scope: item.scope, name: item.name, ...renamed, from: item.path, status: 'skipped', warnings });
    for (const op of result.ops) {
      const target = path.join(root, op.target);
      const base = { id, kind: item.kind, source: item.source, scope: item.scope, name: item.name, ...renamed, from: item.path, target, op };
      if (plannedTargets.has(target)) {
        entries.push({ ...base, status: 'conflict', warnings: [...warnings, `same target already planned from ${plannedTargets.get(target)}`] });
        continue;
      }
      plannedTargets.set(target, item.path);
      const targetStatus = item.kind === 'agent' ? agentTargetStatus(op, target, overwrite) : { status: statusFor(op, target, overwrite) };
      const targetWarnings = targetStatus.warning ? [...warnings, targetStatus.warning] : warnings;
      entries.push({ ...base, ...targetStatus, warnings: targetWarnings });
    }
  }
  entries.push(...planMcp(items.filter((i) => i.kind === 'mcp'), roots, workspace, overwrite, selected, renames));
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
      doc.mcpServers = { ...(doc.mcpServers || {}), [e.targetName || e.name]: e.mcpServer };
      out.push({ ...e, applied: true });
      continue;
    }
    const exists = e.op.copyFrom ? isDir(e.target) : isFile(e.target);
    const replaceTarget = e.replaces || (exists ? e.target : null);
    const backupPath = replaceTarget ? backup(replaceTarget, now) : undefined;
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
  const { op, mcpServer, warning, ...rest } = e;
  return rest;
}

export function summarize(entries) {
  const counts = {};
  for (const e of entries) counts[e.status] = (counts[e.status] || 0) + 1;
  return counts;
}
