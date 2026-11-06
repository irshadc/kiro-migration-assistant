// End-to-end against a real, logged-in kiro-cli (V3 engine). Opt-in:
//   npm run test:e2e        (any OS)
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
import { applyConfigPlan, planConfigMigration } from '../../src/config/migrate-config.js';
import { bucketFor } from '../../src/sessions/kiro-v3-writer.js';
import { importSession, importSessions } from '../../src/sessions/import-sessions.js';
import { makeFixture } from '../helpers/fixtures.js';

// npm sets npm_lifecycle_event on every OS, so the npm script needs no shell-specific VAR=1 prefix.
const ENABLED = process.env.KMA_E2E === '1' || process.env.npm_lifecycle_event === 'test:e2e';
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
  return { fx, roots: { ...fx.roots, kiro: { dir: KIRO_DIR } } };
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
  const fx = makeFixture();
  t.after(() => { removeBucket(fx.ws); fx.cleanup(); });
  const kiroWs = path.join(fx.ws, '.kiro');
  fs.mkdirSync(path.join(kiroWs, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(kiroWs, 'settings', 'mcp.json'), JSON.stringify({ mcpServers: {
    'kiro-migration-assistant': { command: process.execPath, args: [path.join(REPO, 'src', 'server.js')], env: { HOME: fx.home } },
  } }));
  fs.cpSync(path.join(REPO, 'skills'), path.join(kiroWs, 'skills'), { recursive: true });
  kiro(fx.ws, [`Use the kiro-migration-assistant skill: hand off my most recent Claude Code session for the directory ${fx.ws} into Kiro, then reply with only the resume command.`]);
  const expected = path.join(fx.roots.kiro.dir, 'sessions', bucketFor(fx.ws));
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
      env: { HOME: fx.home } },
  } }));
  fs.cpSync(path.join(REPO, 'skills'), path.join(kiroWs, 'skills'), { recursive: true });
  kiro(fx.ws, ['Use the kiro-migration-assistant skill and follow its guided migration workflow for this project. '
    + 'I want everything: all installed tools, every new item, and my 5 most recent sessions. '
    + 'I pick everything you suggest in advance; keep Kiro\'s version of anything already there. Reply with a short summary.']);
  assert.ok(fs.existsSync(path.join(fixtureKiro, 'agents', 'reviewer.json')), 'agent migrated');
  assert.ok(fs.existsSync(path.join(fixtureKiro, 'settings', 'mcp.json')), 'MCP servers migrated');
  const bucket = path.join(fixtureKiro, 'sessions', bucketFor(fx.ws));
  assert.equal(fs.readdirSync(bucket).filter((d) => d.startsWith('sess_')).length, 5, '5 sessions imported under the project folder');
});

test('a "kma: preview all" prompt shows scanned folders and reads a relocated tool', { skip: !ENABLED, timeout: TIMEOUT_MS * 2 }, async (t) => {
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
      env: { HOME: fx.home } },
  } }));
  fs.cpSync(path.join(REPO, 'skills'), path.join(kiroWs, 'skills'), { recursive: true });
  kiro(fx.ws, [`kma: preview all; change nothing. My Claude Code data is in ${moved}. `
    + 'Show the table of tools with the folders you read from, then stop.']);
  const bucket = path.join(KIRO_DIR, 'sessions', bucketFor(fx.ws));
  const out = fs.readdirSync(bucket).filter((d) => d.startsWith('sess_'))
    .flatMap((d) => assistantSays(path.join(bucket, d, 'messages.jsonl'))).join('\n');
  // The agent may shorten long temp paths with "...", so match the path's tail.
  assert.ok(out.includes('elsewhere/claude-data'), `reply shows the relocated folder. Reply was:\n${out.slice(0, 3000)}`);
  assert.ok(!fs.existsSync(path.join(fixtureKiro, 'agents')), 'preview wrote nothing');
});


test('default kma asks one source decision and writes nothing', { skip: !ENABLED, timeout: TIMEOUT_MS * 2 }, async (t) => {
  const fx = makeFixture();
  t.after(() => { removeBucket(fx.ws); fx.cleanup(); });
  const fixtureKiro = path.join(fx.home, '.kiro');
  const kiroWs = path.join(fx.ws, '.kiro');
  fs.mkdirSync(path.join(kiroWs, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(kiroWs, 'settings', 'mcp.json'), JSON.stringify({ mcpServers: {
    'kiro-migration-assistant': { command: process.execPath, args: [path.join(REPO, 'src', 'server.js')],
      env: { HOME: fx.home } },
  } }));
  fs.cpSync(path.join(REPO, 'skills'), path.join(kiroWs, 'skills'), { recursive: true });
  kiro(fx.ws, ['kma. Start the guided migration. I have not approved any source or change yet.']);
  const bucket = path.join(KIRO_DIR, 'sessions', bucketFor(fx.ws));
  const reply = fs.readdirSync(bucket).filter((d) => d.startsWith('sess_'))
    .flatMap((d) => assistantSays(path.join(bucket, d, 'messages.jsonl'))).join('\n');
  assert.match(reply, /Claude Code/i);
  assert.match(reply, /use|skip/i);
  assert.doesNotMatch(reply, /Cursor[\s\S]*Codex|Codex[\s\S]*Cursor/i, `reply combined later sources:\n${reply.slice(0, 3000)}`);
  assert.ok(!fs.existsSync(path.join(fixtureKiro, 'agents')), 'guided first turn wrote no agents');
  assert.ok(!fs.existsSync(path.join(fixtureKiro, 'sessions')), 'guided first turn imported no sessions');
});


test('Kiro agent preserves an existing item and renames a global incoming conflict', { skip: !ENABLED, timeout: TIMEOUT_MS * 2 }, async (t) => {
  const fx = makeFixture();
  t.after(() => { removeBucket(fx.ws); fx.cleanup(); });
  const fixtureKiro = path.join(fx.home, '.kiro');
  const kiroWs = path.join(fx.ws, '.kiro');
  fs.mkdirSync(path.join(kiroWs, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(kiroWs, 'settings', 'mcp.json'), JSON.stringify({ mcpServers: {
    'kiro-migration-assistant': { command: process.execPath, args: [path.join(REPO, 'src', 'server.js')],
      env: { HOME: fx.home } },
  } }));
  fs.cpSync(path.join(REPO, 'skills'), path.join(kiroWs, 'skills'), { recursive: true });
  const existing = path.join(fixtureKiro, 'agents', 'reviewer.md');
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  fs.writeFileSync(existing, 'existing Kiro agent\n');
  kiro(fx.ws, ['Use the KMA skill. Copy only the global Claude Code agent named reviewer. '
    + 'Keep the existing Kiro reviewer unchanged and rename the incoming agent to reviewer-from-claude. '
    + 'Skip project settings and sessions. I approve this exact plan; apply it and reply briefly.']);
  assert.equal(fs.readFileSync(existing, 'utf-8'), 'existing Kiro agent\n');
  assert.ok(fs.existsSync(path.join(fixtureKiro, 'agents', 'reviewer-from-claude.json')), 'renamed incoming agent created');
  assert.ok(!fs.existsSync(path.join(kiroWs, 'agents')), 'workspace agents were not migrated');
});


test('all generated source agents validate as current Kiro JSON', { skip: !ENABLED, timeout: TIMEOUT_MS }, (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, { sources: ['claude-code', 'cursor', 'codex'], kinds: ['agent'], workspace: fx.ws });
  const applied = applyConfigPlan(plan).filter((entry) => entry.applied);
  assert.equal(applied.length, 6);
  for (const entry of applied) {
    assert.match(entry.target, /\.json$/);
    execFileSync('kiro-cli', ['agent', 'validate', '--path', entry.target], { encoding: 'utf-8', timeout: TIMEOUT_MS });
  }
});
