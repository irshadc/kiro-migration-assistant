// Cursor Agent (cursor-agent CLI and the IDE's agent transcripts).
//   A) ~/.cursor/projects/<enc>/agent-transcripts/<id>.jsonl  (or <id>/<id>.jsonl)
//      lines: { role, message: { content: [ {type:'text',text} | tool parts ] } }
//   B) ~/.cursor/chats/<hash>/<id>/store.db  (content-addressed blob tree)
// Store format knowledge comes from Agentlytics' cursor adapter.
import fs from 'node:fs';
import path from 'node:path';
import { isDir, isFile, listDir, mtimeMs, readJsonl } from '../../common/files.js';
import { asText, withReadOnlyDb } from '../../common/sqlite.js';
import { cleanUserText, contentToText } from '../../sessions/transcript.js';

export const SOURCE = 'cursor-agent';
const TITLE_MAX = 120;
const HASH_BYTES = 32;
const TAG_MESSAGE = 0x0a;
const TAG_CHILD = 0x12;

/** "home-me-code-app" -> "/home/me/code/app", resolving '-' ambiguity against disk. */
export function decodeProjectDir(name) {
  const naive = `/${name.replace(/-/g, '/')}`;
  if (fs.existsSync(naive)) return naive;
  const parts = name.split('-');
  const search = (base, i) => {
    if (i === parts.length) return base;
    for (let j = parts.length; j > i; j--) {
      const candidate = path.join(base, parts.slice(i, j).join('-'));
      if (fs.existsSync(candidate)) { const hit = search(candidate, j); if (hit) return hit; }
    }
    return null;
  };
  return search('/', 0) || naive;
}

function transcriptEntries(roots) {
  const out = [];
  const projectsDir = path.join(roots.cursor.dir, 'projects');
  for (const proj of listDir(projectsDir)) {
    const dir = path.join(projectsDir, proj.name, 'agent-transcripts');
    if (!isDir(dir)) continue;
    for (const e of listDir(dir)) {
      const flat = path.join(dir, e.name);
      const nested = path.join(flat, `${e.name}.jsonl`);
      if (e.name.endsWith('.jsonl')) out.push({ id: e.name.slice(0, -6), file: flat, projectDir: proj.name, kind: 'transcript' });
      else if (isFile(nested)) out.push({ id: e.name, file: nested, projectDir: proj.name, kind: 'transcript' });
    }
  }
  return out;
}

function storeEntries(roots) {
  const out = [];
  const chatsDir = path.join(roots.cursor.dir, 'chats');
  for (const ws of listDir(chatsDir)) {
    for (const chat of listDir(path.join(chatsDir, ws.name))) {
      const file = path.join(chatsDir, ws.name, chat.name, 'store.db');
      if (isFile(file)) out.push({ id: chat.name, file, kind: 'store' });
    }
  }
  return out;
}

function readStoreMeta(db) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('0');
  if (!row) return null;
  const raw = asText(row.value);
  try { return JSON.parse(Buffer.from(raw, 'hex').toString('utf-8')); } catch { /* not hex */ }
  try { return JSON.parse(raw); } catch { return null; }
}

function parseTreeBlob(buf) {
  const messageRefs = [];
  const childRefs = [];
  for (let off = 0; off + 2 + HASH_BYTES <= buf.length; off += 2 + HASH_BYTES) {
    const tag = buf[off];
    if (buf[off + 1] !== HASH_BYTES || (tag !== TAG_MESSAGE && tag !== TAG_CHILD)) break;
    (tag === TAG_MESSAGE ? messageRefs : childRefs).push(buf.subarray(off + 2, off + 2 + HASH_BYTES).toString('hex'));
  }
  return { messageRefs, childRefs };
}

function readStoreMessages(db, rootId) {
  const stmt = db.prepare('SELECT data FROM blobs WHERE id = ?');
  const out = [];
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const row = stmt.get(id);
    if (!row) return;
    const buf = Buffer.from(row.data);
    try {
      const json = JSON.parse(buf.toString('utf-8'));
      if (json && json.role) { out.push(json); return; }
    } catch { /* tree node */ }
    const { messageRefs, childRefs } = parseTreeBlob(buf);
    messageRefs.forEach(walk);
    childRefs.forEach(walk);
  };
  walk(rootId);
  return out;
}

/** AI-SDK / OpenAI / Anthropic style message -> neutral model message(s). */
export function normalizeAgentMessage(m) {
  const parts = Array.isArray(m.content) ? m.content : [{ type: 'text', text: contentToText(m.content) }];
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  const toolCalls = parts.filter((p) => p.type === 'tool-call' || p.type === 'tool_use')
    .map((p) => ({ id: p.toolCallId || p.id, name: p.toolName || p.name, input: p.args ?? p.input }));
  for (const tc of m.tool_calls || []) {
    let input = tc.function?.arguments;
    try { input = JSON.parse(input); } catch { /* keep string */ }
    toolCalls.push({ id: tc.id, name: tc.function?.name || 'tool', input });
  }
  const toolResults = parts.filter((p) => p.type === 'tool-result' || p.type === 'tool_result')
    .map((p) => ({ id: p.toolCallId || p.tool_use_id, name: p.toolName, output: p.result ?? p.output ?? p.content, isError: Boolean(p.isError || p.is_error) }));
  if (m.role === 'tool') return { role: 'user', text: '', toolResults: toolResults.length ? toolResults : [{ output: m.content }] };
  if (m.role === 'user') return { role: 'user', text: cleanUserText(text), toolResults };
  if (m.role === 'assistant') return { role: 'assistant', text, toolCalls, toolResults };
  return null;
}

async function readTranscript(file) {
  const out = [];
  for await (const line of readJsonl(file)) {
    const m = normalizeAgentMessage({ role: line.role, content: line.message?.content ?? line.content });
    if (m) out.push(m);
  }
  return out;
}

function titleFrom(messages, fallback) {
  const first = messages.find((m) => m.role === 'user' && m.text)?.text;
  return (first || fallback).replace(/\s+/g, ' ').slice(0, TITLE_MAX);
}

function allEntries(roots) {
  const transcripts = transcriptEntries(roots);
  const ids = new Set(transcripts.map((t) => t.id));
  return [...transcripts, ...storeEntries(roots).filter((s) => !ids.has(s.id))];
}

async function load(entry) {
  if (entry.kind === 'transcript') {
    const messages = await readTranscript(entry.file);
    return { messages, cwd: decodeProjectDir(entry.projectDir), title: null, createdAt: null };
  }
  return withReadOnlyDb(entry.file, (db) => {
    const meta = readStoreMeta(db) || {};
    const raw = meta.latestRootBlobId ? readStoreMessages(db, meta.latestRootBlobId) : [];
    return { messages: raw.map(normalizeAgentMessage).filter(Boolean), cwd: null, title: meta.name || null, createdAt: meta.createdAt || null };
  });
}

/** Cheap listing metadata: transcript head lines or the store's meta row only. */
async function peek(entry) {
  if (entry.kind === 'transcript') {
    const head = [];
    for await (const line of readJsonl(entry.file)) {
      const m = normalizeAgentMessage({ role: line.role, content: line.message?.content ?? line.content });
      if (m) head.push(m);
      if (head.some((h) => h.role === 'user' && h.text)) break;
    }
    return head.length ? { title: titleFrom(head, 'Cursor Agent session'), createdAt: null } : null;
  }
  const meta = withReadOnlyDb(entry.file, readStoreMeta);
  return meta?.latestRootBlobId ? { title: meta.name || 'Cursor Agent session', createdAt: meta.createdAt || null } : null;
}

export async function listSessions(roots, { cwd, limit = 50 } = {}) {
  const entries = allEntries(roots).map((e) => ({ ...e, mtime: mtimeMs(e.file) })).sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const entry of entries) {
    if (out.length >= limit) break;
    const entryCwd = entry.kind === 'transcript' ? decodeProjectDir(entry.projectDir) : null;
    if (cwd && entryCwd !== cwd) continue;
    let info;
    try { info = await peek(entry); } catch { continue; }
    if (!info) continue;
    out.push({ source: SOURCE, id: entry.id, title: info.title, cwd: entryCwd, createdAt: info.createdAt, updatedAt: entry.mtime, path: entry.file });
  }
  return out;
}

export async function readSession(roots, id) {
  const entry = allEntries(roots).find((e) => e.id === id);
  if (!entry) throw new Error(`Cursor Agent session not found: ${id}`);
  const loaded = await load(entry);
  const meta = { source: SOURCE, id, title: loaded.title || titleFrom(loaded.messages, 'Cursor Agent session'), cwd: loaded.cwd, createdAt: loaded.createdAt, updatedAt: mtimeMs(entry.file), path: entry.file };
  return { meta, messages: loaded.messages };
}
