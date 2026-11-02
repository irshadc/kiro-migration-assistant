// Registry of every supported source. Session sources and config sources are
// separate because Cursor has two session stores but one config layout.
import * as claudeSessions from './claude-code/sessions.js';
import * as claudeConfig from './claude-code/config.js';
import * as cursorIdeSessions from './cursor/ide-sessions.js';
import * as cursorAgentSessions from './cursor/agent-sessions.js';
import * as cursorConfig from './cursor/config.js';
import * as codexSessions from './codex/sessions.js';
import * as codexConfig from './codex/config.js';

export const SESSION_SOURCES = Object.freeze({
  'claude-code': { label: 'Claude Code', ...claudeSessions },
  cursor: { label: 'Cursor IDE', ...cursorIdeSessions },
  'cursor-agent': { label: 'Cursor Agent', ...cursorAgentSessions },
  codex: { label: 'Codex CLI', ...codexSessions },
});

export const CONFIG_SOURCES = Object.freeze({
  'claude-code': { label: 'Claude Code', ...claudeConfig },
  cursor: { label: 'Cursor', ...cursorConfig },
  codex: { label: 'Codex CLI', ...codexConfig },
});

export function sessionSource(name) {
  const s = SESSION_SOURCES[name];
  if (!s) throw new Error(`Unknown session source "${name}". Use one of: ${Object.keys(SESSION_SOURCES).join(', ')}`);
  return s;
}

export function configSource(name) {
  const s = CONFIG_SOURCES[name];
  if (!s) throw new Error(`Unknown config source "${name}". Use one of: ${Object.keys(CONFIG_SOURCES).join(', ')}`);
  return s;
}
