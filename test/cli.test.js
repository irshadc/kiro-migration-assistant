// The command-line entry: install (server + skill registration) and one-shot tool calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install, PACKAGE_SPEC, SERVER_NAME } from '../src/install.js';
import { makeFixture } from './helpers/fixtures.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

const run = (fx, args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf-8',
  env: { PATH: process.env.PATH, HOME: fx.home, KMA_CURSOR_USER_DIR: path.join(fx.home, 'CursorUser') },
});

test('install registers the server, keeps other servers, copies the skill, and is idempotent', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const mcpFile = path.join(fx.roots.kiro.dir, 'settings', 'mcp.json');
  fs.mkdirSync(path.dirname(mcpFile), { recursive: true });
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));

  const first = install(fx.roots, { now: 1 });
  assert.equal(first.mcp.status, 'added');
  assert.ok(fs.existsSync(`${mcpFile}.kma-backup-1`), 'previous mcp.json backed up');
  const servers = JSON.parse(fs.readFileSync(mcpFile, 'utf-8')).mcpServers;
  assert.deepEqual(servers.other, { command: 'x' });
  assert.deepEqual(servers[SERVER_NAME], { command: 'npx', args: ['-y', PACKAGE_SPEC] });
  assert.ok(fs.existsSync(path.join(fx.roots.kiro.dir, 'skills', SERVER_NAME, 'SKILL.md')));

  const second = install(fx.roots, { now: 2 });
  assert.equal(second.mcp.status, 'unchanged');
  assert.ok(!fs.existsSync(`${mcpFile}.kma-backup-2`));
});

test('install refuses to touch an invalid mcp.json', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const mcpFile = path.join(fx.roots.kiro.dir, 'settings', 'mcp.json');
  fs.mkdirSync(path.dirname(mcpFile), { recursive: true });
  fs.writeFileSync(mcpFile, '{ not json');
  assert.throws(() => install(fx.roots), /Invalid JSON/);
  assert.equal(fs.readFileSync(mcpFile, 'utf-8'), '{ not json');
});

test('cli call runs a tool once and prints JSON', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const out = JSON.parse(execFileSync(process.execPath, [CLI, 'call', 'list_sessions', '{"sources":["codex"]}'], {
    encoding: 'utf-8', env: { PATH: process.env.PATH, HOME: fx.home },
  }));
  assert.equal(out.sessions[0].id, 'cdx1');
  const imported = JSON.parse(run(fx, ['call', 'import_sessions', JSON.stringify({ all: true, limit: 5, fallbackCwd: fx.ws, dryRun: false })]).stdout);
  assert.equal(imported.results.length, 5);
});

test('cli rejects unknown tools, bad JSON and unknown arguments with exit 1', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  for (const [args, msg] of [
    [['call', 'nope'], /unknown tool "nope"/],
    [['call', 'list_sessions', '{bad'], /must be one JSON object/],
    [['call', 'list_sessions', '{"limt":5}'], /limt/],
    [['frobnicate'], /usage:/],
  ]) {
    const res = run(fx, args);
    assert.equal(res.status, 1, args.join(' '));
    assert.match(res.stderr, msg);
  }
});
