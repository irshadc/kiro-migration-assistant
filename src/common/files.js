// Small filesystem helpers shared by every source adapter and writer.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';

export function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

export function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
}

export function readText(p) {
  return fs.readFileSync(p, 'utf-8');
}

/** Read JSON; a missing file returns `fallback`, a malformed one throws with the path. */
export function readJson(p, fallback = undefined) {
  if (!isFile(p)) return fallback;
  try {
    return JSON.parse(readText(p));
  } catch (err) {
    throw new Error(`Invalid JSON in ${p}: ${err.message}`);
  }
}

/** Write via temp file + rename so a crash never leaves a half-written target. */
export function writeAtomic(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, p);
}

export function writeJsonAtomic(p, value) {
  writeAtomic(p, JSON.stringify(value, null, 2) + '\n');
}

/** Stream a JSONL file line by line; malformed lines are skipped and counted. */
export async function* readJsonl(p) {
  const stream = fs.createReadStream(p, { encoding: 'utf-8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line); } catch { /* partial line from a live writer */ }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Read only the first `maxLines` JSONL records (cheap metadata peek). */
export async function peekJsonl(p, maxLines) {
  const out = [];
  for await (const rec of readJsonl(p)) {
    out.push(rec);
    if (out.length >= maxLines) break;
  }
  return out;
}

export function mtimeMs(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

/** Copy a directory tree (files only, symlinks resolved). Returns copied relative paths. */
export function copyDir(src, dest) {
  const copied = [];
  const walk = (rel) => {
    for (const entry of listDir(path.join(src, rel))) {
      const childRel = path.join(rel, entry.name);
      const from = path.join(src, childRel);
      if (isDir(from)) walk(childRel);
      else if (isFile(from)) {
        fs.mkdirSync(path.dirname(path.join(dest, childRel)), { recursive: true });
        fs.copyFileSync(from, path.join(dest, childRel));
        copied.push(childRel);
      }
    }
  };
  walk('');
  return copied;
}
