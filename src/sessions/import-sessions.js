// Session use cases: list foreign sessions, import them into Kiro's V3 store,
// and hand off a live session so `kiro-cli chat --v3 --resume-id` continues it.
import { DEFAULT_SESSION_SOURCES, sessionSource } from '../sources/index.js';
import { bucketFor, inspectExisting, kiroSessionIdFor, sessionDir, writeSession } from './kiro-v3-writer.js';
import { inDirectory } from '../common/platform.js';
import { fitBudget, toMs, toTurns } from './transcript.js';

/** ~100k tokens: leaves room in every Kiro model's window for the next turns. */
export const DEFAULT_MAX_CHARS = 400_000;
const TITLE_MAX = 120;

/**
 * One source's sessions plus what it hid. Only Claude Code hides sessions
 * (Kiro Crew background jobs, empty stubs); other sources report none.
 */
export async function listSourceSessions(roots, name, options) {
  const src = sessionSource(name);
  if (src.listSessionsWithHidden) return src.listSessionsWithHidden(roots, options);
  return { sessions: await src.listSessions(roots, options), hidden: { background: 0, empty: 0 } };
}

export async function listAllSessions(roots, { sources = DEFAULT_SESSION_SOURCES, cwd, limit = 20, includeBackground = false } = {}) {
  const all = [];
  const errors = [];
  let hiddenBackground = 0;
  let hiddenEmpty = 0;
  for (const name of sources) {
    try {
      const { sessions, hidden } = await listSourceSessions(roots, name, { cwd, limit, includeBackground });
      all.push(...sessions);
      hiddenBackground += hidden.background;
      hiddenEmpty += hidden.empty;
    } catch (err) {
      errors.push({ source: name, error: err.message });
    }
  }
  all.sort((a, b) => (toMs(b.updatedAt) || 0) - (toMs(a.updatedAt) || 0));
  return { sessions: all.slice(0, limit), errors, hiddenBackground, hiddenEmpty };
}

/** The terminal command that resumes `kiroId` from `cwd`, in the user's default shell. */
export function resumeCommand(kiroId, cwd, platform = process.platform) {
  const resume = `kiro-cli chat --v3 --resume-id ${kiroId}`;
  return cwd ? inDirectory(cwd, resume, platform) : resume;
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
export async function importSession(roots, { source, id, cwd, fallbackCwd, maxChars = DEFAULT_MAX_CHARS, fork = false, dryRun = false, now = Date.now() }) {
  const src = sessionSource(source);
  const session = await src.readSession(roots, id);
  const targetCwd = cwd || session.meta.cwd || fallbackCwd || null;
  const { turns, omitted } = prepareTurns(session, { label: src.label, maxChars });
  if (!turns.length) return { source, id, status: 'empty', message: 'session has no user or assistant text to import' };

  let kiroId = kiroSessionIdFor(source, id);
  const existing = inspectExisting(sessionDir(roots.kiro.dir, bucketFor(targetCwd), kiroId));
  let status = existing.exists ? 'updated' : 'created';
  if (existing.continuedInKiro) {
    if (!fork) {
      return { source, id, kiroSessionId: kiroId, status: 'kept', cwd: targetCwd, resumeCommand: resumeCommand(kiroId, targetCwd, roots.platform),
        message: 'already continued in Kiro; left untouched. Pass fork=true to import a fresh copy.' };
    }
    kiroId = kiroSessionIdFor(source, `${id}#fork-${now}`);
    status = 'forked';
  }
  const result = { source, id, kiroSessionId: kiroId, status, cwd: targetCwd, turns: turns.length, omittedTurns: omitted, title: session.meta.title, resumeCommand: resumeCommand(kiroId, targetCwd, roots.platform) };
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

/**
 * Import many: explicit ids from one source, or with all=true the newest
 * `limit` sessions (from `source`, or across every source when it is omitted).
 */
export async function importSessions(roots, { source, ids, all = false, cwd, fallbackCwd, limit = 20, includeBackground = false, maxChars, fork, dryRun }) {
  let targets;
  if (all) {
    const listed = source
      ? (await listSourceSessions(roots, source, { cwd, limit, includeBackground })).sessions
      : (await listAllSessions(roots, { cwd, limit, includeBackground })).sessions;
    targets = listed.map((s) => ({ source: s.source, id: s.id }));
  } else {
    if (ids?.length && !source) throw new Error('source is required when importing by ids');
    targets = (ids || []).map((id) => ({ source, id }));
  }
  if (!targets.length) throw new Error('nothing to import: pass source + ids, or all=true');
  const results = [];
  for (const t of targets) {
    try { results.push(await importSession(roots, { ...t, fallbackCwd, maxChars, fork, dryRun })); } catch (err) {
      results.push({ ...t, status: 'error', message: err.message });
    }
  }
  return results;
}

/**
 * Live handoff: import (or refresh) the given session, or the most recently
 * active one for `cwd`, and return the command that resumes it in Kiro.
 */
export async function handoffSession(roots, { source, id, cwd, fallbackCwd, maxChars, fork }) {
  let sessionId = id;
  if (!sessionId) {
    // Unfiltered: the caller named this folder, so take whatever ran there last.
    const [latest] = await sessionSource(source).listSessions(roots, { cwd, limit: 1, includeBackground: true });
    if (!latest) throw new Error(`no ${source} session found${cwd ? ` for ${cwd}` : ''}`);
    sessionId = latest.id;
  }
  return importSession(roots, { source, id: sessionId, cwd, fallbackCwd, maxChars, fork });
}
