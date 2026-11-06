// Drives the real stdio server through the MCP client SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { makeFixture } from './helpers/fixtures.js';

const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));

async function connect(fx) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { PATH: process.env.PATH, HOME: fx.home },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'kma-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

const call = async (client, name, args) => {
  const res = await client.callTool({ name, arguments: args });
  return { ...res, data: res.isError ? null : JSON.parse(res.content[0].text) };
};

test('MCP server: tools, dry-run defaults, writes, errors', async (t) => {
  const fx = makeFixture();
  const client = await connect(fx);
  t.after(async () => { await client.close(); fx.cleanup(); });

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), ['handoff_session', 'import_sessions', 'list_sessions', 'migrate_config', 'scan_sources']);
  assert.equal(tools.find((x) => x.name === 'scan_sources').annotations.readOnlyHint, true);

  const scan = (await call(client, 'scan_sources', { workspace: fx.ws })).data;
  assert.equal(scan.config['claude-code'].skill, 2);
  assert.ok(scan.configByScope['claude-code'].user.skill > 0);
  assert.ok(Object.values(scan.configByScope['claude-code'].workspace).some((count) => count > 0));
  assert.equal(scan.config.cursor.rule, 5);
  assert.equal(scan.sessions.codex.found, true);

  const dry = (await call(client, 'migrate_config', { kinds: ['agent'] })).data;
  assert.equal(dry.dryRun, true);
  assert.ok(!fs.existsSync(path.join(fx.home, '.kiro', 'agents')));
  assert.ok(dry.entries.every((e) => !('op' in e)), 'internal fields hidden');
  const reviewer = dry.entries.find((e) => e.name === 'reviewer');
  const renamed = (await call(client, 'migrate_config', { kinds: ['agent'], ids: [reviewer.id], scopes: ['user'], renames: { [reviewer.id]: 'reviewer-from-claude' } })).data;
  assert.equal(renamed.entries[0].targetName, 'reviewer-from-claude');

  const applied = (await call(client, 'migrate_config', { kinds: ['agent'], dryRun: false })).data;
  assert.equal(applied.summary.create, 4);
  assert.ok(fs.existsSync(path.join(fx.home, '.kiro', 'agents', 'reviewer.json')));
  assert.ok(fs.existsSync(path.join(fx.home, '.kiro', 'agents', 'security-auditor.json')));
  assert.ok(fs.existsSync(path.join(fx.home, '.kiro', 'agents', 'codex-reviewer.json')));

  const listed = (await call(client, 'list_sessions', { sources: ['claude-code'], limit: 5 })).data;
  assert.equal(listed.sessions[0].id, 'claude-s1');

  const dryImport = (await call(client, 'import_sessions', { source: 'codex', ids: ['cdx1'] })).data;
  assert.equal(dryImport.results[0].status, 'would-create');

  const handoff = (await call(client, 'handoff_session', { source: 'claude-code', cwd: fx.ws })).data;
  assert.equal(handoff.status, 'created');
  assert.match(handoff.resumeCommand, /kiro-cli chat --v3 --resume-id sess_/);

  const bad = await call(client, 'handoff_session', { source: 'codex', sessionId: 'nope' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /not found/);

  const invalid = await client.callTool({ name: 'import_sessions', arguments: { source: 'vim' } });
  assert.equal(invalid.isError, true, 'schema rejects unknown source');
});
