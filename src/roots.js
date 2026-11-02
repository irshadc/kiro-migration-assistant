// Locations of every tool's data. All paths derive from one object so tests
// (and users with non-default installs) can point the migrator anywhere.
import os from 'node:os';
import path from 'node:path';

function appDataDir(home, appName, platform) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', appName);
  if (platform === 'win32') return path.join(home, 'AppData', 'Roaming', appName);
  return path.join(home, '.config', appName);
}

/**
 * Resolve tool roots. Honors each tool's own documented override variable
 * (CLAUDE_CONFIG_DIR, CODEX_HOME) plus KMA_* overrides for the rest.
 */
export function resolveRoots({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return {
    home,
    platform,
    claude: {
      dir: claudeDir,
      projectsDir: path.join(claudeDir, 'projects'),
      globalConfigFile: env.KMA_CLAUDE_JSON || path.join(home, '.claude.json'),
    },
    cursor: {
      dir: env.KMA_CURSOR_DIR || path.join(home, '.cursor'),
      userDir: env.KMA_CURSOR_USER_DIR || path.join(appDataDir(home, 'Cursor', platform), 'User'),
    },
    codex: {
      dir: env.CODEX_HOME || path.join(home, '.codex'),
    },
    kiro: {
      dir: env.KMA_KIRO_DIR || path.join(home, '.kiro'),
    },
  };
}
