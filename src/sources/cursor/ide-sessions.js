// Cursor IDE composer/agent chats.
//   <Cursor>/User/globalStorage/state.vscdb  table cursorDiskKV:
//     composerData:<composerId>       -> { name, createdAt, lastUpdatedAt,
//                                         fullConversationHeadersOnly: [{bubbleId,type}],
//                                         conversation?: [bubble] (older builds) }
//     bubbleId:<composerId>:<bubbleId> -> { type: 1 user | 2 assistant, text,
//                                         thinking?, toolFormerData?: {name, rawArgs, params, result} }
//   <Cursor>/User/workspaceStorage/<h>/{workspace.json, state.vscdb} maps composers to folders.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFile, listDir, readJson } from '../../common/files.js';
import { asText, withReadOnlyDb } from '../../common/sqlite.js';
import { cleanUserText, toMs } from '../../sessions/transcript.js';
import { sameWorkspacePath } from '../../sessions/kiro-v3-writer.js';

export const SOURCE = 'cursor';
const USER_BUBBLE = 1;
const ASSISTANT_BUBBLE = 2;

const globalDbPath = (roots) => path.join(roots.cursor.userDir, 'globalStorage', 'state.vscdb');

function folderFromUri(uri) {
  if (!uri) return null;
  try { return uri.startsWith('file://') ? fileURLToPath(uri) : uri; } catch { return null; }
}

/** composerId -> workspace folder, from each workspace's composer index. */
export function composerFolders(roots) {
  const map = new Map();
  const wsRoot = path.join(roots.cursor.userDir, 'workspaceStorage');
  for (const ws of listDir(wsRoot)) {
    const dir = path.join(wsRoot, ws.name);
    const folder = folderFromUri(readJson(path.join(dir, 'workspace.json'), null)?.folder);
    const db = path.join(dir, 'state.vscdb');
    if (!folder || !isFile(db)) continue;
    try {
      const raw = withReadOnlyDb(db, (d) => d.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get()?.value);
      for (const c of JSON.parse(asText(raw) || '{}').allComposers || []) map.set(c.composerId, { folder, header: c });
    } catch { /* workspace without composer data */ }
  }
  return map;
}

const LIST_SQL = `
  SELECT substr(key, 14) AS id,
         CASE WHEN json_valid(CAST(value AS TEXT)) THEN json_extract(CAST(value AS TEXT), '$.name') END AS name,
         CASE WHEN json_valid(CAST(value AS TEXT)) THEN json_extract(CAST(value AS TEXT), '$.createdAt') END AS createdAt,
         CASE WHEN json_valid(CAST(value AS TEXT)) THEN json_extract(CAST(value AS TEXT), '$.lastUpdatedAt') END AS updatedAt
  FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND json_valid(CAST(value AS TEXT))`;

export async function listSessions(roots, { cwd, limit = 50 } = {}) {
  const dbFile = globalDbPath(roots);
  if (!isFile(dbFile)) return [];
  const folders = composerFolders(roots);
  const rows = withReadOnlyDb(dbFile, (db) => db.prepare(LIST_SQL).all());
  return rows
    .map((r) => {
      const ws = folders.get(r.id);
      return {
        source: SOURCE,
        id: r.id,
        title: r.name || ws?.header?.name || 'Cursor chat',
        cwd: ws?.folder || null,
        createdAt: r.createdAt || ws?.header?.createdAt || null,
        updatedAt: r.updatedAt || ws?.header?.lastUpdatedAt || r.createdAt || 0,
        path: dbFile,
      };
    })
    .filter((s) => !cwd || sameWorkspacePath(s.cwd, cwd, roots.platform))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

function parseArgs(tfd) {
  for (const candidate of [tfd.rawArgs, tfd.params]) {
    if (candidate && typeof candidate === 'object') return candidate;
    if (typeof candidate === 'string' && candidate) { try { return JSON.parse(candidate); } catch { return candidate; } }
  }
  return undefined;
}

/** Cursor bubble -> neutral message, or null for empty/unknown bubbles. */
export function bubbleToMessage(b) {
  if (!b) return null;
  if (b.type === USER_BUBBLE) return { role: 'user', text: cleanUserText(b.text || ''), timestamp: b.createdAt };
  if (b.type !== ASSISTANT_BUBBLE) return null;
  const tfd = b.toolFormerData;
  const toolCalls = tfd?.name ? [{ name: tfd.name, input: parseArgs(tfd) }] : [];
  const toolResults = tfd?.name && tfd.result !== undefined ? [{ name: tfd.name, output: tfd.result }] : [];
  return { role: 'assistant', text: b.text || '', toolCalls, toolResults, timestamp: b.createdAt };
}

export async function readSession(roots, id) {
  const dbFile = globalDbPath(roots);
  const { composer, bubbles } = withReadOnlyDb(dbFile, (db) => {
    const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(`composerData:${id}`);
    if (!row) return { composer: null, bubbles: [] };
    let data;
    try { data = JSON.parse(asText(row.value)); } catch {
      throw new Error(`Cursor chat ${id} is corrupt: its composer record is not valid JSON`);
    }
    if (Array.isArray(data.conversation) && data.conversation.length) return { composer: data, bubbles: data.conversation };
    const rows = db.prepare('SELECT key, value FROM cursorDiskKV WHERE key LIKE ?').all(`bubbleId:${id}:%`);
    const byId = new Map();
    for (const r of rows) {
      try { byId.set(r.key.slice(`bubbleId:${id}:`.length), JSON.parse(asText(r.value))); } catch { /* binary */ }
    }
    const order = (data.fullConversationHeadersOnly || []).map((h) => h.bubbleId).filter((b) => byId.has(b));
    const ordered = order.length
      ? order.map((b) => byId.get(b))
      : [...byId.values()].sort((a, b) => (toMs(a.createdAt) || 0) - (toMs(b.createdAt) || 0));
    return { composer: data, bubbles: ordered };
  });
  if (!composer) throw new Error(`Cursor chat not found: ${id}`);
  const ws = composerFolders(roots).get(id);
  const meta = {
    source: SOURCE, id, title: composer.name || 'Cursor chat', cwd: ws?.folder || null,
    createdAt: composer.createdAt || null, updatedAt: composer.lastUpdatedAt || null, path: dbFile,
  };
  return { meta, messages: bubbles.map(bubbleToMessage).filter(Boolean) };
}
