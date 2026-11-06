// Codex CLI sessions: <codex>/sessions/YYYY/MM/DD/rollout-*.jsonl (+ archived_sessions/).
// Line 1: { type: 'session_meta', payload: { id, cwd, timestamp } }
// Then { type: 'response_item', payload: message | function_call | function_call_output | ... }
import path from 'node:path';
import { isDir, listDir, mtimeMs, peekJsonl, readJsonl } from '../../common/files.js';
import { cleanUserText, contentToText } from '../../sessions/transcript.js';
import { sameWorkspacePath } from '../../sessions/kiro-v3-writer.js';

export const SOURCE = 'codex';
const TITLE_MAX = 120;
const PEEK_LINES = 30;
const CONTEXT_PREFIXES = ['<environment_context>', '<user_instructions>', '# AGENTS.md instructions'];

function rolloutFiles(roots) {
  const out = [];
  const walk = (dir) => {
    for (const e of listDir(dir)) {
      const full = path.join(dir, e.name);
      if (isDir(full)) walk(full);
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(full);
    }
  };
  walk(path.join(roots.codex.dir, 'sessions'));
  walk(path.join(roots.codex.dir, 'archived_sessions'));
  return out;
}

const isInjectedContext = (text) => CONTEXT_PREFIXES.some((p) => text.trimStart().startsWith(p));

function userText(payload) {
  const text = contentToText(payload.content);
  return isInjectedContext(text) ? '' : cleanUserText(text);
}

async function describe(file) {
  const head = await peekJsonl(file, PEEK_LINES);
  const meta = head.find((r) => r.type === 'session_meta')?.payload;
  if (!meta?.id) return null;
  const first = head
    .filter((r) => r.type === 'response_item' && r.payload?.type === 'message' && r.payload.role === 'user')
    .map((r) => userText(r.payload)).find(Boolean);
  return {
    source: SOURCE,
    id: meta.id,
    title: (first || 'Codex session').replace(/\s+/g, ' ').slice(0, TITLE_MAX),
    cwd: meta.cwd || null,
    createdAt: meta.timestamp ? Date.parse(meta.timestamp) : null,
    updatedAt: mtimeMs(file),
    path: file,
  };
}

export async function listSessions(roots, { cwd, limit = 50 } = {}) {
  const files = rolloutFiles(roots).map((f) => ({ f, m: mtimeMs(f) })).sort((a, b) => b.m - a.m);
  const out = [];
  for (const { f } of files) {
    if (out.length >= limit) break;
    const d = await describe(f);
    if (d && (!cwd || sameWorkspacePath(d.cwd, cwd, roots.platform))) out.push(d);
  }
  return out;
}

async function findFile(roots, id) {
  const files = rolloutFiles(roots);
  const byName = files.find((f) => path.basename(f).includes(id));
  if (byName) return byName;
  for (const f of files) if ((await describe(f))?.id === id) return f;
  return null;
}

export async function readSession(roots, id) {
  const file = await findFile(roots, id);
  if (!file) throw new Error(`Codex session not found: ${id}`);
  const meta = await describe(file);
  const messages = [];
  const names = new Map();
  for await (const r of readJsonl(file)) {
    const p = r.payload;
    if (r.type !== 'response_item' || !p) continue;
    const timestamp = r.timestamp ? Date.parse(r.timestamp) : undefined;
    if (p.type === 'message' && p.role === 'user') messages.push({ role: 'user', text: userText(p), timestamp });
    else if (p.type === 'message' && p.role === 'assistant') messages.push({ role: 'assistant', text: contentToText(p.content), timestamp });
    else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      const name = p.name || (p.type === 'local_shell_call' ? 'shell' : 'tool');
      names.set(p.call_id, name);
      let input = p.arguments ?? p.input ?? p.action;
      try { input = typeof input === 'string' ? JSON.parse(input) : input; } catch { /* keep raw */ }
      messages.push({ role: 'assistant', text: '', toolCalls: [{ id: p.call_id, name, input }], timestamp });
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const output = typeof p.output === 'object' && p.output !== null ? (p.output.content ?? p.output) : p.output;
      messages.push({ role: 'assistant', text: '', toolResults: [{ id: p.call_id, name: names.get(p.call_id), output }], timestamp });
    }
  }
  return { meta, messages };
}
