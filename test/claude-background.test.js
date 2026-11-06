import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { encodeProjectDir, listSessionsWithHidden } from '../src/sources/claude-code/sessions.js';
import { importSessions, listAllSessions } from '../src/sessions/import-sessions.js';
import { T0, makeFixture } from './helpers/fixtures.js';

const BG = '/Users/me/workplace/kirocrew-workspace/_bg';
const CONSOLIDATE = '/Users/me/workplace/kirocrew-workspace/_consolidate';
const CDE = '/Users/me/Documents/agentcrew/CDE';
const PW = '/Users/me/PhysicsWallah';

function session(fx, cwd, id, records, mtime) {
  const file = path.join(fx.roots.claude.projectsDir, encodeProjectDir(cwd), `${id}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.utimesSync(file, mtime / 1000, mtime / 1000);
}

const chat = (cwd, entrypoint, prompt) => [
  { type: 'user', cwd, entrypoint, userType: 'external', isSidechain: false, timestamp: '2026-11-06T08:00:00Z', message: { role: 'user', content: prompt } },
  { type: 'assistant', cwd, entrypoint, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
];

function seed(fx) {
  session(fx, CONSOLIDATE, 'consolidate', chat(CONSOLIDATE, 'sdk-ts', 'You are a memory consolidation agent. Process this conversation'), T0 + 9000);
  session(fx, BG, 'naming', chat(BG, 'sdk-ts', 'You are a session naming agent.'), T0 + 8000);
  session(fx, CDE, 'suggest', chat(CDE, 'sdk-ts', 'You are generating contextual prompt suggestions for'), T0 + 7000);
  session(fx, CDE, 'cde', chat(CDE, 'sdk-ts', '[marker-removed] You are Kiro 👻 -- powered by Kiro Crew'), T0 + 6000);
  session(fx, PW, 'stub', [{ type: 'cost-state' }, { type: 'mode', mode: 'default' }, { type: 'system', content: 'init' }], T0 + 5000);
  session(fx, PW, 'login', [
    { type: 'user', cwd: PW, entrypoint: 'cli', message: { role: 'user', content: '<local-command-stdout>Login interrupted</local-command-stdout>' } },
    { type: 'user', cwd: PW, entrypoint: 'cli', message: { role: 'user', content: 'Explain projectile motion' } },
  ], T0 + 4000);
  // A typed session is human even when its prompt reads like a job.
  session(fx, PW, 'cli-job-text', chat(PW, 'cli', 'You are a session naming agent, pretend'), T0 + 3500);
}

test('claude-code: hides Kiro Crew background jobs and empty stubs by default', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  seed(fx);
  const { sessions, hidden } = await listSessionsWithHidden(fx.roots, { limit: 20 });
  assert.deepEqual(sessions.map((s) => s.id), ['cde', 'login', 'cli-job-text', 'claude-s1', 'claude-s0']);
  assert.deepEqual(hidden, { background: 3, empty: 1 });
  assert.equal(sessions.find((s) => s.id === 'login').title, 'Explain projectile motion');
});

test('claude-code: includeBackground lists every session', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  seed(fx);
  const { sessions, hidden } = await listSessionsWithHidden(fx.roots, { limit: 20, includeBackground: true });
  assert.equal(sessions.length, 9);
  assert.deepEqual(hidden, { background: 0, empty: 0 });
});

test('claude-code: a full limit is returned when background sessions are newest', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  for (let i = 0; i < 25; i++) session(fx, CDE, `job-${i}`, chat(CDE, 'sdk-ts', 'You are a session naming agent.'), T0 + 100000 + i);
  for (let i = 0; i < 25; i++) session(fx, BG, `bg-${i}`, chat(BG, 'sdk-ts', 'anything'), T0 + 200000 + i);
  for (let i = 0; i < 30; i++) session(fx, CDE, `human-${i}`, chat(CDE, 'sdk-ts', `task ${i}`), T0 + 50000 + i);
  const { sessions, hidden } = await listSessionsWithHidden(fx.roots, { limit: 20 });
  assert.equal(sessions.length, 20);
  assert.ok(sessions.every((s) => s.id.startsWith('human-')));
  assert.deepEqual(hidden, { background: 50, empty: 0 });
});

test('list_sessions and import all=true skip background jobs; import by id does not', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  seed(fx);
  const all = await listAllSessions(fx.roots, { sources: ['claude-code'] });
  assert.equal(all.hiddenBackground, 3);
  assert.equal(all.hiddenEmpty, 1);
  assert.ok(!all.sessions.some((s) => ['consolidate', 'naming', 'suggest', 'stub'].includes(s.id)));

  const bulk = await importSessions(fx.roots, { source: 'claude-code', all: true, dryRun: true });
  assert.ok(!bulk.some((r) => ['consolidate', 'naming', 'suggest', 'stub'].includes(r.id)));

  const [byId] = await importSessions(fx.roots, { source: 'claude-code', ids: ['naming'], dryRun: true });
  assert.notEqual(byId.status, 'error');
});
