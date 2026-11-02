// Tool-name translation from other agents into Kiro V3 built-in tool ids.
// Kiro ids were read from the kiro-cli 2.26.1 agent engine bundle.

export const CLAUDE_TO_KIRO_TOOL = Object.freeze({
  Read: 'read_file',
  Write: 'fs_write',
  Edit: 'str_replace',
  MultiEdit: 'str_replace',
  NotebookEdit: 'fs_write',
  Bash: 'execute_bash',
  Grep: 'grep_search',
  Glob: 'file_search',
  LS: 'list_directory',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  Task: 'invoke_sub_agent',
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
    const kiro = CLAUDE_TO_KIRO_TOOL[base];
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
