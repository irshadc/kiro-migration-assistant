import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fitBudget, toTurns } from '../src/sessions/transcript.js';
import {
  GLOBAL_BUCKET, IMPORT_RECORD_PREFIX, bucketFor, inspectExisting, kiroSessionIdFor, normalizeWorkspacePath, stableUuid, writeSession,
} from '../src/sessions/kiro-v3-writer.js';
import { makeFixture } from './helpers/fixtures.js';

test('bucket hash matches the Kiro engine (verified against a real V3 session dir)', () => {
  assert.equal(bucketFor('/home/ec2-user/project/vscode-local/memorizer-app', 'linux'), 'bfbc4369b56387d4');
  assert.equal(bucketFor('/home/ec2-user/project/vscode-local/memorizer-app/', 'linux'), 'bfbc4369b56387d4');
  assert.equal(bucketFor(null), GLOBAL_BUCKET);
});

test('workspace path normalization', () => {
  assert.equal(normalizeWorkspacePath('/a/b/../c//', 'linux'), '/a/c');
  assert.equal(normalizeWorkspacePath('C:\\Work\\App\\', 'win32').endsWith('c:/work/app'), true);
});

test('stable ids are deterministic v5-shaped uuids', () => {
  assert.equal(stableUuid('x'), stableUuid('x'));
  assert.notEqual(stableUuid('x'), stableUuid('y'));
  assert.match(kiroSessionIdFor('claude-code', 'abc'), /^sess_[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('toTurns merges roles, folds tool results into the assistant turn, drops empties', () => {
  const turns = toTurns([
    { role: 'user', text: 'hi' },
    { role: 'user', text: '' },
    { role: 'assistant', text: 'calling', toolCalls: [{ name: 'Bash', input: { command: 'ls' } }] },
    { role: 'user', text: '', toolResults: [{ name: 'Bash', output: 'a.txt' }] },
    { role: 'assistant', text: 'done' },
    { role: 'user', text: 'thanks', timestamp: '2026-10-01T00:00:00Z' },
  ]);
  assert.deepEqual(turns.map((t) => t.role), ['user', 'assistant', 'user']);
  assert.match(turns[1].text, /\[tool call: Bash\] \{"command":"ls"\}/);
  assert.match(turns[1].text, /\[tool result: Bash\] a\.txt/);
  assert.match(turns[1].text, /done$/);
  assert.equal(turns[2].timestamp, Date.parse('2026-10-01T00:00:00Z'));
});

test('toTurns truncates huge tool output', () => {
  const [, a] = toTurns([{ role: 'user', text: 'q' }, { role: 'assistant', text: '', toolResults: [{ output: 'x'.repeat(10_000) }] }]);
  assert.ok(a.text.length < 2000);
  assert.match(a.text, /chars truncated/);
});

test('fitBudget keeps newest turns and starts on a user turn', () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x'.repeat(100) }));
  const { turns: kept, omitted } = fitBudget(turns, 350);
  assert.equal(kept[0].role, 'user');
  assert.equal(omitted + kept.length, 10);
  assert.ok(kept.length <= 4);
  assert.equal(fitBudget(turns, 1e9).omitted, 0);
  assert.equal(fitBudget([{ role: 'user', text: 'x'.repeat(999) }], 10).turns.length, 1);
});

test('writeSession writes session.json, messages.jsonl and one index entry', (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  const args = { kiroDir: fx.roots.kiro.dir, id: 'sess_test', cwd: fx.ws, title: 'T', turns: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }], createdAtMs: 1000, platform: 'linux' };
  const res = writeSession(args);
  writeSession(args);
  const meta = JSON.parse(fs.readFileSync(path.join(res.dir, 'session.json'), 'utf-8'));
  assert.equal(meta.id, 'sess_test');
  assert.deepEqual(meta.workspacePaths, [fx.ws]);
  const recs = fs.readFileSync(path.join(res.dir, 'messages.jsonl'), 'utf-8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(recs.map((r) => r.payload.type), ['user', 'turn_start', 'assistant', 'turn_end']);
  assert.ok(recs.every((r) => r.id.startsWith(IMPORT_RECORD_PREFIX)));
  assert.ok(recs.every((r, i) => i === 0 || r.timestamp > recs[i - 1].timestamp), 'timestamps strictly increase');
  const index = fs.readFileSync(path.join(fx.roots.kiro.dir, 'session-index', `${res.bucket}.jsonl`), 'utf-8').trim().split('\n');
  assert.equal(index.length, 1, 'index entry not duplicated on rewrite');
  assert.deepEqual(inspectExisting(res.dir), { exists: true, continuedInKiro: false });
  fs.appendFileSync(path.join(res.dir, 'messages.jsonl'), JSON.stringify({ id: 'native-1', payload: { type: 'user', content: 'more' } }) + '\n');
  assert.equal(inspectExisting(res.dir).continuedInKiro, true);
});

test('writeSession refuses turns that do not start with the user', () => {
  assert.throws(() => writeSession({ kiroDir: '/nowhere', id: 's', turns: [{ role: 'assistant', text: 'a' }] }), /start with a user/);
});
