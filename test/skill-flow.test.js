import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_SPEC } from '../src/install.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const skill = fs.readFileSync(path.join(ROOT, 'skills', 'kiro-migration-assistant', 'SKILL.md'), 'utf-8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
const guided = skill.match(/## Guided Mode\n([\s\S]*?)\n## Full Preview Mode/)?.[1] || '';

test('guided mode requires exactly one decision per turn', () => {
  assert.match(skill, /Guide the user through one decision per turn/);
  assert.match(guided, /After asking, stop and wait for the answer/);
  assert.match(guided, /review global settings, this project's settings, or both/);
  assert.match(guided, /Keep Kiro's item, rename the incoming item, or replace with backup/);
  assert.match(guided, /generated JSON fields: prompt, tools, excluded tools, skill resources, MCP servers, hooks, model, and permissions/);
  assert.match(guided, /kiro-cli agent validate --path/);
  assert.match(guided, /Do not display the queue/);
  assert.match(guided, /Present one session only/);
});

test('bulk output requires an explicit mode', () => {
  assert.match(skill, /`kma: preview all` \| Full read-only inventory/);
  assert.match(skill, /`kma: migrate everything` \| Fast mode/);
  assert.match(skill, /Do not silently turn guided mode into fast mode/);
});

test('README ranks product outcomes before workflow mechanics', () => {
  const setupAt = readme.indexOf('| 1 | Setup copy |');
  const sessionAt = readme.indexOf('| 2 | Session import |');
  const handoffAt = readme.indexOf('| 3 | Live handoff |');
  const guidedAt = readme.indexOf('| 4 | Guided migration |');
  const cliAt = readme.indexOf('| 5 | CLI mode |');
  assert.ok(setupAt >= 0 && setupAt < sessionAt && sessionAt < handoffAt && handoffAt < guidedAt && guidedAt < cliAt);
});

test('README stays concise and includes source matrix and setup checks', () => {
  assert.ok(readme.split('\n').length <= 200);
  assert.match(readme, /\| Claude Code \| Yes \| Yes \| Yes \| Yes \| Yes \| User and project \| Yes \|/);
  assert.match(readme, /KMA preserves scope/);
  assert.match(readme, /~\/\.kiro\/skills\/kiro-migration-assistant\//);
  assert.match(readme, /### First-Time Setup Prompt/);
  assert.ok(readme.includes(`npx -y ${PACKAGE_SPEC} install`));
  assert.equal(readme.match(/^## Quick Start$/gm)?.length, 1);
  assert.equal(readme.match(/^## Manual Setup$/gm)?.length, 1);
  assert.match(readme, /kiro-cli chat --v3 --no-interactive "kma: preview all; change nothing"/);
  assert.match(readme, /does not create a global `kma` shell command/);
});

test('every doc command pins the same release tag the installer writes', () => {
  const architecture = fs.readFileSync(path.join(ROOT, 'ARCHITECTURE.md'), 'utf-8');
  for (const [name, text] of Object.entries({ 'README.md': readme, 'SKILL.md': skill, 'ARCHITECTURE.md': architecture })) {
    const refs = text.match(/github:irshadc\/kiro-migration-assistant[^\s'"`]*/g) || [];
    assert.ok(refs.length, `${name} names the package`);
    assert.deepEqual([...new Set(refs)], [PACKAGE_SPEC], `${name} must use ${PACKAGE_SPEC} only`);
  }
});
