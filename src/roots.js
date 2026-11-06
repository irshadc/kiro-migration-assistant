// Locations of every tool's data. All paths derive from one object so tests
// (and users with non-default installs) can point the migrator anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function appDataDir(home, appName, platform) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', appName);
  if (platform === 'win32') return path.join(home, 'AppData', 'Roaming', appName);
  return path.join(home, '.config', appName);
}

/**
 * Resolve tool roots. Honors only each tool's own override variable
 * (CLAUDE_CONFIG_DIR, CODEX_HOME); everything else uses the tool's default.
 * With CLAUDE_CONFIG_DIR set, Claude Code keeps .claude.json inside that folder.
 */
export function resolveRoots({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return {
    home,
    platform,
    claude: {
      dir: claudeDir,
      projectsDir: path.join(claudeDir, 'projects'),
      globalConfigFile: env.CLAUDE_CONFIG_DIR ? path.join(claudeDir, '.claude.json') : path.join(home, '.claude.json'),
    },
    cursor: {
      dir: path.join(home, '.cursor'),
      userDir: path.join(appDataDir(home, 'Cursor', platform), 'User'),
    },
    codex: {
      dir: env.CODEX_HOME || path.join(home, '.codex'),
    },
    kiro: {
      dir: path.join(home, '.kiro'),
    },
  };
}

// Per-call source folder overrides, the `paths` tool argument.
export const SOURCE_PATH_KEYS = ['claudeDir', 'claudeJson', 'cursorDir', 'cursorUserDir', 'codexDir'];

function expandPath(home, key, value) {
  const expanded = value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw new Error(`paths.${key} must be an absolute path or start with ~/ (got "${value}")`);
  return path.resolve(expanded);
}

/** Return roots with the given source folders replaced. The Kiro target is never changed here. */
export function withSourcePaths(roots, paths) {
  if (!paths) return roots;
  const p = Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, expandPath(roots.home, k, v)]));
  const claudeDir = p.claudeDir || roots.claude.dir;
  return {
    ...roots,
    claude: {
      dir: claudeDir,
      projectsDir: path.join(claudeDir, 'projects'),
      globalConfigFile: p.claudeJson || roots.claude.globalConfigFile,
    },
    cursor: { dir: p.cursorDir || roots.cursor.dir, userDir: p.cursorUserDir || roots.cursor.userDir },
    codex: { dir: p.codexDir || roots.codex.dir },
  };
}

/** The folders each source tool is read from, and whether each exists. */
export function sourceLocations(roots) {
  const at = (key, p) => ({ key, path: p, exists: fs.existsSync(p) });
  return {
    'claude-code': [at('claudeDir', roots.claude.dir), at('claudeJson', roots.claude.globalConfigFile)],
    cursor: [at('cursorDir', roots.cursor.dir), at('cursorUserDir', roots.cursor.userDir)],
    codex: [at('codexDir', roots.codex.dir)],
  };
}

/** Source paths grouped by global user scope and the current project scope. */
export function sourceLocationsByScope(roots, workspace) {
  const at = (key, p) => ({ key, path: p, exists: fs.existsSync(p) });
  const user = sourceLocations(roots);
  const workspacePaths = workspace ? {
    'claude-code': [
      at('workspaceClaudeDir', path.join(workspace, '.claude')),
      at('workspaceClaudeFile', path.join(workspace, 'CLAUDE.md')),
      at('workspaceMcpFile', path.join(workspace, '.mcp.json')),
    ],
    cursor: [
      at('workspaceCursorDir', path.join(workspace, '.cursor')),
      at('workspaceCursorRules', path.join(workspace, '.cursorrules')),
    ],
    codex: [at('workspaceCodexDir', path.join(workspace, '.codex'))],
  } : { 'claude-code': [], cursor: [], codex: [] };
  return Object.fromEntries(Object.keys(user).map((source) => [source, { user: user[source], workspace: workspacePaths[source] }]));
}
