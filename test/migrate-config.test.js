import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../src/common/frontmatter.js';
import { applyConfigPlan, planConfigMigration, summarize } from '../src/config/migrate-config.js';
import { makeFixture } from './helpers/fixtures.js';

const read = (p) => fs.readFileSync(p, 'utf-8');
const find = (plan, kind, name) => plan.find((e) => e.kind === kind && e.name === name);

test('dry run writes nothing and reports every kind', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, { workspace: fx.ws });
  assert.ok(!fs.existsSync(fx.roots.kiro.dir), 'kiro dir untouched');
  assert.deepEqual([...new Set(plan.map((e) => e.kind))].sort(), ['agent', 'command', 'hook', 'mcp', 'rule', 'skill']);
  assert.equal(find(plan, 'mcp', 'github').status, 'create');
  assert.equal(plan.filter((e) => e.kind === 'mcp' && e.name === 'github')[1].status, 'conflict', 'Cursor github collides with Claude github');
});

test('apply: skills copied with assets, name fixed to folder, description derived', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  applyConfigPlan(planConfigMigration(fx.roots, { sources: ['claude-code'], kinds: ['skill'] }));
  const k = fx.roots.kiro.dir;
  assert.equal(read(path.join(k, 'skills', 'pdf', 'scripts', 'run.sh')), '#!/bin/sh\necho pdf\n');
  assert.equal(read(path.join(k, 'skills', 'pdf', 'SKILL.md')), read(path.join(fx.roots.claude.dir, 'skills', 'pdf', 'SKILL.md')), 'valid skill copied byte for byte');
  const bad = parseFrontmatter(read(path.join(k, 'skills', 'badname', 'SKILL.md'))).data;
  assert.deepEqual(bad, { name: 'badname', description: 'Bad name skill' });
});

test('apply: commands become skills with argument note', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, { kinds: ['command'] });
  applyConfigPlan(plan);
  const review = parseFrontmatter(read(path.join(fx.roots.kiro.dir, 'skills', 'review', 'SKILL.md')));
  assert.equal(review.data.description, 'Review a pull request');
  assert.match(review.body, /\$ARGUMENTS/);
  assert.match(find(plan, 'command', 'review').warnings.join(), /allowed-tools/);
  assert.ok(fs.existsSync(path.join(fx.roots.kiro.dir, 'skills', 'git-commit', 'SKILL.md')), 'nested command flattened');
  assert.ok(fs.existsSync(path.join(fx.roots.kiro.dir, 'skills', 'deploy', 'SKILL.md')), 'cursor command');
  assert.ok(fs.existsSync(path.join(fx.roots.kiro.dir, 'skills', 'fix', 'SKILL.md')), 'codex prompt');
});

test('apply: agents get mapped tools; missing tools list means all tools', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, { kinds: ['agent'] });
  applyConfigPlan(plan);
  const reviewer = parseFrontmatter(read(path.join(fx.roots.kiro.dir, 'agents', 'reviewer.md')));
  assert.deepEqual(reviewer.data, { name: 'reviewer', description: 'Reviews code', tools: ['read_file', 'grep_search', 'execute_bash'] });
  assert.equal(reviewer.body, 'You review code.\n');
  assert.equal(parseFrontmatter(read(path.join(fx.roots.kiro.dir, 'agents', 'helper.md'))).data.tools, '*');
  const warnings = find(plan, 'agent', 'reviewer').warnings.join('\n');
  assert.match(warnings, /CustomTool/);
  assert.match(warnings, /model "sonnet"/);
});

test('apply: MCP servers merged per scope, unsupported keys dropped, existing servers preserved', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const userMcp = path.join(fx.roots.kiro.dir, 'settings', 'mcp.json');
  fs.mkdirSync(path.dirname(userMcp), { recursive: true });
  fs.writeFileSync(userMcp, JSON.stringify({ mcpServers: { mine: { command: 'keep-me' } } }));
  const plan = planConfigMigration(fx.roots, { kinds: ['mcp'], workspace: fx.ws });
  applyConfigPlan(plan, { now: 42 });
  const user = JSON.parse(read(userMcp)).mcpServers;
  assert.deepEqual(Object.keys(user).sort(), ['fs', 'github', 'linear', 'mine', 'remote', 'web search']);
  assert.equal(user.github.args[1], 'gh-mcp', 'first source wins on name collision');
  assert.equal(user.github.type, undefined, 'stdio type omitted');
  assert.deepEqual(user.remote, { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' }, type: 'http' });
  assert.equal(user['web search'].disabled, true);
  assert.ok(fs.existsSync(`${userMcp}.kma-backup-42`), 'existing mcp.json backed up');
  assert.deepEqual(JSON.parse(read(path.join(fx.ws, '.kiro', 'settings', 'mcp.json'))).mcpServers, { db: { command: 'db-mcp' } });
  assert.match(find(plan, 'mcp', 'remote').warnings.join(), /oauthClientId/);
  assert.match(find(plan, 'mcp', 'github').warnings.join(), /placeholders/);
});

test('apply: Claude and Cursor hooks become Kiro v1 hook files', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, { kinds: ['hook'] });
  applyConfigPlan(plan);
  const claude = JSON.parse(read(path.join(fx.roots.kiro.dir, 'hooks', 'claude-code-settings.json')));
  assert.equal(claude.version, 'v1');
  assert.deepEqual(claude.hooks, [
    { name: 'claude-PreToolUse-0-0', trigger: 'PreToolUse', matcher: '^(fs_write|str_replace)$', action: { type: 'command', command: 'lint.sh' }, timeout: 30 },
    { name: 'claude-Stop-0-0', trigger: 'Stop', action: { type: 'command', command: 'notify.sh' } },
  ]);
  const claudeWarnings = find(plan, 'hook', 'settings.json').warnings.join('\n');
  assert.match(claudeWarnings, /Notification/);
  assert.match(claudeWarnings, /mcp__x__y/);
  const cursor = JSON.parse(read(path.join(fx.roots.kiro.dir, 'hooks', 'cursor-hooks.json')));
  assert.deepEqual(cursor.hooks.map((h) => [h.trigger, h.matcher]), [['PreToolUse', 'execute_bash'], ['PostToolUse', '^(fs_write|str_replace|fs_append)$']]);
});

test('apply: rules become steering with the right inclusion mode', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, { kinds: ['rule'], workspace: fx.ws });
  applyConfigPlan(plan);
  const ws = (n) => parseFrontmatter(read(path.join(fx.ws, '.kiro', 'steering', `${n}.md`)));
  assert.deepEqual(ws('cursor-ts').data, { inclusion: 'fileMatch', fileMatchPattern: ['src/**/*.ts', 'test/**/*.ts'] });
  assert.deepEqual(ws('cursor-core').data, { inclusion: 'always' });
  assert.deepEqual(ws('cursor-db').data, { name: 'cursor-db', inclusion: 'auto', description: 'Database conventions' });
  assert.deepEqual(ws('cursor-misc').data, { inclusion: 'manual' });
  assert.equal(ws('cursorrules').body, 'Legacy cursor rules.\n');
  assert.equal(ws('claude-project').body, 'Project rule: use pnpm.\n');
  const user = parseFrontmatter(read(path.join(fx.roots.kiro.dir, 'steering', 'claude-user.md')));
  assert.equal(user.data.inclusion, 'always');
  assert.ok(fs.existsSync(path.join(fx.roots.kiro.dir, 'steering', 'codex-agents.md')));
  assert.match(find(plan, 'rule', 'claude-user').warnings.join(), /@file imports/);
});

test('second run is a no-op; edited targets are conflicts unless overwrite (with backup)', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  applyConfigPlan(planConfigMigration(fx.roots, { workspace: fx.ws }));
  const again = planConfigMigration(fx.roots, { workspace: fx.ws });
  assert.deepEqual(Object.keys(summarize(again)).sort(), ['conflict', 'unchanged'], 'only the github name collision stays a conflict');
  const agent = path.join(fx.roots.kiro.dir, 'agents', 'helper.md');
  fs.writeFileSync(agent, 'user edit');
  assert.equal(find(planConfigMigration(fx.roots, { kinds: ['agent'] }), 'agent', 'helper').status, 'conflict');
  const applied = applyConfigPlan(planConfigMigration(fx.roots, { kinds: ['agent'], overwrite: true }), { now: 7 });
  assert.equal(read(`${agent}.kma-backup-7`), 'user edit');
  assert.equal(find(applied, 'agent', 'helper').backup, `${agent}.kma-backup-7`);
  assert.match(read(agent), /You help/);
});

test('names filter migrates only selected items', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, { names: ['pdf'] });
  assert.deepEqual(plan.map((e) => `${e.kind}:${e.name}`), ['skill:pdf']);
});

test('workspace-scoped items require a workspace and stay out of user scope', (t) => {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const plan = planConfigMigration(fx.roots, {});
  assert.ok(plan.every((e) => e.scope === 'user'));
});
