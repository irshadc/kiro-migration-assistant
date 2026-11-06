// Builds a throwaway home directory populated with realistic Claude Code,
// Cursor and Codex data, and returns roots pointing at it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolveRoots } from '../../src/roots.js';
import { encodeProjectDir } from '../../src/sources/claude-code/sessions.js';

const write = (p, content) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
};
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const setMtime = (p, ms) => fs.utimesSync(p, ms / 1000, ms / 1000);

export const T0 = Date.parse('2026-10-01T10:00:00Z');

function claude(home, ws) {
  const dir = path.join(home, '.claude');
  const proj = path.join(dir, 'projects', encodeProjectDir(ws));
  const s1 = path.join(proj, 'claude-s1.jsonl');
  write(s1, jsonl([
    { type: 'user', cwd: ws, timestamp: '2026-10-01T10:00:00Z', message: { role: 'user', content: '<system-reminder>ignore me</system-reminder>Fix the failing test in calc.js' } },
    { type: 'assistant', cwd: ws, timestamp: '2026-10-01T10:00:05Z', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'secret reasoning' },
      { type: 'text', text: 'Running the tests first.' },
      { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', cwd: ws, timestamp: '2026-10-01T10:00:09Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'FAIL calc.test.js: expected 4 got 5', is_error: true }] } },
    { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: 'sub-agent chatter' } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'meta caveat' } },
    { type: 'assistant', cwd: ws, timestamp: '2026-10-01T10:00:20Z', message: { role: 'assistant', content: [{ type: 'text', text: 'add() had an off-by-one. Fixed it.' }] } },
  ]) + 'not json at all\n');
  setMtime(s1, T0 + 2000);
  const s0 = path.join(proj, 'claude-s0.jsonl');
  write(s0, jsonl([{ type: 'user', cwd: ws, timestamp: '2026-09-01T10:00:00Z', message: { role: 'user', content: 'older session' } }]));
  setMtime(s0, T0 - 100000);

  write(path.join(dir, 'skills', 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: Work with PDF files\n---\n\n# PDF\nUse scripts/run.sh\n');
  write(path.join(dir, 'skills', 'pdf', 'scripts', 'run.sh'), '#!/bin/sh\necho pdf\n');
  write(path.join(dir, 'skills', 'badname', 'SKILL.md'), '---\nname: other-name\n---\n# Bad name skill\nBody\n');
  write(path.join(dir, 'commands', 'review.md'), '---\ndescription: Review a pull request\nallowed-tools: Bash(git:*)\n---\nReview PR $ARGUMENTS carefully.\n');
  write(path.join(dir, 'commands', 'git', 'commit.md'), '# Write a commit message\nSummarize staged changes.\n');
  write(path.join(dir, 'agents', 'reviewer.md'), [
    '---',
    'name: reviewer',
    'description: Reviews code',
    'tools:',
    '  - Read',
    '  - Grep',
    '  - Bash',
    '  - mcp__github__search',
    '  - CustomTool',
    'disallowedTools:',
    '  - Write',
    'skills:',
    '  - pdf',
    'mcpServers:',
    '  - github',
    '  - browser:',
    '      command: npx',
    '      args: ["-y", "browser-mcp"]',
    'hooks:',
    '  PreToolUse:',
    '    - matcher: Bash',
    '      hooks:',
    '        - type: command',
    '          command: check-command.sh',
    'model: claude-sonnet-4.6',
    'permissionMode: bypassPermissions',
    '---',
    'You review code.',
    '',
  ].join('\n'));
  write(path.join(dir, 'agents', 'helper.md'), '---\nname: helper\ndescription: Helps\n---\nYou help.\n');
  write(path.join(dir, 'settings.json'), { hooks: {
    PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'lint.sh', timeout: 30 }] }, { matcher: 'mcp__x__y', hooks: [{ type: 'command', command: 'never.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'notify.sh' }] }],
    Notification: [{ hooks: [{ type: 'command', command: 'beep.sh' }] }],
  } });
  write(path.join(dir, 'CLAUDE.md'), '# Global rules\nAlways write tests.\n@~/extra.md\n');
  write(path.join(home, '.claude.json'), {
    mcpServers: {
      github: { type: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'], env: { TOKEN: '${GITHUB_TOKEN}' } },
      remote: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' }, oauthClientId: 'abc' },
    },
    projects: { [ws]: { mcpServers: { db: { command: 'db-mcp' } } } },
  });
  write(path.join(ws, 'CLAUDE.md'), 'Project rule: use pnpm.\n');
}

function cursorAgentStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE meta (key TEXT, value TEXT); CREATE TABLE blobs (id TEXT, data BLOB);');
  const msgs = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: [{ type: 'text', text: '<user_query>Rename foo to bar</user_query>' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Renaming.' }, { type: 'tool-call', toolCallId: 'c1', toolName: 'edit_file', args: { path: 'a.js' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'edit_file', result: 'ok' }] },
    { role: 'assistant', content: 'Done renaming.' },
  ];
  const hashes = msgs.map((m) => {
    const data = Buffer.from(JSON.stringify(m));
    const h = crypto.createHash('sha256').update(data).digest();
    db.prepare('INSERT INTO blobs VALUES (?, ?)').run(h.toString('hex'), data);
    return h;
  });
  const tree = Buffer.concat(hashes.flatMap((h) => [Buffer.from([0x0a, 0x20]), h]));
  const rootId = crypto.createHash('sha256').update(tree).digest('hex');
  db.prepare('INSERT INTO blobs VALUES (?, ?)').run(rootId, tree);
  const meta = { name: 'Rename foo', createdAt: T0 - 5000, latestRootBlobId: rootId };
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('0', Buffer.from(JSON.stringify(meta)).toString('hex'));
  db.close();
}

function cursorIde(userDir, ws) {
  const global = path.join(userDir, 'globalStorage', 'state.vscdb');
  fs.mkdirSync(path.dirname(global), { recursive: true });
  const db = new DatabaseSync(global);
  db.exec('CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB); CREATE TABLE ItemTable (key TEXT, value BLOB);');
  const put = (k, v) => db.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)').run(k, typeof v === 'string' ? v : JSON.stringify(v));
  put('composerData:cmp1', { composerId: 'cmp1', name: 'Add login page', createdAt: T0 - 9000, lastUpdatedAt: T0 - 1000,
    fullConversationHeadersOnly: [{ bubbleId: 'zz', type: 1 }, { bubbleId: 'aa', type: 2 }] });
  put('bubbleId:cmp1:aa', { type: 2, text: 'Created login.tsx', toolFormerData: { name: 'edit_file', rawArgs: '{"target_file":"login.tsx"}', result: 'applied' } });
  put('bubbleId:cmp1:zz', { type: 1, text: 'Add a login page' });
  put('composerData:broken', 'not-json');
  db.close();
  const wsDir = path.join(userDir, 'workspaceStorage', 'w1');
  write(path.join(wsDir, 'workspace.json'), { folder: `file://${ws}` });
  const wdb = new DatabaseSync(path.join(wsDir, 'state.vscdb'));
  wdb.exec('CREATE TABLE ItemTable (key TEXT, value BLOB);');
  wdb.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('composer.composerData', JSON.stringify({ allComposers: [{ composerId: 'cmp1', name: 'Add login page' }] }));
  wdb.close();
}

/** Folder name Cursor Agent uses for a project: separators (and a Windows drive colon) become '-'. */
export function cursorProjectDirName(dir) {
  return dir.replace(/^[\\/]+/, '').replace(/[:\\/]+/g, '-');
}

function cursor(home, ws, userDir) {
  const dir = path.join(home, '.cursor');
  write(path.join(dir, 'agents', 'security-auditor.md'), [
    '---',
    'name: security-auditor',
    'description: Audits security-sensitive code',
    'model: inherit',
    'readonly: true',
    'is_background: true',
    '---',
    'Review code for security defects.',
    '',
  ].join('\n'));
  write(path.join(ws, '.cursor', 'agents', 'planner.md'), [
    '---',
    'name: planner',
    'description: Plans project changes',
    'model: gpt-5.6-sol',
    '---',
    'Create implementation plans for this project.',
    '',
  ].join('\n'));
  write(path.join(dir, 'mcp.json'), { mcpServers: { github: { command: 'npx', args: ['other-gh'] }, linear: { url: 'https://linear.example/sse' } } });
  write(path.join(dir, 'hooks.json'), { version: 1, hooks: { beforeShellExecution: [{ command: './guard.sh' }], afterFileEdit: [{ command: './fmt.sh' }], beforeTabRead: [{ command: 'x' }] } });
  write(path.join(dir, 'commands', 'deploy.md'), 'Deploy the app to staging.\n');
  write(path.join(ws, '.cursor', 'rules', 'ts.mdc'), '---\ndescription: TS style\nglobs: src/**/*.ts, test/**/*.ts\nalwaysApply: false\n---\nUse strict types.\n');
  write(path.join(ws, '.cursor', 'rules', 'core.mdc'), '---\nalwaysApply: true\n---\nBe concise.\n');
  write(path.join(ws, '.cursor', 'rules', 'db.mdc'), '---\ndescription: Database conventions\n---\nUse migrations.\n');
  write(path.join(ws, '.cursor', 'rules', 'misc.mdc'), 'No front matter rule.\n');
  write(path.join(ws, '.cursorrules'), 'Legacy cursor rules.\n');
  const t1 = path.join(dir, 'projects', cursorProjectDirName(ws), 'agent-transcripts', 't1.jsonl');
  write(t1, jsonl([
    { role: 'user', message: { content: [{ type: 'text', text: '<user_query>Explain utils.js</user_query><attached_files><file path="utils.js"/></attached_files>' }] } },
    { role: 'assistant', message: { content: [{ type: 'text', text: 'utils.js exports helpers.' }] } },
  ]));
  setMtime(t1, T0 - 3000);
  cursorAgentStore(path.join(dir, 'chats', 'wshash', 'c1', 'store.db'));
  cursorIde(userDir, ws);
}

function codex(home, ws) {
  const dir = path.join(home, '.codex');
  write(path.join(dir, 'agents', 'reviewer.toml'), [
    'name = "codex-reviewer"',
    'description = "Reviews changes for correctness"',
    'model = "gpt-6-luna"',
    'model_reasoning_effort = "high"',
    'developer_instructions = """',
    'Review changes carefully.',
    'Report concrete defects only.',
    '"""',
    '',
    '[features]',
    'shell_tool = false',
    '',
    '[[skills.config]]',
    'name = "legacy-skill"',
    'enabled = false',
  ].join('\n'));
  write(path.join(ws, '.codex', 'agents', 'project-worker.toml'), [
    'name = "project-worker"',
    'description = "Implements project changes"',
    'developer_instructions = "Make small, tested changes."',
  ].join('\n'));
  write(path.join(dir, 'sessions', '2026', '10', '01', 'rollout-2026-10-01T10-00-00-cdx1.jsonl'), jsonl([
    { type: 'session_meta', payload: { id: 'cdx1', cwd: ws, timestamp: '2026-10-01T09:00:00Z' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'List the files' }] } },
    { type: 'response_item', payload: { type: 'reasoning', summary: [] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'f1', arguments: '{"command":["ls"]}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'f1', output: '{"output":"a.txt"}' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'There is a.txt.' }] } },
  ]));
  write(path.join(dir, 'config.toml'), [
    'model = "o3"',
    '[mcp_servers.fs]',
    'command = "npx"',
    'args = [',
    '  "-y", "fs-mcp",',
    ']',
    'env = { ROOT = "/data" }',
    '[mcp_servers."web search"]',
    "url = 'https://search.example/mcp'",
    'enabled = false',
  ].join('\n'));
  write(path.join(dir, 'AGENTS.md'), 'Codex global instructions.\n');
  write(path.join(dir, 'prompts', 'fix.md'), 'Fix: $1\n');
}

/**
 * Environment for a child process that must see `home` as the user's home.
 * os.homedir() reads USERPROFILE on Windows and HOME elsewhere, so both are set;
 * without USERPROFILE a Windows child would read and write the REAL profile.
 * SystemRoot is passed through because Node on Windows needs it to start.
 */
export function fixtureEnv(home) {
  return { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
}

/** Create a fresh fixture home. Call `cleanup()` when done. */
export function makeFixture({ withSources = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kmatest')));
  const home = path.join(base, 'home');
  const ws = path.join(base, 'ws');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  // Empty env: the developer's own CLAUDE_CONFIG_DIR / CODEX_HOME must not leak in.
  const roots = resolveRoots({ home, env: {} });
  if (withSources) {
    claude(home, ws);
    cursor(home, ws, roots.cursor.userDir);
    codex(home, ws);
  }
  return {
    base, home, ws,
    roots,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}
