// Hook conversion into Kiro's v2 hook files: <root>/hooks/<name>.json =
//   { version: 'v1', hooks: [{ name, trigger, matcher?, action, timeout? }] }
// Kiro's canonical trigger names equal Claude Code's event names, and Kiro
// pipes Claude-style JSON (session_id, hook_event_name, cwd, ...) on stdin.
import path from 'node:path';
import { mapClaudeMatcher } from './tool-names.js';

const CLAUDE_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart', 'SessionEnd']);
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

// Cursor hooks.json events -> [Kiro trigger, matcher]
const CURSOR_EVENTS = Object.freeze({
  beforeShellExecution: ['PreToolUse', 'shell'],
  beforeReadFile: ['PreToolUse', 'read'],
  afterFileEdit: ['PostToolUse', 'write'],
  beforeSubmitPrompt: ['UserPromptSubmit', undefined],
  stop: ['Stop', undefined],
});

function claudeHooks(raw, warnings) {
  const hooks = [];
  for (const [event, groups] of Object.entries(raw)) {
    if (!CLAUDE_EVENTS.has(event)) { warnings.push(`event ${event} has no Kiro equivalent; skipped`); continue; }
    (Array.isArray(groups) ? groups : []).forEach((group, gi) => {
      let matcher;
      if (TOOL_EVENTS.has(event)) {
        const m = mapClaudeMatcher(group.matcher);
        if (m.unmapped.length) warnings.push(`${event}: matcher tools without a Kiro equivalent: ${m.unmapped.join(', ')}`);
        if (m.matcher === null) return;
        matcher = m.matcher;
      }
      (group.hooks || []).forEach((h, hi) => {
        const action = h.type === 'prompt' ? { type: 'agent', prompt: h.prompt } : { type: 'command', command: h.command };
        if (!action.command && !action.prompt) { warnings.push(`${event}: hook ${gi}.${hi} has no command; skipped`); return; }
        hooks.push({ name: `claude-${event}-${gi}-${hi}`, trigger: event, ...(matcher ? { matcher } : {}), action, ...(h.timeout ? { timeout: h.timeout } : {}) });
      });
    });
  }
  return hooks;
}

/** Convert Claude hook groups into current Kiro inline hook documents. */
export function convertClaudeInlineHooks(raw) {
  const warnings = [];
  const hooks = claudeHooks(raw || {}, warnings);
  return { hooks, warnings };
}

function cursorHooks(raw, warnings) {
  const hooks = [];
  for (const [event, list] of Object.entries(raw)) {
    const mapping = CURSOR_EVENTS[event];
    if (!mapping) { warnings.push(`event ${event} has no Kiro equivalent; skipped`); continue; }
    const [trigger, matcher] = mapping;
    (Array.isArray(list) ? list : []).forEach((h, i) => {
      if (!h.command) return;
      hooks.push({ name: `cursor-${event}-${i}`, trigger, ...(matcher ? { matcher } : {}), action: { type: 'command', command: h.command } });
    });
  }
  if (hooks.length) warnings.push('Cursor hook scripts read Cursor-shaped JSON on stdin and reply with Cursor permission JSON; review them against Kiro\'s Claude-style payload');
  return hooks;
}

export function convertHooks(item) {
  const warnings = [];
  const hooks = item.format === 'cursor' ? cursorHooks(item.hooks, warnings) : claudeHooks(item.hooks, warnings);
  if (!hooks.length) return { ops: [], warnings: [...warnings, 'no convertible hooks'] };
  const targetName = item.targetName || `${item.source}-${path.basename(item.name, '.json')}`;
  const base = targetName.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const target = path.join('hooks', `${base}.json`);
  return { ops: [{ target, content: JSON.stringify({ version: 'v1', hooks }, null, 2) + '\n' }], warnings };
}
