// Writes sessions into Kiro's V3 (KAS) session store, mirroring the layout the
// kiro-cli 2.26 agent engine reads:
//   <kiro>/sessions/<bucket>/sess_<uuid>/session.json
//   <kiro>/sessions/<bucket>/sess_<uuid>/messages.jsonl
//   <kiro>/session-index/<bucket>.jsonl   ({"op":"add","sessionPath":...})
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isFile, readJson, readText, writeAtomic, writeJsonAtomic } from '../common/files.js';
import { platformPath } from '../common/platform.js';

export const GLOBAL_BUCKET = '_global';
const BUCKET_HEX_LENGTH = 16;
export const IMPORT_RECORD_PREFIX = 'kma-';
const IMPORT_NAMESPACE = 'kiro-migration-assistant/v1';

/** Same normalization the engine applies before hashing a workspace path. */
export function normalizeWorkspacePath(p, platform = process.platform) {
  const host = platformPath(platform);
  let s = (host.isAbsolute(p) ? p : host.resolve(p)).replace(/\\/g, '/');
  const isUnc = platform === 'win32' && s.startsWith('//');
  s = path.posix.normalize(s);
  if (isUnc && !s.startsWith('//')) s = `/${s}`;
  if (s.length > 1) {
    const trimmed = s.replace(/\/+$/, '');
    if (trimmed.length > 0 && !/^[A-Za-z]:$/.test(trimmed)) s = trimmed;
  }
  return platform === 'win32' ? s.toLowerCase() : s;
}

/** True when two folder paths name the same workspace (case-insensitive and slash-agnostic on Windows). */
export function sameWorkspacePath(a, b, platform = process.platform) {
  if (!a || !b) return false;
  return normalizeWorkspacePath(a, platform) === normalizeWorkspacePath(b, platform);
}

export function bucketFor(cwd, platform = process.platform) {
  if (!cwd) return GLOBAL_BUCKET;
  return crypto.createHash('sha256').update(normalizeWorkspacePath(cwd, platform)).digest('hex').slice(0, BUCKET_HEX_LENGTH);
}

/** Deterministic RFC 4122 v5-style UUID so re-importing a session targets the same Kiro id. */
export function stableUuid(key) {
  const h = crypto.createHash('sha1').update(`${IMPORT_NAMESPACE}:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function kiroSessionIdFor(source, sourceSessionId) {
  return `sess_${stableUuid(`${source}:${sourceSessionId}`)}`;
}

export function sessionDir(kiroDir, bucket, id) {
  return path.join(kiroDir, 'sessions', bucket, id);
}

/**
 * Inspect an existing target. `continuedInKiro` is true when the session holds
 * records this tool did not write, i.e. the user already resumed it in Kiro.
 */
export function inspectExisting(dir) {
  const messagesPath = path.join(dir, 'messages.jsonl');
  if (!isFile(path.join(dir, 'session.json'))) return { exists: false, continuedInKiro: false };
  if (!isFile(messagesPath)) return { exists: true, continuedInKiro: false };
  const continued = readText(messagesPath).split('\n').some((line) => {
    if (!line.trim()) return false;
    try { return !String(JSON.parse(line).id || '').startsWith(IMPORT_RECORD_PREFIX); } catch { return false; }
  });
  return { exists: true, continuedInKiro: continued };
}

function iso(ms) {
  return new Date(ms).toISOString();
}

/**
 * Build the messages.jsonl records for a list of alternating turns. Each
 * assistant turn is wrapped in turn_start/turn_end with its own executionId,
 * which is how the engine groups a model turn.
 */
export function buildRecords(turns, { idSeed, startMs }) {
  const records = [];
  let clock = startMs;
  const nextTs = (t) => {
    clock = Math.max(clock + 1, t || 0);
    return iso(clock);
  };
  turns.forEach((turn, i) => {
    const rid = `${IMPORT_RECORD_PREFIX}${stableUuid(`${idSeed}:${i}`)}`;
    if (turn.role === 'user') {
      records.push({ id: rid, timestamp: nextTs(turn.timestamp), payload: { type: 'user', content: turn.text, documents: [], images: [] } });
      return;
    }
    const exec = stableUuid(`${idSeed}:exec:${i}`);
    records.push({ id: `${rid}-turn-start`, timestamp: nextTs(turn.timestamp), payload: { type: 'turn_start', executionId: exec } });
    records.push({ id: `${rid}-say`, timestamp: nextTs(), payload: { type: 'assistant', content: turn.text, operationType: 'Say', executionId: exec } });
    records.push({ id: `${rid}-turn-end`, timestamp: nextTs(), payload: { type: 'turn_end', stopReason: 'end_turn', executionId: exec } });
  });
  return { records, lastMs: clock };
}

function appendIndex(kiroDir, bucket, id, at) {
  const indexPath = path.join(kiroDir, 'session-index', `${bucket}.jsonl`);
  const sessionPath = `${bucket}/${id}`;
  if (isFile(indexPath) && readText(indexPath).includes(`"sessionPath":"${sessionPath}"`)) return;
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.appendFileSync(indexPath, JSON.stringify({ op: 'add', sessionPath, at }) + '\n');
}

/**
 * Write one session. `turns` must alternate and start with a user turn.
 * Returns the written id/paths. Caller decides overwrite policy beforehand.
 */
export function writeSession({ kiroDir, id, cwd, title, turns, createdAtMs, platform = process.platform }) {
  if (!turns.length || turns[0].role !== 'user') throw new Error('writeSession: turns must start with a user turn');
  const bucket = bucketFor(cwd, platform);
  const dir = sessionDir(kiroDir, bucket, id);
  const startMs = createdAtMs || Date.now();
  const { records, lastMs } = buildRecords(turns, { idSeed: id, startMs });
  const workspacePaths = cwd ? [cwd] : [];
  const previous = readJson(path.join(dir, 'session.json'), null);
  writeAtomic(path.join(dir, 'messages.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeJsonAtomic(path.join(dir, 'session.json'), {
    schemaVersion: '1.0.0',
    dataModelVersion: 1,
    id,
    title: title || 'Imported session',
    agentMode: 'vibe',
    workspacePaths,
    rootPaths: workspacePaths,
    createdAt: previous?.createdAt || iso(startMs),
    lastModifiedAt: iso(lastMs),
    status: 'idle',
  });
  appendIndex(kiroDir, bucket, id, Date.now());
  return { id, bucket, dir, recordCount: records.length };
}
