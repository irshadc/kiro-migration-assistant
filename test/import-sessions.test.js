import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bucketFor, kiroSessionIdFor } from '../src/sessions/kiro-v3-writer.js';
import { handoffSession, importSession, importSessions, listAllSessions, prepareTurns, resumeCommand } from '../src/sessions/import-sessions.js';
import { makeFixture } from './helpers/fixtures.js';

function records(fx, cwd, id) {
  const file = path.join(fx.roots.kiro.dir, 'sessions', bucketFor(cwd), id, 'messages.jsonl');
  return fs.readFileSync(file, 'utf-8').trim().split('\n').map(JSON.parse);
}

test('listAllSessions merges every source newest first', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const { sessions, errors } = await listAllSessions(fx.roots, { limit: 50 });
  assert.deepEqual(errors, []);
  assert.deepEqual(new Set(sessions.map((s) => s.source)), new Set(['claude-code', 'cursor', 'cursor-agent', 'codex']));
  const times = sessions.map((s) => s.updatedAt);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test('import writes an alternating V3 transcript with provenance and a closing turn', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const res = await importSession(fx.roots, { source: 'claude-code', id: 'claude-s1' });
  assert.equal(res.status, 'created');
  assert.equal(res.kiroSessionId, kiroSessionIdFor('claude-code', 'claude-s1'));
  assert.equal(res.resumeCommand, `cd '${fx.ws}' && kiro-cli chat --v3 --resume-id ${res.kiroSessionId}`);
  const recs = records(fx, fx.ws, res.kiroSessionId);
  const said = recs.filter((r) => r.payload.type === 'user' || r.payload.type === 'assistant');
  assert.deepEqual(said.map((r) => r.payload.type), ['user', 'assistant']);
  assert.match(said[0].payload.content, /^\[Migrated from Claude Code session claude-s1\]\n\nFix the failing test/);
  assert.match(said[1].payload.content, /\[tool call: Bash\]/);
  assert.match(said[1].payload.content, /\[tool result: Bash \(error\)\] FAIL/);
  assert.match(said[1].payload.content, /off-by-one/);
});

test('a session ending on a user message gets an assistant closer so Kiro can append', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const res = await importSession(fx.roots, { source: 'claude-code', id: 'claude-s0' });
  const said = records(fx, fx.ws, res.kiroSessionId).filter((r) => ['user', 'assistant'].includes(r.payload.type));
  assert.equal(said.at(-1).payload.type, 'assistant');
  assert.match(said.at(-1).payload.content, /Ready to continue/);
});

test('dry run writes nothing', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const res = await importSession(fx.roots, { source: 'codex', id: 'cdx1', dryRun: true });
  assert.equal(res.status, 'would-create');
  assert.ok(!fs.existsSync(path.join(fx.roots.kiro.dir, 'sessions')));
});

test('re-import updates in place; once continued in Kiro it is kept, fork makes a copy', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const first = await importSession(fx.roots, { source: 'cursor', id: 'cmp1' });
  assert.equal((await importSession(fx.roots, { source: 'cursor', id: 'cmp1' })).status, 'updated');
  const file = path.join(fx.roots.kiro.dir, 'sessions', bucketFor(fx.ws), first.kiroSessionId, 'messages.jsonl');
  fs.appendFileSync(file, JSON.stringify({ id: 'native', payload: { type: 'user', content: 'continued in kiro' } }) + '\n');
  const kept = await importSession(fx.roots, { source: 'cursor', id: 'cmp1' });
  assert.equal(kept.status, 'kept');
  assert.match(fs.readFileSync(file, 'utf-8'), /continued in kiro/);
  const forked = await importSession(fx.roots, { source: 'cursor', id: 'cmp1', fork: true, now: 1 });
  assert.equal(forked.status, 'forked');
  assert.notEqual(forked.kiroSessionId, first.kiroSessionId);
});

test('budget drops old turns and says how many', () => {
  const messages = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `turn ${i} ${'x'.repeat(100)}` }));
  const { turns, omitted } = prepareTurns({ meta: { id: 's' }, messages }, { label: 'Claude Code', maxChars: 250 });
  assert.equal(omitted, 6);
  assert.match(turns[0].text, /^\[Migrated from Claude Code session s; 6 earlier turns omitted to fit the context budget\]\n\nturn 6/);
});

test('store sessions without a cwd go to the _global bucket', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const res = await importSession(fx.roots, { source: 'cursor-agent', id: 'c1' });
  assert.equal(res.cwd, null);
  assert.ok(fs.existsSync(path.join(fx.roots.kiro.dir, 'sessions', '_global', res.kiroSessionId, 'session.json')));
  assert.equal(res.resumeCommand, `kiro-cli chat --v3 --resume-id ${res.kiroSessionId}`);
});

test('batch import: all=true takes newest sessions, errors are per item', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const results = await importSessions(fx.roots, { source: 'claude-code', all: true });
  assert.deepEqual(results.map((r) => r.status), ['created', 'created']);
  const mixed = await importSessions(fx.roots, { source: 'claude-code', ids: ['claude-s1', 'missing'] });
  assert.deepEqual(mixed.map((r) => r.status), ['updated', 'error']);
  await assert.rejects(importSessions(fx.roots, { source: 'claude-code' }), /nothing to import/);
});

test('handoff picks the most recent session for the cwd', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const res = await handoffSession(fx.roots, { source: 'claude-code', cwd: fx.ws });
  assert.equal(res.id, 'claude-s1');
  assert.equal(res.status, 'created');
  await assert.rejects(handoffSession(fx.roots, { source: 'codex', cwd: '/nowhere' }), /no codex session/);
});

test('resume command quotes paths for the shell', () => {
  assert.equal(resumeCommand('sess_x', "/a b/it's"), `cd '/a b/it'\\''s' && kiro-cli chat --v3 --resume-id sess_x`);
});
