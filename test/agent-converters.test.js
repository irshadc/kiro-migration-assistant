import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyConfigPlan, planConfigMigration } from '../src/config/migrate-config.js';
import { kiroInventory } from '../src/config/kiro-inventory.js';
import { makeFixture } from './helpers/fixtures.js';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

test('Cursor global and project agents become scoped Kiro JSON profiles', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, { sources: ['cursor'], kinds: ['agent'], workspace: fx.ws });
  assert.deepEqual(plan.map((entry) => [entry.name, entry.scope]), [
    ['security-auditor', 'user'],
    ['planner', 'workspace'],
  ]);
  applyConfigPlan(plan);

  const security = readJson(path.join(fx.roots.kiro.dir, 'agents', 'security-auditor.json'));
  assert.equal(security.prompt, 'Review code for security defects.');
  assert.deepEqual(security.tools, ['*']);
  assert.deepEqual(security.excludedTools, ['write', 'shell']);
  assert.deepEqual(security.permissions.rules, [
    { capability: 'fs_write', effect: 'deny' },
    { capability: 'shell', effect: 'deny' },
  ]);
  assert.equal(security.model, undefined, 'Cursor inherit leaves Kiro model unpinned');
  assert.match(plan[0].warnings.join('\n'), /is_background has no Kiro agent-file equivalent/);

  const planner = readJson(path.join(fx.ws, '.kiro', 'agents', 'planner.json'));
  assert.equal(planner.model, 'gpt-5.6-sol');
  assert.equal(planner.prompt, 'Create implementation plans for this project.');
});

test('Codex global and project TOML agents become scoped Kiro JSON profiles', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, { sources: ['codex'], kinds: ['agent'], workspace: fx.ws });
  assert.deepEqual(plan.map((entry) => [entry.name, entry.scope]), [
    ['reviewer', 'user'],
    ['project-worker', 'workspace'],
  ]);
  applyConfigPlan(plan);

  const reviewer = readJson(path.join(fx.roots.kiro.dir, 'agents', 'codex-reviewer.json'));
  assert.equal(reviewer.prompt, 'Review changes carefully.\nReport concrete defects only.\n');
  assert.equal(reviewer.model, 'gpt-6-luna');
  assert.deepEqual(reviewer.excludedTools, ['shell']);
  assert.deepEqual(reviewer.permissions.rules, [{ capability: 'shell', effect: 'deny' }]);
  const warnings = plan[0].warnings.join('\n');
  assert.match(warnings, /model_reasoning_effort has no Kiro agent-file equivalent/);
  assert.match(warnings, /disabled skills have no Kiro agent-file equivalent/);

  const worker = readJson(path.join(fx.ws, '.kiro', 'agents', 'project-worker.json'));
  assert.equal(worker.prompt, 'Make small, tested changes.');
});

test('Claude plan mode becomes restrictive Kiro permissions without adding grants', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  write(path.join(fx.roots.claude.dir, 'agents', 'plan-only.md'), [
    '---',
    'name: plan-only',
    'description: Plans without edits',
    'tools: [Read, Bash, Write]',
    'permissionMode: plan',
    '---',
    'Plan changes only.',
    '',
  ].join('\n'));
  const plan = planConfigMigration(fx.roots, { sources: ['claude-code'], kinds: ['agent'], names: ['plan-only'] });
  applyConfigPlan(plan);
  const agent = readJson(path.join(fx.roots.kiro.dir, 'agents', 'plan-only.json'));
  assert.deepEqual(agent.tools, ['read', 'shell', 'write']);
  assert.deepEqual(agent.excludedTools, ['write', 'shell']);
  assert.deepEqual(agent.permissions.rules, [
    { capability: 'fs_write', effect: 'deny' },
    { capability: 'shell', effect: 'deny' },
  ]);
  assert.ok(agent.permissions.rules.every((rule) => rule.effect === 'deny'));
});

test('invalid nested Claude agent YAML is reported as an item error', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  write(path.join(fx.roots.claude.dir, 'agents', 'broken.md'), '---\nname: broken\nmcpServers: [\n---\nPrompt\n');
  const [entry] = planConfigMigration(fx.roots, { sources: ['claude-code'], kinds: ['agent'], names: ['broken'] });
  assert.equal(entry.status, 'error');
  assert.match(entry.warnings[0], /invalid YAML frontmatter/);
});

test('existing Markdown agent conflicts with generated JSON and is backed up only on approved replace', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const markdown = path.join(fx.roots.kiro.dir, 'agents', 'reviewer.md');
  write(markdown, 'existing Markdown agent\n');
  const conflict = planConfigMigration(fx.roots, { sources: ['claude-code'], kinds: ['agent'], names: ['reviewer'] });
  assert.equal(conflict[0].status, 'conflict');
  assert.equal(conflict[0].replaces, markdown);
  assert.ok(!fs.existsSync(path.join(fx.roots.kiro.dir, 'agents', 'reviewer.json')));

  const replacement = planConfigMigration(fx.roots, { sources: ['claude-code'], kinds: ['agent'], names: ['reviewer'], overwrite: true });
  const applied = applyConfigPlan(replacement, { now: 77 });
  assert.equal(applied[0].backup, `${markdown}.kma-backup-77`);
  assert.equal(fs.readFileSync(`${markdown}.kma-backup-77`, 'utf-8'), 'existing Markdown agent\n');
  assert.ok(fs.existsSync(path.join(fx.roots.kiro.dir, 'agents', 'reviewer.json')));
});

test('existing JSON and Markdown agents with one name remain a hard conflict', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const agents = path.join(fx.roots.kiro.dir, 'agents');
  write(path.join(agents, 'reviewer.json'), '{}');
  write(path.join(agents, 'reviewer.md'), 'duplicate');
  const [entry] = planConfigMigration(fx.roots, { sources: ['claude-code'], kinds: ['agent'], names: ['reviewer'], overwrite: true });
  assert.equal(entry.status, 'conflict');
  assert.equal(entry.existingTargets.length, 2);
  assert.match(entry.warnings.join('\n'), /resolve the existing duplicate manually/);
});

test('Kiro inventory lists JSON and Markdown agents once and ignores sidecars', (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  const agents = path.join(fx.roots.kiro.dir, 'agents');
  write(path.join(agents, 'one.json'), '{}');
  write(path.join(agents, 'one.md'), 'same identity');
  write(path.join(agents, 'two.json'), '{}');
  write(path.join(agents, '._hidden.json'), '{}');
  assert.deepEqual(kiroInventory(fx.roots).user.agents, ['one', 'two']);
});
