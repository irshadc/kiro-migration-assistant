// Native Linux checks. Run with `npm run test:linux`; skipped on other OSes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { resolveRoots } from '../../src/roots.js';
import { registerPosixChecks } from './posix-checks.js';

const skip = process.platform !== 'linux' && 'needs linux';

registerPosixChecks('linux');

test('linux: Cursor IDE data is read from ~/.config/Cursor', { skip }, () => {
  assert.equal(resolveRoots().cursor.userDir, path.join(os.homedir(), '.config', 'Cursor', 'User'));
});
