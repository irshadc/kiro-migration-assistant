import { parse as parseYaml } from 'yaml';

// Minimal YAML front matter reader/writer for skill, agent, rule and command
// files. Supports the flat subset these tools actually use: scalars, booleans,
// numbers, inline lists `[a, b]` and block lists `- a`. Anything nested is kept
// as its raw text so nothing is silently lost.

const FENCE = '---';

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    const inner = v.slice(1, -1);
    return v.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n') : inner.replace(/''/g, "'");
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((s) => parseScalar(s));
  }
  return v;
}

/** Split `---\n<yaml>\n---\n<body>`. Files without front matter return `{ data: {}, body }`. */
export function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith(FENCE + '\n')) return { data: {}, body: normalized };
  const end = normalized.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) return { data: {}, body: normalized };
  const yaml = normalized.slice(FENCE.length + 1, end);
  const body = normalized.slice(end + FENCE.length + 1).replace(/^\n+/, '');
  const data = {};
  let listKey = null;
  let rawMode = false; // current key holds a nested structure kept verbatim
  for (const line of yaml.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+):\s?(.*)$/);
    if (kv) {
      listKey = kv[1];
      rawMode = false;
      data[kv[1]] = kv[2].trim() === '' ? '' : parseScalar(kv[2]);
      continue;
    }
    if (!listKey) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && !rawMode && (data[listKey] === '' || Array.isArray(data[listKey]))) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(parseScalar(item[1]));
      continue;
    }
    // Nested or folded value: keep raw text rather than guess its meaning.
    rawMode = true;
    const prev = Array.isArray(data[listKey]) ? data[listKey].map((v) => `  - ${v}`).join('\n') : data[listKey];
    data[listKey] = prev ? `${prev}\n${line}` : line;
  }
  for (const [k, v] of Object.entries(data)) if (v === '') data[k] = null;
  return { data, body };
}

/** Parse complete YAML frontmatter for agent files with nested MCP, hook and permission fields. */
export function parseAgentFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith(FENCE + '\n')) return { data: {}, body: normalized };
  const end = normalized.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) throw new Error('frontmatter has no closing --- fence');
  const yaml = normalized.slice(FENCE.length + 1, end);
  const body = normalized.slice(end + FENCE.length + 1).replace(/^\n+/, '');
  let data;
  try { data = parseYaml(yaml) || {}; } catch (err) { throw new Error(`invalid YAML frontmatter: ${err.message}`); }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('agent frontmatter must be a YAML object');
  return { data, body };
}

function needsQuote(s) {
  return s === '' || /^[\s'"[\]{}>|*&!%@`#,?:-]|:\s|\s#|\s$|\n/.test(s)
    || ['true', 'false', 'null', '~'].includes(s) || /^-?\d+(\.\d+)?$/.test(s);
}

function formatScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  return needsQuote(s) ? JSON.stringify(s) : s;
}

/** Serialize data + body back to a front matter document. Undefined keys are omitted. */
export function stringifyFrontmatter(data, body) {
  const lines = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${formatScalar(item)}`);
    } else {
      lines.push(`${k}: ${formatScalar(v)}`);
    }
  }
  const text = body.endsWith('\n') ? body : `${body}\n`;
  return `${FENCE}\n${lines.join('\n')}\n${FENCE}\n\n${text.replace(/^\n+/, '')}`;
}
