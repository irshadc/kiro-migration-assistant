// Read-only SQLite access through Node's built-in driver (no native build step).
import { DatabaseSync } from 'node:sqlite';
import { isFile } from './files.js';

/** Run `fn(db)` against a read-only connection that is always closed afterwards. */
export function withReadOnlyDb(file, fn) {
  if (!isFile(file)) throw new Error(`SQLite database not found: ${file}`);
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (err) {
    throw new Error(`Cannot open ${file} read-only: ${err.message}`);
  }
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function asText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return Buffer.from(value).toString('utf-8');
}
