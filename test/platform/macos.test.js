// Native macOS checks. Run with `npm run test:macos`; skipped on other OSes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { resolveRoots } from '../../src/roots.js';
import { registerPosixChecks } from './posix-checks.js';

const skip = process.platform !== 'darwin' && 'needs macOS';

registerPosixChecks('darwin');

test('darwin: Cursor IDE data is read from ~/Library/Application Support/Cursor', { skip }, () => {
  assert.equal(resolveRoots().cursor.userDir, path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User'));
});
