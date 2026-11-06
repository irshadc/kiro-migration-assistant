// Native checks shared by macos.test.js and linux.test.js. They run real
// processes (sh, npx) and real files, so they only make sense on that OS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inDirectory } from '../../src/common/platform.js';
import { writeAtomic } from '../../src/common/files.js';
import { serverEntry } from '../../src/install.js';
import { bucketFor } from '../../src/sessions/kiro-v3-writer.js';
import { decodeProjectDir } from '../../src/sources/cursor/agent-sessions.js';
import { cursorProjectDirName, makeFixture } from '../helpers/fixtures.js';

const MARKER = 'KMA_RAN';

/** Register the POSIX native tests; every one is skipped unless running on `platform`. */
export function registerPosixChecks(platform) {
  const skip = process.platform !== platform && `needs ${platform}`;

  test(`${platform}: the installed MCP command starts without a shell`, { skip }, (t) => {
    const { command } = serverEntry();
    const res = spawnSync(command, ['--version'], { encoding: 'utf-8' });
    if (res.error?.code === 'ENOENT') return t.skip(`${command} is not on PATH`);
    assert.equal(res.status, 0, res.stderr);
  });

  test(`${platform}: the resume command changes folder in sh and stops when it is missing`, { skip }, (t) => {
    const fx = makeFixture({ withSources: false });
    t.after(fx.cleanup);
    const dir = path.join(fx.ws, "with space and it's");
    fs.mkdirSync(dir);
    const ok = spawnSync('sh', ['-c', inDirectory(dir, 'pwd', platform)], { encoding: 'utf-8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim(), dir);
    const missing = spawnSync('sh', ['-c', inDirectory(path.join(fx.ws, 'missing'), `echo ${MARKER}`, platform)], { encoding: 'utf-8' });
    assert.notEqual(missing.status, 0);
    assert.ok(!missing.stdout.includes(MARKER), 'the command after cd must not run');
  });

  test(`${platform}: session buckets are case-sensitive`, { skip }, () => {
    assert.notEqual(bucketFor('/work/App'), bucketFor('/work/app'));
  });

  test(`${platform}: Cursor Agent folder names decode against the real disk`, { skip }, (t) => {
    const fx = makeFixture({ withSources: false });
    t.after(fx.cleanup);
    const dir = path.join(fx.ws, 'my-app');
    fs.mkdirSync(dir);
    assert.equal(decodeProjectDir(cursorProjectDirName(dir)), dir);
  });

  test(`${platform}: atomic writes replace a file another handle has open`, { skip }, (t) => {
    const fx = makeFixture({ withSources: false });
    t.after(fx.cleanup);
    const file = path.join(fx.ws, 'held.json');
    fs.writeFileSync(file, 'old');
    const fd = fs.openSync(file, 'r');
    t.after(() => fs.closeSync(fd));
    writeAtomic(file, 'new');
    assert.equal(fs.readFileSync(file, 'utf-8'), 'new');
  });
}
