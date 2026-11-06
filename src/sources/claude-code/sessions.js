// Claude Code sessions: <claude>/projects/<encoded-cwd>/<sessionId>.jsonl
// Each line is { type: 'user'|'assistant'|'summary'|..., message, cwd, timestamp,
// isSidechain, isMeta }. Assistant content blocks: text | thinking | tool_use.
// User content blocks may carry tool_result entries.
import path from 'node:path';
import { isDir, isFile, listDir, mtimeMs, peekJsonl, readJsonl } from '../../common/files.js';
import { cleanUserText, contentToText } from '../../sessions/transcript.js';
import { normalizeWorkspacePath } from '../../sessions/kiro-v3-writer.js';
import { isWindows } from '../../common/platform.js';

export const SOURCE = 'claude-code';
const PEEK_LINES = 40;
const TITLE_MAX = 120;

// Kiro Crew runs its background passes (memory consolidation, session naming,
// prompt suggestions) through the Claude Code SDK from internal folders named
// kirocrew-workspace/_<job>. '_' encodes to '-', so the project dir holds '--'.
const BACKGROUND_PROJECT_DIR = /kirocrew-workspace--/;
const BACKGROUND_CWD = /kirocrew-workspace[\\/]_/;
// Fallback for job sessions outside those folders; update if Kiro Crew rewords them.
const BACKGROUND_PROMPTS = [
  'You are a memory consolidation agent',
  'You are a session naming agent',
  'You are generating contextual prompt suggestions',
];
// A typed `claude` session; SDK sessions ('sdk-ts') can be either kind.
const HUMAN_ENTRYPOINT = 'cli';
const CONVERSATION_TYPES = new Set(['user', 'assistant']);

export function isBackgroundProjectDir(projectDir) {
  return BACKGROUND_PROJECT_DIR.test(projectDir);
}

/** Claude encodes a project cwd by replacing every non-alphanumeric char with '-'. */
export function encodeProjectDir(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function sessionFiles(roots) {
  const files = [];
  for (const proj of listDir(roots.claude.projectsDir)) {
    const dir = path.join(roots.claude.projectsDir, proj.name);
    if (!isDir(dir)) continue;
    for (const f of listDir(dir)) {
      if (f.name.endsWith('.jsonl')) files.push({ id: f.name.slice(0, -6), file: path.join(dir, f.name), projectDir: proj.name });
    }
  }
  return files;
}

function firstUserText(records) {
  for (const r of records) {
    if (r.type !== 'user' || r.isMeta || r.isSidechain) continue;
    const text = cleanUserText(contentToText(
      Array.isArray(r.message?.content) ? r.message.content.filter((c) => c.type === 'text') : r.message?.content,
    ));
    if (text && !text.startsWith('<command-') && !text.startsWith('<local-command-')) return text;
  }
  return null;
}

function metaFrom(entry, head) {
  const cwd = head.find((r) => r.cwd)?.cwd || null;
  const summary = head.find((r) => r.type === 'summary' && r.summary)?.summary;
  const firstTs = head.find((r) => r.timestamp)?.timestamp;
  const title = (summary || firstUserText(head) || 'Claude Code session').replace(/\s+/g, ' ').slice(0, TITLE_MAX);
  return {
    source: SOURCE,
    id: entry.id,
    title,
    cwd,
    createdAt: firstTs ? Date.parse(firstTs) : null,
    updatedAt: mtimeMs(entry.file),
    path: entry.file,
  };
}

async function describe(entry) {
  return metaFrom(entry, await peekJsonl(entry.file, PEEK_LINES));
}

/**
 * 'human', 'background' (a Kiro Crew job) or 'empty' (no conversation at all).
 * `head` is the first PEEK_LINES records of the file.
 */
export function classifySession(head, cwd) {
  const hasConversation = head.some((r) => CONVERSATION_TYPES.has(r.type) && r.message);
  // Only a file shorter than the peek is known to hold no conversation.
  if (!hasConversation && head.length < PEEK_LINES) return 'empty';
  if (head.find((r) => r.entrypoint)?.entrypoint === HUMAN_ENTRYPOINT) return 'human';
  if (cwd && BACKGROUND_CWD.test(cwd)) return 'background';
  const first = firstUserText(head);
  if (first && BACKGROUND_PROMPTS.some((p) => first.startsWith(p))) return 'background';
  return 'human';
}

/**
 * Sessions newest first, plus how many were hidden. Kiro Crew background jobs
 * and empty stubs are hidden unless includeBackground is true. Stats every file
 * but parses only as many as it takes to fill `limit`.
 */
export async function listSessionsWithHidden(roots, { cwd, limit = 50, includeBackground = false } = {}) {
  let entries = sessionFiles(roots).map((e) => ({ ...e, mtime: mtimeMs(e.file) }));
  if (cwd) {
    // Normalizing first makes the Windows match case-insensitive (it lowercases) and ignores a trailing slash.
    const encoded = encodeProjectDir(normalizeWorkspacePath(cwd, roots.platform));
    const key = (dir) => (isWindows(roots.platform) ? dir.toLowerCase() : dir);
    entries = entries.filter((e) => key(e.projectDir) === encoded);
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  if (includeBackground) {
    return { sessions: await Promise.all(entries.slice(0, limit).map(describe)), hidden: { background: 0, empty: 0 } };
  }
  // Folder matches are known from the name alone, so they never cost a read.
  const hidden = { background: 0, empty: 0 };
  const candidates = entries.filter((e) => {
    if (!isBackgroundProjectDir(e.projectDir)) return true;
    hidden.background++;
    return false;
  });
  const sessions = [];
  let next = 0;
  while (sessions.length < limit && next < candidates.length) {
    const batch = candidates.slice(next, next + limit - sessions.length);
    next += batch.length;
    const read = await Promise.all(batch.map(async (e) => {
      const head = await peekJsonl(e.file, PEEK_LINES);
      const meta = metaFrom(e, head);
      return { meta, kind: classifySession(head, meta.cwd) };
    }));
    for (const { meta, kind } of read) {
      if (kind === 'human') sessions.push(meta);
      else hidden[kind]++;
    }
  }
  return { sessions, hidden };
}

export async function listSessions(roots, options) {
  return (await listSessionsWithHidden(roots, options)).sessions;
}

export function findSessionFile(roots, id) {
  return sessionFiles(roots).find((e) => e.id === id) || null;
}

/** Parse a full session into the neutral transcript model. */
export async function readSession(roots, id) {
  const entry = findSessionFile(roots, id);
  if (!entry || !isFile(entry.file)) throw new Error(`Claude Code session not found: ${id}`);
  const meta = await describe(entry);
  const messages = [];
  const toolNames = new Map();
  for await (const r of readJsonl(entry.file)) {
    if (r.isSidechain || r.isMeta || !r.message) continue;
    const ts = r.timestamp ? Date.parse(r.timestamp) : undefined;
    const content = r.message.content;
    if (r.type === 'assistant') {
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: contentToText(content) }];
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const toolCalls = blocks.filter((b) => b.type === 'tool_use').map((b) => {
        toolNames.set(b.id, b.name);
        return { id: b.id, name: b.name, input: b.input };
      });
      messages.push({ role: 'assistant', text, toolCalls, timestamp: ts });
    } else if (r.type === 'user') {
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: contentToText(content) }];
      const toolResults = blocks.filter((b) => b.type === 'tool_result').map((b) => ({
        id: b.tool_use_id, name: toolNames.get(b.tool_use_id), output: b.content, isError: Boolean(b.is_error),
      }));
      const text = contentToText(blocks.filter((b) => b.type === 'text' || b.type === 'image'));
      messages.push({ role: 'user', text, toolResults, timestamp: ts });
    }
  }
  return { meta, messages };
}
