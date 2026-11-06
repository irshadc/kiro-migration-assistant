// End-to-end against a real, logged-in kiro-cli (V3 engine). Opt-in:
//   KMA_E2E=1 node --test test/e2e/
// Source data comes from the fixture home; sessions are written to the REAL
// ~/.kiro under a bucket unique to the fixture workspace, removed afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRoots } from '../../src/roots.js';
import { bucketFor } from '../../src/sessions/kiro-v3-writer.js';
import { importSession, importSessions } from '../../src/sessions/import-sessions.js';
import { makeFixture } from '../helpers/fixtures.js';

const ENABLED = process.env.KMA_E2E === '1';
const KIRO_DIR = path.join(os.homedir(), '.kiro');
const TIMEOUT_MS = 240_000;
const REPO = fileURLToPath(new URL('../..', import.meta.url));

function kiro(cwd, args) {
  return execFileSync('kiro-cli', ['chat', '--v3', '--no-interactive', '--trust-all-tools', ...args], { cwd, encoding: 'utf-8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
}

function assistantSays(file) {
  return fs.readFileSync(file, 'utf-8').trim().split('\n').map(JSON.parse)
    .filter((r) => r.payload?.type === 'assistant' && r.payload.operationType === 'Say').map((r) => r.payload.content);
}

/** Remove everything this test wrote to the real ~/.kiro: one bucket dir + its index file. */
function removeBucket(cwd) {
  const bucket = bucketFor(cwd);
  fs.rmSync(path.join(KIRO_DIR, 'sessions', bucket), { recursive: true, force: true });
  fs.rmSync(path.join(KIRO_DIR, 'session-index', `${bucket}.jsonl`), { force: true });
}

function fixtureWithRealKiro() {
  const fx = makeFixture();
  const env = { KMA_CURSOR_USER_DIR: path.join(fx.home, 'CursorUser'), KMA_KIRO_DIR: KIRO_DIR };
  return { fx, env, roots: resolveRoots({ home: fx.home, env }) };
}

test('kiro-cli --v3 resumes an imported Claude Code session with its context', { skip: !ENABLED, timeout: TIMEOUT_MS * 2 }, async (t) => {
  const { fx, roots } = fixtureWithRealKiro();
  t.after(() => { removeBucket(fx.ws); fx.cleanup(); });
  const res = await importSession(roots, { source: 'claude-code', id: 'claude-s1' });
  assert.equal(res.status, 'created');
  kiro(fx.ws, ['--resume-id', res.kiroSessionId, 'Answer only from our conversation, no tools: which function had the bug and what kind of bug was it?']);
  const file = path.join(KIRO_DIR, 'sessions', bucketFor(fx.ws), res.kiroSessionId, 'messages.jsonl');
  const reply = assistantSays(file).at(-1);
  assert.match(reply, /add/i);
  assert.match(reply, /off.by.one/i);
});

test('a Kiro agent uses the skill + MCP server to hand off a session', { skip: !ENABLED, timeout: TIMEOUT_MS * 2 }, async (t) => {
  const { fx, env } = fixtureWithRealKiro();
  t.after(() => { removeBucket(fx.ws); fx.cleanup(); });
  const kiroWs = path.join(fx.ws, '.kiro');
  fs.mkdirSync(path.join(kiroWs, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(kiroWs, 'settings', 'mcp.json'), JSON.stringify({ mcpServers: {
    'kiro-migration-assistant': { command: process.execPath, args: [path.join(REPO, 'src', 'server.js')], env: { HOME: fx.home, ...env } },
  } }));
  fs.cpSync(path.join(REPO, 'skills'), path.join(kiroWs, 'skills'), { recursive: true });
  kiro(fx.ws, [`Use the kiro-migration-assistant skill: hand off my most recent Claude Code session for the directory ${fx.ws} into Kiro, then reply with only the resume command.`]);
  const expected = path.join(KIRO_DIR, 'sessions', bucketFor(fx.ws));
  const imported = fs.readdirSync(expected).filter((d) => d.startsWith('sess_')).map((d) => path.join(expected, d, 'messages.jsonl'))
    .filter((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf-8').includes('Migrated from Claude Code session claude-s1'));
  assert.equal(imported.length, 1, 'the agent imported the fixture session through the MCP tool');
});

test('imported sessions (including folder-less ones) show in kiro-cli --list-sessions', { skip: !ENABLED, timeout: TIMEOUT_MS }, async (t) => {
  const { fx, roots } = fixtureWithRealKiro();
  t.after(() => { removeBucket(fx.ws); fx.cleanup(); });
  const results = await importSessions(roots, { all: true, limit: 5, fallbackCwd: fx.ws });
  assert.ok(results.every((r) => r.status === 'created'), JSON.stringify(results));
  assert.ok(results.some((r) => r.source === 'cursor-agent' && r.id === 'c1'), 'includes the folder-less Cursor Agent chat');
  const out = execFileSync('kiro-cli', ['chat', '--v3', '--list-sessions', '--format', 'json'], { cwd: fx.ws, encoding: 'utf-8', timeout: TIMEOUT_MS });
  const listed = new Set(JSON.parse(out).flatMap((e) => e.sessions.map((s) => s.sessionId)));
  for (const r of results) assert.ok(listed.has(r.kiroSessionId), `${r.source}/${r.id} listed`);
});

test('a Kiro agent runs the guided migration from the README prompt', { skip: !ENABLED, timeout: TIMEOUT_MS * 2 }, async (t) => {
  // Config and sessions go to a fixture Kiro dir here; only kiro-cli's own chat session lands in the real ~/.kiro.
  const fx = makeFixture();
  t.after(() => { removeBucket(fx.ws); fx.cleanup(); });
  const fixtureKiro = path.join(fx.home, '.kiro');
  const kiroWs = path.join(fx.ws, '.kiro');
  fs.mkdirSync(path.join(kiroWs, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(kiroWs, 'settings', 'mcp.json'), JSON.stringify({ mcpServers: {
    'kiro-migration-assistant': { command: process.execPath, args: [path.join(REPO, 'src', 'server.js')],
      env: { HOME: fx.home, KMA_CURSOR_USER_DIR: path.join(fx.home, 'CursorUser'), KMA_KIRO_DIR: fixtureKiro } },
  } }));
  fs.cpSync(path.join(REPO, 'skills'), path.join(kiroWs, 'skills'), { recursive: true });
  kiro(fx.ws, ['Use the kiro-migration-assistant skill and follow its guided migration workflow for this project. '
    + 'I want everything: all installed tools, every new item, and my 5 most recent sessions. '
    + 'I pick everything you suggest in advance; keep Kiro\'s version of anything already there. Reply with a short summary.']);
  assert.ok(fs.existsSync(path.join(fixtureKiro, 'agents', 'reviewer.md')), 'agent migrated');
  assert.ok(fs.existsSync(path.join(fixtureKiro, 'settings', 'mcp.json')), 'MCP servers migrated');
  const bucket = path.join(fixtureKiro, 'sessions', bucketFor(fx.ws));
  assert.equal(fs.readdirSync(bucket).filter((d) => d.startsWith('sess_')).length, 5, '5 sessions imported under the project folder');
});

test('a "kma:" prompt runs the skill, shows scanned folders and reads a relocated tool', { skip: !ENABLED, timeout: TIMEOUT_MS * 2 }, async (t) => {
  const fx = makeFixture();
  t.after(() => { removeBucket(fx.ws); fx.cleanup(); });
  const moved = path.join(fx.base, 'elsewhere', 'claude-data');
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  fs.renameSync(path.join(fx.home, '.claude'), moved);
  const fixtureKiro = path.join(fx.home, '.kiro');
  const kiroWs = path.join(fx.ws, '.kiro');
  fs.mkdirSync(path.join(kiroWs, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(kiroWs, 'settings', 'mcp.json'), JSON.stringify({ mcpServers: {
    'kiro-migration-assistant': { command: process.execPath, args: [path.join(REPO, 'src', 'server.js')],
      env: { HOME: fx.home, KMA_CURSOR_USER_DIR: path.join(fx.home, 'CursorUser'), KMA_KIRO_DIR: fixtureKiro } },
  } }));
  fs.cpSync(path.join(REPO, 'skills'), path.join(kiroWs, 'skills'), { recursive: true });
  kiro(fx.ws, [`kma: preview only, change nothing. My Claude Code data is in ${moved}. `
    + 'Show the table of tools with the folders you read from, then stop.']);
  const bucket = path.join(KIRO_DIR, 'sessions', bucketFor(fx.ws));
  const out = fs.readdirSync(bucket).filter((d) => d.startsWith('sess_'))
    .flatMap((d) => assistantSays(path.join(bucket, d, 'messages.jsonl'))).join('\n');
  // The agent may shorten long temp paths with "...", so match the path's tail.
  assert.ok(out.includes('elsewhere/claude-data'), `reply shows the relocated folder. Reply was:\n${out.slice(0, 3000)}`);
  assert.match(out, /Reading from/i);
  assert.ok(!fs.existsSync(path.join(fixtureKiro, 'agents')), 'preview wrote nothing');
});
