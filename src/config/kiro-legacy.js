// Kiro IDE hooks (<kiro>/hooks/*.kiro.hook, when/then shape) -> the hook files
// kiro-cli V3 reads: hooks/*.json = { version: 'v1', hooks: [...] }, where 'v1'
// is that file's schema version, not an older Kiro. The .kiro.hook file stays
// for Kiro IDE. Trigger and field names were read from the kiro-cli 2.26.1
// engine bundle.
import path from 'node:path';
import { readText } from '../common/files.js';
import { safeName } from './converters.js';

// Kiro IDE `when.type` -> V3 trigger.
const IDE_HOOK_TRIGGERS = Object.freeze({
  promptSubmit: 'UserPromptSubmit', agentStop: 'Stop', sessionStart: 'SessionStart', preToolUse: 'PreToolUse', postToolUse: 'PostToolUse',
  preTaskExecution: 'PreTaskExec', postTaskExecution: 'PostTaskExec', fileEdited: 'PostFileSave', fileCreated: 'PostFileCreate',
  fileDeleted: 'PostFileDelete', userTriggered: 'Manual',
});
const FILE_TRIGGERS = new Set(['PostFileSave', 'PostFileCreate', 'PostFileDelete']);

/** Glob ("src/**\/*.ts") -> regex source matching a relative or absolute path ending in it. */
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return `(^|/)${re}$`;
}

/** Kiro IDE *.kiro.hook -> V3 hooks/<name>.json. */
export function convertIdeHook(item) {
  let raw;
  try { raw = JSON.parse(readText(item.path)); } catch (err) { throw new Error(`Invalid JSON in ${item.path}: ${err.message}`); }
  const warnings = [];
  const trigger = IDE_HOOK_TRIGGERS[raw.when?.type];
  if (!trigger) return { ops: [], warnings: [`trigger ${raw.when?.type} has no V3 equivalent`] };
  let action;
  if (raw.then?.type === 'askAgent' && raw.then.prompt) action = { type: 'agent', prompt: raw.then.prompt };
  else if (raw.then?.type === 'runCommand' && raw.then.command) action = { type: 'command', command: raw.then.command };
  else return { ops: [], warnings: [`action ${raw.then?.type} has no V3 equivalent or is empty`] };
  let matcher;
  const patterns = raw.when?.patterns;
  if (FILE_TRIGGERS.has(trigger) && Array.isArray(patterns) && patterns.length) {
    const parts = patterns.map(globToRegex);
    matcher = parts.length === 1 ? parts[0] : `(${parts.join('|')})`;
    warnings.push(`file patterns ${patterns.join(', ')} became the regex matcher ${matcher}; check it matches the files you expect`);
  }
  const toolTypes = raw.when?.toolTypes;
  if (!FILE_TRIGGERS.has(trigger) && Array.isArray(toolTypes) && toolTypes.length && !toolTypes.includes('*')) {
    matcher = toolTypes.length === 1 ? toolTypes[0] : `^(${toolTypes.join('|')})$`;
    warnings.push(`toolTypes ${toolTypes.join(', ')} became the matcher ${matcher}; check it against V3 tool names`);
  }
  const hook = {
    name: raw.name || item.name, ...(raw.description ? { description: raw.description } : {}), trigger,
    ...(matcher ? { matcher } : {}), action, ...(raw.then?.timeout ? { timeout: raw.then.timeout } : {}),
    ...(raw.enabled === false ? { enabled: false } : {}),
  };
  const base = safeName(item.targetName || item.name);
  warnings.push(`the original ${path.basename(item.path)} is left in place for Kiro IDE`);
  return { ops: [{ target: path.join('hooks', `${base}.json`), content: JSON.stringify({ version: 'v1', hooks: [hook] }, null, 2) + '\n' }], warnings };
}
