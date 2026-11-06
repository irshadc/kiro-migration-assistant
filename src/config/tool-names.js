// Tool-name translation from Claude Code into current Kiro CLI V3 selectors.
// Current selectors were verified against the Kiro configuration reference and
// local JSON agents accepted by kiro-cli 2.26.1.

export const CLAUDE_TO_KIRO_TOOL = Object.freeze({
  Read: 'read',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
  Bash: 'shell',
  Grep: 'grep',
  Glob: 'glob',
  LS: 'read',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  Skill: 'skill',
  Task: 'subagent',
  Agent: 'subagent',
});

/**
 * Map a list of Claude tool names to Kiro ids.
 * Returns `{ mapped, unmapped }`; `mapped` is de-duplicated and order-preserving.
 */
export function mapClaudeTools(names) {
  const mapped = [];
  const unmapped = [];
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    const base = name.replace(/\(.*\)$/, ''); // "Bash(git:*)" permission syntax
    let kiro = CLAUDE_TO_KIRO_TOOL[base];
    if (!kiro && base.startsWith('mcp__')) {
      const split = base.indexOf('__', 5);
      if (split > 5 && split < base.length - 2) kiro = `@${base.slice(5, split)}/${base.slice(split + 2)}`;
    }
    if (kiro) { if (!mapped.includes(kiro)) mapped.push(kiro); } else unmapped.push(name);
  }
  return { mapped, unmapped };
}

/**
 * Translate a Claude hook matcher ("Write|Edit", "Bash", "*", "") into a Kiro
 * matcher regex. Returns `{ matcher, unmapped }`; matcher `undefined` = all tools.
 */
export function mapClaudeMatcher(matcher) {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') {
    return { matcher: undefined, unmapped: [] };
  }
  const { mapped, unmapped } = mapClaudeTools(String(matcher).split('|'));
  if (mapped.length === 0) return { matcher: null, unmapped };
  return { matcher: mapped.length === 1 ? mapped[0] : `^(${mapped.join('|')})$`, unmapped };
}
