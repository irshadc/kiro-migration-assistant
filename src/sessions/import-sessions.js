// Session use cases: list foreign sessions, import them into Kiro's V3 store,
// and hand off a live session so `kiro-cli chat --v3 --resume-id` continues it.
import { SESSION_SOURCES, sessionSource } from '../sources/index.js';
import { bucketFor, inspectExisting, kiroSessionIdFor, sessionDir, writeSession } from './kiro-v3-writer.js';
import { fitBudget, toMs, toTurns } from './transcript.js';

/** ~100k tokens: leaves room in every Kiro model's window for the next turns. */
export const DEFAULT_MAX_CHARS = 400_000;
const TITLE_MAX = 120;

export async function listAllSessions(roots, { sources = Object.keys(SESSION_SOURCES), cwd, limit = 20 } = {}) {
  const all = [];
  const errors = [];
  for (const name of sources) {
    try { all.push(...await sessionSource(name).listSessions(roots, { cwd, limit })); } catch (err) {
      errors.push({ source: name, error: err.message });
    }
  }
  all.sort((a, b) => (toMs(b.updatedAt) || 0) - (toMs(a.updatedAt) || 0));
  return { sessions: all.slice(0, limit), errors };
}

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function resumeCommand(kiroId, cwd) {
  const resume = `kiro-cli chat --v3 --resume-id ${kiroId}`;
  return cwd ? `cd ${shellQuote(cwd)} && ${resume}` : resume;
}

/** Turn a read session into the turns that get written (provenance + budget). */
export function prepareTurns({ meta, messages }, { label, maxChars }) {
  const { turns, omitted } = fitBudget(toTurns(messages), maxChars);
  if (!turns.length) return { turns, omitted };
  const note = `[Migrated from ${label} session ${meta.id}${omitted ? `; ${omitted} earlier turns omitted to fit the context budget` : ''}]`;
  const out = turns.map((t) => ({ ...t }));
  if (out[0].role !== 'user') out.unshift({ role: 'user', text: note, timestamp: out[0].timestamp });
  else out[0].text = `${note}\n\n${out[0].text}`;
  if (out[out.length - 1].role === 'user') {
    out.push({ role: 'assistant', text: `[Session moved to Kiro from ${label}. Ready to continue from the last message above.]` });
  }
  return { turns: out, omitted };
}

/**
 * Import one session. Re-importing rewrites the same Kiro id, unless the user
 * already continued that session in Kiro: then it is kept as is, or `fork`
 * writes a fresh copy under a new id.
 */
export async function importSession(roots, { source, id, cwd, maxChars = DEFAULT_MAX_CHARS, fork = false, dryRun = false, now = Date.now() }) {
  const src = sessionSource(source);
  const session = await src.readSession(roots, id);
  const targetCwd = cwd || session.meta.cwd || null;
  const { turns, omitted } = prepareTurns(session, { label: src.label, maxChars });
  if (!turns.length) return { source, id, status: 'empty', message: 'session has no user or assistant text to import' };

  let kiroId = kiroSessionIdFor(source, id);
  const existing = inspectExisting(sessionDir(roots.kiro.dir, bucketFor(targetCwd), kiroId));
  let status = existing.exists ? 'updated' : 'created';
  if (existing.continuedInKiro) {
    if (!fork) {
      return { source, id, kiroSessionId: kiroId, status: 'kept', cwd: targetCwd, resumeCommand: resumeCommand(kiroId, targetCwd),
        message: 'already continued in Kiro; left untouched. Pass fork=true to import a fresh copy.' };
    }
    kiroId = kiroSessionIdFor(source, `${id}#fork-${now}`);
    status = 'forked';
  }
  const result = { source, id, kiroSessionId: kiroId, status, cwd: targetCwd, turns: turns.length, omittedTurns: omitted, title: session.meta.title, resumeCommand: resumeCommand(kiroId, targetCwd) };
  if (dryRun) return { ...result, status: `would-${status === 'forked' ? 'fork' : status === 'created' ? 'create' : 'update'}` };
  writeSession({
    kiroDir: roots.kiro.dir,
    id: kiroId,
    cwd: targetCwd,
    title: (session.meta.title || 'Imported session').slice(0, TITLE_MAX),
    turns,
    createdAtMs: toMs(session.meta.createdAt),
  });
  return result;
}

/** Import many: explicit ids, or the newest `limit` sessions (optionally per cwd). */
export async function importSessions(roots, { source, ids, all = false, cwd, limit = 20, maxChars, fork, dryRun }) {
  let targets = ids || [];
  if (all) targets = (await sessionSource(source).listSessions(roots, { cwd, limit })).map((s) => s.id);
  if (!targets.length) throw new Error('nothing to import: pass ids, or all=true');
  const results = [];
  for (const id of targets) {
    try { results.push(await importSession(roots, { source, id, maxChars, fork, dryRun })); } catch (err) {
      results.push({ source, id, status: 'error', message: err.message });
    }
  }
  return results;
}

/**
 * Live handoff: import (or refresh) the given session, or the most recently
 * active one for `cwd`, and return the command that resumes it in Kiro.
 */
export async function handoffSession(roots, { source, id, cwd, maxChars, fork }) {
  let sessionId = id;
  if (!sessionId) {
    const [latest] = await sessionSource(source).listSessions(roots, { cwd, limit: 1 });
    if (!latest) throw new Error(`no ${source} session found${cwd ? ` for ${cwd}` : ''}`);
    sessionId = latest.id;
  }
  return importSession(roots, { source, id: sessionId, cwd, maxChars, fork });
}
