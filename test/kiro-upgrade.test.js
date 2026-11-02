// Converting Kiro IDE hooks for kiro-cli V3, plus the guided-flow helpers
// (ids, Kiro inventory, scan counts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kiroInventory } from '../src/config/kiro-inventory.js';
import { globToRegex } from '../src/config/kiro-legacy.js';
import { applyConfigPlan, planConfigMigration } from '../src/config/migrate-config.js';
import { listAllSessions } from '../src/sessions/import-sessions.js';
import { TOOLS } from '../src/tools.js';
import { makeFixture } from './helpers/fixtures.js';

const read = (p) => fs.readFileSync(p, 'utf-8');
const write = (p, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
const tool = (name) => TOOLS.find(([n]) => n === name)[2];

/** Kiro IDE hooks under the fixture's kiro dir and workspace. */
function addKiroLegacy(fx) {
  const k = fx.roots.kiro.dir;
  write(path.join(k, 'hooks', 'lint.kiro.hook'), JSON.stringify({
    enabled: true, name: 'Lint on save', description: 'Runs lint', version: '1',
    when: { type: 'fileEdited', patterns: ['src/**/*.ts'] }, then: { type: 'runCommand', command: 'npm run lint' },
  }));
  write(path.join(fx.ws, '.kiro', 'hooks', 'scout.kiro.hook'), JSON.stringify({
    enabled: false, name: 'Scout', version: '1', when: { type: 'promptSubmit' }, then: { type: 'askAgent', prompt: 'Search memory first.' },
  }));
  write(path.join(fx.ws, '.kiro', 'hooks', 'weird.kiro.hook'), JSON.stringify({ name: 'Weird', when: { type: 'onMoonrise' }, then: { type: 'askAgent', prompt: 'x' } }));
}

test('glob patterns become path regexes', () => {
  const re = new RegExp(globToRegex('src/**/*.ts'));
  assert.ok(re.test('src/a.ts') && re.test('/abs/proj/src/deep/b.ts'));
  assert.ok(!re.test('src/a.js') && !re.test('lib/a.ts'));
});

test('default sources leave Kiro IDE hooks alone (existing behaviour)', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  addKiroLegacy(fx);
  assert.ok(planConfigMigration(fx.roots, { workspace: fx.ws }).every((e) => e.source !== 'kiro'));
  const { sessions } = await listAllSessions(fx.roots, { limit: 100 });
  assert.ok(sessions.length > 0);
});

test('upgrade: Kiro IDE hooks become V3 hook files, disabled stays disabled', (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  addKiroLegacy(fx);
  const plan = planConfigMigration(fx.roots, { sources: ['kiro'], kinds: ['hook'], workspace: fx.ws });
  applyConfigPlan(plan);
  const lint = JSON.parse(read(path.join(fx.roots.kiro.dir, 'hooks', 'lint.json')));
  assert.deepEqual(lint, { version: 'v1', hooks: [{ name: 'Lint on save', description: 'Runs lint', trigger: 'PostFileSave', matcher: '(^|/)src/(?:.*/)?[^/]*\\.ts$', action: { type: 'command', command: 'npm run lint' } }] });
  const scout = JSON.parse(read(path.join(fx.ws, '.kiro', 'hooks', 'scout.json')));
  assert.deepEqual(scout.hooks[0], { name: 'Scout', trigger: 'UserPromptSubmit', action: { type: 'agent', prompt: 'Search memory first.' }, enabled: false });
  const weird = plan.find((e) => e.name === 'weird');
  assert.equal(weird.status, 'skipped');
  assert.match(weird.warnings.join(), /onMoonrise/);
  assert.ok(fs.existsSync(path.join(fx.roots.kiro.dir, 'hooks', 'lint.kiro.hook')), 'IDE file untouched');
});

test('ids select exactly the ticked items, across sources with the same name', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const all = planConfigMigration(fx.roots, { kinds: ['mcp'], workspace: fx.ws });
  const github = all.filter((e) => e.name === 'github');
  assert.equal(github.length, 2);
  assert.notEqual(github[0].id, github[1].id);
  const picked = planConfigMigration(fx.roots, { kinds: ['mcp'], workspace: fx.ws, ids: [github[1].id] });
  assert.deepEqual(picked.map((e) => [e.id, e.status]), [[github[1].id, 'create']], 'the second github alone is no longer a conflict');
  assert.equal(planConfigMigration(fx.roots, { ids: ['nope/skill/user/x'] }).length, 0);
});

test('scan_sources reports detected tools, counts, Kiro inventory and upgrades', async (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  addKiroLegacy(fx);
  write(path.join(fx.roots.kiro.dir, 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\n');
  write(path.join(fx.roots.kiro.dir, 'settings', 'mcp.json'), JSON.stringify({ mcpServers: { local: { command: 'x' } } }));
  const scan = await tool('scan_sources')(fx.roots, { workspace: fx.ws });
  assert.deepEqual(scan.detected, { 'claude-code': true, cursor: true, codex: true });
  assert.ok(scan.sessions['claude-code'].count >= 1);
  assert.deepEqual(scan.kiro.user.skills, ['mine']);
  assert.deepEqual(scan.kiro.user.mcpServers, ['local']);
  assert.deepEqual(scan.kiro.user.agents, []);
  assert.deepEqual(scan.kiroUpgrade, { ideHooks: 3 });
});

test('kiroInventory ignores backups', (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  write(path.join(fx.roots.kiro.dir, 'steering', 'a.md'), 'x');
  write(path.join(fx.roots.kiro.dir, 'steering', 'a.md.kma-backup-1'), 'x');
  assert.deepEqual(kiroInventory(fx.roots).user.steering, ['a']);
});
