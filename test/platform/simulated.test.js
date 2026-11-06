// Windows, macOS and Linux behavior checked on ANY host by passing `platform`
// explicitly. The native checks that need the real OS live in windows/macos/linux.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inDirectory, shellQuote } from '../../src/common/platform.js';
import { renameWithRetry } from '../../src/common/files.js';
import { callHint, install, PACKAGE_SPEC, SERVER_NAME, serverEntry } from '../../src/install.js';
import { resolveRoots } from '../../src/roots.js';
import { resumeCommand } from '../../src/sessions/import-sessions.js';
import { bucketFor, normalizeWorkspacePath, sameWorkspacePath } from '../../src/sessions/kiro-v3-writer.js';
import { decodeProjectDir } from '../../src/sources/cursor/agent-sessions.js';
import { sessionSource } from '../../src/sources/index.js';
import { makeFixture } from '../helpers/fixtures.js';

const POSIX = ['linux', 'darwin'];
const lockError = (code) => Object.assign(new Error(code), { code });

test('MCP server entry: cmd /c npx on Windows, plain npx on macOS and Linux', () => {
  assert.deepEqual(serverEntry('win32'), { command: 'cmd', args: ['/c', 'npx', '-y', PACKAGE_SPEC] });
  for (const platform of POSIX) assert.deepEqual(serverEntry(platform), { command: 'npx', args: ['-y', PACKAGE_SPEC] }, platform);
});

test('install writes the Windows server entry, stays idempotent, and gives a PowerShell-safe hint', (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  const roots = { ...fx.roots, platform: 'win32' };
  const first = install(roots, { now: 1 });
  const mcpFile = path.join(roots.kiro.dir, 'settings', 'mcp.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(mcpFile, 'utf-8')).mcpServers[SERVER_NAME], serverEntry('win32'));
  assert.equal(first.mcp.status, 'added');
  assert.equal(install(roots, { now: 2 }).mcp.status, 'unchanged');
  assert.match(first.next, /every " written as \\"/);
  assert.equal(install({ ...fx.roots, platform: 'linux' }, { now: 3 }).mcp.status, 'updated', 'switching OS rewrites the entry');
});

test('call hint: single-quoted JSON on POSIX, escaped quotes on Windows', () => {
  for (const platform of POSIX) assert.equal(callHint(platform), `npx -y ${PACKAGE_SPEC} call <tool> '<json args>'`);
  assert.equal(callHint('win32'), `npx -y ${PACKAGE_SPEC} call <tool> '<json args, every " written as \\">'`);
});

test('shell quoting: POSIX closes and reopens quotes, PowerShell doubles them', () => {
  assert.equal(shellQuote("it's", 'linux'), `'it'\\''s'`);
  assert.equal(shellQuote("it's", 'darwin'), `'it'\\''s'`);
  assert.equal(shellQuote("it's", 'win32'), `'it''s'`);
});

test('resume command: cd && on POSIX, Set-Location; on Windows (PowerShell 5 has no &&)', () => {
  assert.equal(resumeCommand('sess_x', '/a b/it\'s', 'darwin'), `cd '/a b/it'\\''s' && kiro-cli chat --v3 --resume-id sess_x`);
  assert.equal(resumeCommand('sess_x', 'C:\\a b\\it\'s', 'win32'),
    `Set-Location -LiteralPath 'C:\\a b\\it''s' -ErrorAction Stop; kiro-cli chat --v3 --resume-id sess_x`);
  assert.equal(resumeCommand('sess_x', null, 'win32'), 'kiro-cli chat --v3 --resume-id sess_x');
  assert.equal(inDirectory('C:\\x', 'echo', 'win32'), `Set-Location -LiteralPath 'C:\\x' -ErrorAction Stop; echo`);
});

test('workspace paths: Windows lowercases, uses forward slashes, keeps UNC and drive roots', () => {
  assert.equal(normalizeWorkspacePath('C:\\Work\\App\\', 'win32'), 'c:/work/app');
  assert.equal(normalizeWorkspacePath('\\\\Server\\Share\\Proj', 'win32'), '//server/share/proj');
  assert.equal(normalizeWorkspacePath('C:\\', 'win32'), 'c:/');
  assert.equal(normalizeWorkspacePath('/Users/Me/App/', 'darwin'), '/Users/Me/App');
  assert.equal(bucketFor('C:\\Work\\App', 'win32'), bucketFor('c:/work/app/', 'win32'));
  assert.notEqual(bucketFor('/a/App', 'linux'), bucketFor('/a/app', 'linux'));
});

test('sameWorkspacePath: case-insensitive and slash-agnostic only on Windows', () => {
  assert.equal(sameWorkspacePath('C:\\Work\\App', 'c:/work/app/', 'win32'), true);
  assert.equal(sameWorkspacePath('C:\\Work\\App', 'C:\\Work\\Other', 'win32'), false);
  assert.equal(sameWorkspacePath('/a/App', '/a/App/', 'linux'), true);
  assert.equal(sameWorkspacePath('/a/App', '/a/app', 'linux'), false);
  assert.equal(sameWorkspacePath('/a/App', '/a/app', 'darwin'), false, 'macOS keeps case, matching the Kiro engine');
  assert.equal(sameWorkspacePath(null, '/a', 'linux'), false);
});

test('Cursor Agent folder names decode to drive paths on Windows and root paths elsewhere', () => {
  const onDisk = (paths) => (p) => paths.includes(p);
  const win = onDisk(['C:\\Users', 'C:\\Users\\me', 'C:\\Users\\me\\my-app']);
  assert.equal(decodeProjectDir('c-Users-me-my-app', { platform: 'win32', exists: win }), 'C:\\Users\\me\\my-app');
  assert.equal(decodeProjectDir('C--Users-me-my-app', { platform: 'win32', exists: win }), 'C:\\Users\\me\\my-app');
  assert.equal(decodeProjectDir('d-src-x', { platform: 'win32', exists: () => false }), 'D:\\src\\x', 'unknown folders fall back to the naive split');
  const posix = onDisk(['/home', '/home/me', '/home/me/my-app']);
  for (const platform of POSIX) {
    assert.equal(decodeProjectDir('home-me-my-app', { platform, exists: posix }), '/home/me/my-app', platform);
  }
});

test('Claude cwd filter matches regardless of case and trailing slash on Windows only', async (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  const dir = path.join(fx.roots.claude.projectsDir, 'C--Work-App');
  fs.mkdirSync(dir, { recursive: true });
  const line = { type: 'user', cwd: 'C:\\Work\\App', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'hello' } };
  fs.writeFileSync(path.join(dir, 's1.jsonl'), `${JSON.stringify(line)}\n`);
  const claude = sessionSource('claude-code');
  const win = { ...fx.roots, platform: 'win32' };
  assert.deepEqual((await claude.listSessions(win, { cwd: 'c:\\work\\app\\' })).map((s) => s.id), ['s1']);
  assert.deepEqual((await claude.listSessions(win, { cwd: 'C:/Work/App' })).map((s) => s.id), ['s1']);
  assert.equal((await claude.listSessions({ ...fx.roots, platform: 'linux' }, { cwd: 'c:\\work\\app' })).length, 0);
});

test('Cursor data folder: %APPDATA% on Windows, Library on macOS, ~/.config on Linux', () => {
  const home = path.join(path.sep, 'h');
  assert.equal(resolveRoots({ home, env: { APPDATA: 'D:\\Roam' }, platform: 'win32' }).cursor.userDir, path.join('D:\\Roam', 'Cursor', 'User'));
  assert.equal(resolveRoots({ home, env: {}, platform: 'win32' }).cursor.userDir, path.join(home, 'AppData', 'Roaming', 'Cursor', 'User'));
  assert.equal(resolveRoots({ home, env: {}, platform: 'darwin' }).cursor.userDir, path.join(home, 'Library', 'Application Support', 'Cursor', 'User'));
  assert.equal(resolveRoots({ home, env: {}, platform: 'linux' }).cursor.userDir, path.join(home, '.config', 'Cursor', 'User'));
});

test('atomic rename retries Windows lock errors with backoff, then gives up with the cause', () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    let calls = 0;
    const delays = [];
    renameWithRetry('a', 'b', { rename: () => { if (++calls < 3) throw lockError(code); }, sleep: (ms) => delays.push(ms) });
    assert.equal(calls, 3, code);
    assert.deepEqual(delays, [20, 40], code);
  }
  let calls = 0;
  assert.throws(() => renameWithRetry('a', 'b', { rename: () => { calls++; throw lockError('EBUSY'); }, sleep: () => {} }),
    (err) => /Cannot replace b \(EBUSY\) after 6 attempt/.test(err.message) && err.cause.code === 'EBUSY');
  assert.equal(calls, 6);
  calls = 0;
  assert.throws(() => renameWithRetry('a', 'b', { rename: () => { calls++; throw lockError('ENOENT'); }, sleep: () => {} }), /ENOENT/);
  assert.equal(calls, 1, 'non-lock errors are not retried');
});
