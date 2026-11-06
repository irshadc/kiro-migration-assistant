// Native Windows checks. Run with `npm run test:windows`; skipped on other OSes.
// They start real cmd.exe / PowerShell processes and hold real file locks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { inDirectory, shellQuote } from '../../src/common/platform.js';
import { writeAtomic } from '../../src/common/files.js';
import { serverEntry } from '../../src/install.js';
import { resolveRoots } from '../../src/roots.js';
import { bucketFor, sameWorkspacePath } from '../../src/sessions/kiro-v3-writer.js';
import { decodeProjectDir } from '../../src/sources/cursor/agent-sessions.js';
import { cursorProjectDirName, makeFixture } from '../helpers/fixtures.js';

const skip = process.platform !== 'win32' && 'needs Windows';
const POWERSHELL = 'powershell.exe';
const MARKER = 'KMA_RAN';
const LOCK_HOLD_MS = 300;

const powershell = (command) => spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf-8' });

test('win32: bare npx cannot start without a shell, the installed cmd /c entry can', { skip }, (t) => {
  const bare = spawnSync('npx', ['--version'], { encoding: 'utf-8' });
  assert.ok(bare.error, 'npx is npx.cmd on Windows, so a shell-less spawn must fail');
  const { command, args } = serverEntry();
  assert.equal(command, 'cmd');
  const viaCmd = spawnSync(command, [...args.slice(0, 2), '--version'], { encoding: 'utf-8' });
  if (viaCmd.status !== 0 && /not recognized/i.test(viaCmd.stderr)) return t.skip('npx is not on PATH');
  assert.equal(viaCmd.status, 0, viaCmd.stderr);
});

test('win32: the resume command changes folder in PowerShell and stops when it is missing', { skip }, (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  const dir = path.join(fx.ws, "with space and it's");
  fs.mkdirSync(dir);
  const ok = powershell(inDirectory(dir, '(Get-Location).ProviderPath', 'win32'));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim().toLowerCase(), dir.toLowerCase());
  const missing = powershell(inDirectory(path.join(fx.ws, 'missing'), `'${MARKER}'`, 'win32'));
  assert.ok(!missing.stdout.includes(MARKER), 'the command after Set-Location must not run');
});

test('win32: drive-letter case and slashes do not split one workspace into two buckets', { skip }, () => {
  const cwd = process.cwd();
  assert.equal(bucketFor(cwd), bucketFor(cwd.toUpperCase()));
  assert.equal(bucketFor(cwd), bucketFor(`${cwd.replace(/\\/g, '/')}/`));
  assert.ok(sameWorkspacePath(cwd, cwd.toLowerCase()));
});

test('win32: Cursor Agent folder names decode to a drive path on the real disk', { skip }, (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  const dir = path.join(fx.ws, 'my-app');
  fs.mkdirSync(dir);
  assert.ok(sameWorkspacePath(decodeProjectDir(cursorProjectDirName(dir)), dir));
});

test('win32: Cursor IDE data is read from %APPDATA%\\Cursor', { skip }, () => {
  assert.equal(resolveRoots().cursor.userDir, path.join(process.env.APPDATA, 'Cursor', 'User'));
});

test('win32: atomic writes wait for a file another process has locked', { skip }, async (t) => {
  const fx = makeFixture({ withSources: false });
  t.after(fx.cleanup);
  const file = path.join(fx.ws, 'held.json');
  fs.writeFileSync(file, 'old');
  // FileShare 'Read' forbids delete/rename, which is what Kiro or antivirus holding the file looks like.
  const holder = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
    `$f = [System.IO.File]::Open(${shellQuote(file, 'win32')}, 'Open', 'Read', 'Read'); [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); Start-Sleep -Milliseconds ${LOCK_HOLD_MS}; $f.Close()`]);
  const exited = once(holder, 'exit');
  await new Promise((resolve, reject) => {
    holder.stdout.on('data', (d) => { if (String(d).includes('locked')) resolve(); });
    holder.on('error', reject);
  });
  writeAtomic(file, 'new');
  await exited;
  assert.equal(fs.readFileSync(file, 'utf-8'), 'new');
});
