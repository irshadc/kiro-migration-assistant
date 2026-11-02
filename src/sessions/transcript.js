// The tool-neutral transcript every source adapter produces and the Kiro
// writer consumes:
//
//   Message = { role: 'user'|'assistant', text: string, timestamp?: number,
//               toolCalls?: [{ id?, name, input }],
//               toolResults?: [{ id?, name?, output, isError? }] }
//
// Helpers here keep that model small and well-formed.

const MAX_TOOL_INPUT_CHARS = 600;
const MAX_TOOL_OUTPUT_CHARS = 1500;

export function truncate(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [${s.length - max} chars truncated]`;
}

/** Epoch ms from a number, numeric string or ISO date; undefined when unusable. */
export function toMs(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : (/^\d+$/.test(String(value)) ? Number(value) : Date.parse(value));
  return Number.isFinite(n) ? n : undefined;
}

/** Flatten any content shape (string, Anthropic/OpenAI part arrays) to plain text. */
export function contentToText(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (part.type === 'image' || part.type === 'input_image') return '[image]';
      if (typeof part.content === 'string' || Array.isArray(part.content)) return contentToText(part.content);
      return '';
    }).filter(Boolean).join('\n');
  }
  if (typeof content === 'object' && typeof content.text === 'string') return content.text;
  return JSON.stringify(content);
}

function formatInput(input) {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return truncate(input, MAX_TOOL_INPUT_CHARS);
  return truncate(JSON.stringify(input), MAX_TOOL_INPUT_CHARS);
}

/**
 * Render one assistant message (text + tool activity) as readable text. Tool
 * calls become text because the source tools do not exist in Kiro's toolset.
 */
export function renderAssistant(msg) {
  const parts = [];
  if (msg.text && msg.text.trim()) parts.push(msg.text.trim());
  for (const call of msg.toolCalls || []) {
    parts.push(`[tool call: ${call.name}] ${formatInput(call.input)}`.trimEnd());
  }
  for (const res of msg.toolResults || []) {
    const label = res.name ? `tool result: ${res.name}` : 'tool result';
    const status = res.isError ? ' (error)' : '';
    parts.push(`[${label}${status}] ${truncate(contentToText(res.output), MAX_TOOL_OUTPUT_CHARS)}`.trimEnd());
  }
  return parts.join('\n\n');
}

/** Strip wrapper tags that agents inject into user prompts. */
export function cleanUserText(text) {
  return String(text ?? '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?user_query>/g, '')
    .replace(/<attached_files>[\s\S]*?<\/attached_files>/g, '')
    .trim();
}

/**
 * Normalize a raw message list into strictly alternating user/assistant turns:
 * empty messages are dropped and consecutive same-role messages are merged.
 * Tool results that arrive as user messages (Anthropic style) are attached to
 * the preceding assistant message.
 */
export function toTurns(messages) {
  const turns = [];
  for (const m of messages) {
    if (m.role === 'user' && !m.text?.trim() && m.toolResults?.length) {
      const prev = turns[turns.length - 1];
      if (prev && prev.role === 'assistant') {
        prev.parts.push(renderAssistant({ toolResults: m.toolResults }));
        continue;
      }
    }
    const text = m.role === 'user'
      ? [cleanUserText(m.text), m.toolResults?.length ? renderAssistant({ toolResults: m.toolResults }) : '']
        .filter(Boolean).join('\n\n')
      : renderAssistant(m);
    if (!text.trim()) continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === m.role) {
      prev.parts.push(text);
      continue;
    }
    turns.push({ role: m.role, parts: [text], timestamp: toMs(m.timestamp) });
  }
  return turns.map((t) => ({ role: t.role, text: t.parts.join('\n\n'), timestamp: t.timestamp }));
}

/**
 * Keep the newest turns that fit in `maxChars`. Always keeps at least the last
 * user turn, and starts on a user turn. Returns `{ turns, omitted }`.
 */
export function fitBudget(turns, maxChars) {
  let total = 0;
  let start = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    total += turns[i].text.length;
    if (total > maxChars && start < turns.length) break;
    start = i;
  }
  while (start < turns.length && turns[start].role !== 'user') start++;
  if (start === turns.length && turns.length) start = Math.max(0, turns.findLastIndex((t) => t.role === 'user'));
  return { turns: turns.slice(start), omitted: start };
}
