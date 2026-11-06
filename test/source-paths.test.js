// Source folders: scan_sources reports where it looked, and `paths` reads a
// tool from a non-default folder on every tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRoots, sourceLocations, withSourcePaths } from '../src/roots.js';
import { TOOLS } from '../src/tools.js';
import { makeFixture } from './helpers/fixtures.js';

const tool = (name) => TOOLS.find(([n]) => n === name)[2];

/** Move the fixture's Claude Code data out of its default place. */
function relocateClaude(fx) {
  const moved = path.join(fx.base, 'elsewhere');
  fs.mkdirSync(moved);
  fs.renameSync(path.join(fx.home, '.claude'), path.join(moved, '.claude'));
  const json = path.join(fx.home, '.claude.json');
  if (fs.existsSync(json)) fs.renameSync(json, path.join(moved, '.claude.json'));
  return moved;
}

test('scan_sources lists the folders it read from and whether they exist', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const scan = await tool('scan_sources')(fx.roots, { workspace: fx.ws });
  assert.ok(scan.configByScope['claude-code'].user.skill > 0);
  assert.ok(Object.values(scan.configByScope['claude-code'].workspace).some((count) => count > 0));
  assert.deepEqual(scan.locations['claude-code'][0], { key: 'claudeDir', path: path.join(fx.home, '.claude'), exists: true });
  assert.deepEqual(scan.locationsByScope['claude-code'].user, scan.locations['claude-code']);
  assert.equal(scan.locationsByScope['claude-code'].workspace[0].path, path.join(fx.ws, '.claude'));
  assert.equal(scan.locationsByScope.cursor.workspace[0].path, path.join(fx.ws, '.cursor'));
  assert.equal(scan.locationsByScope.codex.workspace[0].path, path.join(fx.ws, '.codex'));
  assert.deepEqual(scan.locations.codex, [{ key: 'codexDir', path: path.join(fx.home, '.codex'), exists: true }]);
  assert.equal(scan.locations.cursor.length, 2);
});

test('a relocated tool is not found by default, and paths finds it again', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const moved = relocateClaude(fx);

  const before = await tool('scan_sources')(fx.roots, { workspace: fx.ws });
  // Still "detected" through the workspace's CLAUDE.md / .mcp.json, but the user-level data is gone.
  assert.equal(before.sessions['claude-code'].found, false);
  assert.equal(before.locations['claude-code'][0].exists, false);

  const paths = { claudeDir: path.join(moved, '.claude'), claudeJson: path.join(moved, '.claude.json') };
  const after = await tool('scan_sources')(fx.roots, { workspace: fx.ws, paths });
  assert.equal(after.detected['claude-code'], true);
  assert.equal(after.locations['claude-code'][0].path, paths.claudeDir);
  assert.ok(after.sessions['claude-code'].count >= 1);

  const listed = await tool('list_sessions')(fx.roots, { sources: ['claude-code'], limit: 5, paths });
  assert.ok(listed.sessions.length >= 1);
  const plan = await tool('migrate_config')(fx.roots, { sources: ['claude-code'], workspace: fx.ws, dryRun: true, paths });
  assert.ok(plan.entries.length >= 1);
});

test('withSourcePaths expands ~/, keeps the Kiro target, rejects relative paths', (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  const r = withSourcePaths(fx.roots, { codexDir: '~/custom/codex' });
  assert.equal(r.codex.dir, path.join(fx.home, 'custom', 'codex'));
  assert.equal(r.kiro.dir, fx.roots.kiro.dir);
  assert.equal(r.claude.dir, fx.roots.claude.dir);
  assert.equal(withSourcePaths(fx.roots, undefined), fx.roots);
  assert.throws(() => withSourcePaths(fx.roots, { claudeDir: 'relative/dir' }), /paths\.claudeDir must be an absolute path/);
  assert.equal(sourceLocations(fx.roots).codex[0].exists, false);
});

test('resolveRoots honors only the tools\' own variables', () => {
  const home = '/h';
  const r = resolveRoots({ home, env: { CLAUDE_CONFIG_DIR: '/c', CODEX_HOME: '/x', KMA_CURSOR_DIR: '/ignored' }, platform: 'linux' });
  assert.equal(r.claude.dir, '/c');
  assert.equal(r.claude.globalConfigFile, path.join('/c', '.claude.json'));
  assert.equal(r.codex.dir, '/x');
  assert.equal(r.cursor.dir, path.join(home, '.cursor'));
  assert.equal(r.kiro.dir, path.join(home, '.kiro'));
  assert.equal(resolveRoots({ home, env: {}, platform: 'linux' }).claude.globalConfigFile, path.join(home, '.claude.json'));
});
