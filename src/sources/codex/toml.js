// Just enough TOML to read Codex's `[mcp_servers.<name>]` tables:
// strings (basic + literal), numbers, booleans, string arrays, inline tables,
// dotted table headers. Unsupported syntax throws with the line number so a
// config is never half-read silently.

function parseString(src, i) {
  const quote = src[i];
  let out = '';
  let j = i + 1;
  while (j < src.length && src[j] !== quote) {
    if (quote === '"' && src[j] === '\\') {
      const esc = src[j + 1];
      out += { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' }[esc] ?? esc;
      j += 2;
      continue;
    }
    out += src[j++];
  }
  if (src[j] !== quote) throw new Error('unterminated string');
  return { value: out, next: j + 1 };
}

const skipWs = (src, i) => { while (i < src.length && /[ \t]/.test(src[i])) i++; return i; };

function parseValue(src, i) {
  i = skipWs(src, i);
  const ch = src[i];
  if (ch === '"' || ch === "'") return parseString(src, i);
  if (ch === '[' || ch === '{') {
    const close = ch === '[' ? ']' : '}';
    const result = ch === '[' ? [] : {};
    i++;
    for (;;) {
      i = skipWs(src, i);
      if (src[i] === close) return { value: result, next: i + 1 };
      if (ch === '[') {
        const v = parseValue(src, i);
        result.push(v.value);
        i = v.next;
      } else {
        const keyEnd = src.slice(i).search(/\s*=/);
        if (keyEnd < 0) throw new Error('bad inline table');
        const key = src.slice(i, i + keyEnd).trim().replace(/^["']|["']$/g, '');
        const v = parseValue(src, src.indexOf('=', i) + 1);
        result[key] = v.value;
        i = v.next;
      }
      i = skipWs(src, i);
      if (src[i] === ',') i++;
    }
  }
  const m = src.slice(i).match(/^(true|false|[+-]?\d+(\.\d+)?)/);
  if (!m) throw new Error(`unsupported value near "${src.slice(i, i + 20)}"`);
  const raw = m[1];
  return { value: raw === 'true' ? true : raw === 'false' ? false : Number(raw), next: i + raw.length };
}

function splitKey(key) {
  return key.match(/"[^"]*"|'[^']*'|[^.]+/g).map((k) => k.trim().replace(/^["']|["']$/g, ''));
}

/** Drop a trailing `# comment`, ignoring '#' inside quoted strings. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i).trimEnd();
  }
  return line;
}

/** Parse TOML text into a plain object. Multi-line arrays are joined first. */
export function parseToml(text) {
  const root = {};
  let table = root;
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(stripComment);
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n].replace(/^\s+/, '');
    if (!line || line.startsWith('#')) continue;
    try {
      const header = line.match(/^\[([^\]]+)\]\s*(#.*)?$/);
      if (header) {
        table = root;
        for (const k of splitKey(header[1])) table = table[k] ??= {};
        continue;
      }
      while ((line.split('[').length > line.split(']').length || line.split('{').length > line.split('}').length) && n + 1 < lines.length) {
        line += ` ${lines[++n].trim()}`;
      }
      const eq = line.indexOf('=');
      if (eq < 0) throw new Error('expected key = value');
      const keys = splitKey(line.slice(0, eq).trim());
      let target = table;
      for (const k of keys.slice(0, -1)) target = target[k] ??= {};
      target[keys[keys.length - 1]] = parseValue(line, eq + 1).value;
    } catch (err) {
      throw new Error(`TOML line ${n + 1}: ${err.message}`);
    }
  }
  return root;
}
