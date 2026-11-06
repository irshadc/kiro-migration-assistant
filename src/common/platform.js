// Per-OS differences in one place. Every helper takes `platform` explicitly so
// tests can exercise Windows behavior on Linux/macOS and the reverse.
import path from 'node:path';

export const WINDOWS = 'win32';

export const isWindows = (platform) => platform === WINDOWS;

/** The path module for `platform`: path.win32 on Windows, path.posix elsewhere. */
export const platformPath = (platform) => (isWindows(platform) ? path.win32 : path.posix);

/** Quote one argument for the user's default shell: PowerShell on Windows, POSIX sh elsewhere. */
export function shellQuote(value, platform) {
  const s = String(value);
  return isWindows(platform) ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `cd <dir>` then `command`, in the user's default shell. PowerShell 5 has no `&&`, so Windows uses `;`. */
export function inDirectory(dir, command, platform) {
  return isWindows(platform)
    ? `Set-Location -LiteralPath ${shellQuote(dir, platform)} -ErrorAction Stop; ${command}`
    : `cd ${shellQuote(dir, platform)} && ${command}`;
}
