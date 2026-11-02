// Registry of every supported source. Session sources and config sources are
// separate because Cursor has two session stores but one config layout.
import * as claudeSessions from './claude-code/sessions.js';
import * as claudeConfig from './claude-code/config.js';
import * as cursorIdeSessions from './cursor/ide-sessions.js';
import * as cursorAgentSessions from './cursor/agent-sessions.js';
import * as cursorConfig from './cursor/config.js';
import * as codexSessions from './codex/sessions.js';
import * as codexConfig from './codex/config.js';
import * as kiroLegacyConfig from './kiro/config.js';

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
  kiro: { label: 'Kiro IDE hooks', ...kiroLegacyConfig },
});

// Sources used when the caller names none: other agents only. Converting Kiro
// IDE hooks ('kiro') for kiro-cli V3 is a separate, explicit step. Older kiro-cli
// sessions and JSON agents need no step: V3 resumes V2 sessions by id and
// upgrades V2 JSON agents in place itself (verified with kiro-cli 2.26.1).
export const UPGRADE_CONFIG_SOURCES = Object.freeze(['kiro']);
export const DEFAULT_SESSION_SOURCES = Object.freeze(Object.keys(SESSION_SOURCES));
export const DEFAULT_CONFIG_SOURCES = Object.freeze(Object.keys(CONFIG_SOURCES).filter((s) => !UPGRADE_CONFIG_SOURCES.includes(s)));

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
