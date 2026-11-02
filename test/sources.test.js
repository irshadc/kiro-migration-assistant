import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SESSION_SOURCES, sessionSource } from '../src/sources/index.js';
import { decodeProjectDir } from '../src/sources/cursor/agent-sessions.js';
import { makeFixture } from './helpers/fixtures.js';

test('claude-code: lists newest first, filters by cwd, skips sidechain/meta/bad lines', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const src = sessionSource('claude-code');
  const list = await src.listSessions(fx.roots, {});
  assert.deepEqual(list.map((s) => s.id), ['claude-s1', 'claude-s0']);
  assert.equal(list[0].title, 'Fix the failing test in calc.js');
  assert.equal(list[0].cwd, fx.ws);
  assert.equal((await src.listSessions(fx.roots, { cwd: '/elsewhere' })).length, 0);
  assert.equal((await src.listSessions(fx.roots, { limit: 1 })).length, 1);
  const { messages } = await src.readSession(fx.roots, 'claude-s1');
  const text = JSON.stringify(messages);
  assert.ok(!text.includes('sub-agent chatter') && !text.includes('meta caveat') && !text.includes('secret reasoning'));
  const result = messages.find((m) => m.toolResults?.length).toolResults[0];
  assert.equal(result.name, 'Bash', 'tool result name resolved from its tool_use id');
  assert.equal(result.isError, true);
  await assert.rejects(src.readSession(fx.roots, 'missing'), /not found/);
});

test('cursor-agent: transcripts and store.db sessions', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const src = sessionSource('cursor-agent');
  const list = await src.listSessions(fx.roots, {});
  assert.deepEqual(list.map((s) => s.id).sort(), ['c1', 't1']);
  const t1 = list.find((s) => s.id === 't1');
  assert.equal(t1.cwd, fx.ws);
  assert.equal(t1.title, 'Explain utils.js');
  assert.deepEqual((await src.listSessions(fx.roots, { cwd: fx.ws })).map((s) => s.id), ['t1']);
  const c1 = await src.readSession(fx.roots, 'c1');
  assert.equal(c1.meta.title, 'Rename foo');
  assert.deepEqual(c1.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(c1.messages[0].text, 'Rename foo to bar');
  assert.equal(c1.messages[1].toolCalls[0].name, 'edit_file');
  assert.equal(c1.messages[2].toolResults[0].output, 'ok');
});

test('cursor IDE: composer bubbles ordered by conversation headers, folder from workspace', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const src = sessionSource('cursor');
  const list = await src.listSessions(fx.roots, {});
  const cmp = list.find((s) => s.id === 'cmp1');
  assert.equal(cmp.title, 'Add login page');
  assert.equal(cmp.cwd, fx.ws);
  const { messages } = await src.readSession(fx.roots, 'cmp1');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.deepEqual(messages[1].toolCalls[0].input, { target_file: 'login.tsx' });
  await assert.rejects(src.readSession(fx.roots, 'nope'), /not found/);
});

test('codex: skips injected context, keeps tool calls and outputs', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const src = sessionSource('codex');
  const [s] = await src.listSessions(fx.roots, {});
  assert.equal(s.id, 'cdx1');
  assert.equal(s.title, 'List the files');
  const { messages } = await src.readSession(fx.roots, 'cdx1');
  assert.ok(!JSON.stringify(messages).includes('environment_context'));
  assert.deepEqual(messages.find((m) => m.toolCalls?.length).toolCalls[0], { id: 'f1', name: 'shell', input: { command: ['ls'] } });
});

test('every source returns [] (not an error) when its tool is not installed', async (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  for (const [name, src] of Object.entries(SESSION_SOURCES)) {
    assert.deepEqual(await src.listSessions(fx.roots, {}), [], name);
  }
});

test('decodeProjectDir resolves dashes that belong to real directory names', (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  const dir = path.join(fx.ws, 'my-app');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(decodeProjectDir(dir.slice(1).replace(/\//g, '-')), dir);
});
