import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, stringifyFrontmatter } from '../src/common/frontmatter.js';
import { parseToml } from '../src/sources/codex/toml.js';
import { mapClaudeMatcher, mapClaudeTools } from '../src/config/tool-names.js';
import { safeName } from '../src/config/converters.js';

test('frontmatter: scalars, inline lists, block lists, body', () => {
  const { data, body } = parseFrontmatter('---\nname: x\nn: 3\nok: true\ntags: [a, "b c"]\nlist:\n  - one\n  - two\nempty:\n---\n\n# Body\n');
  assert.deepEqual(data, { name: 'x', n: 3, ok: true, tags: ['a', 'b c'], list: ['one', 'two'], empty: null });
  assert.equal(body, '# Body\n');
});

test('frontmatter: no fence returns whole text as body', () => {
  assert.deepEqual(parseFrontmatter('hello\n'), { data: {}, body: 'hello\n' });
});

test('frontmatter: nested values are kept raw, not dropped', () => {
  const { data } = parseFrontmatter('---\nhooks:\n  stop:\n    - a\n---\nx');
  assert.match(String(data.hooks), /stop:/);
});

test('frontmatter: round trip quotes risky strings', () => {
  const text = stringifyFrontmatter({ name: 'n', description: 'has: colon', tools: '*', v: 'true', skip: undefined, list: ['a'] }, 'Body');
  const back = parseFrontmatter(text);
  assert.deepEqual(back.data, { name: 'n', description: 'has: colon', tools: '*', v: 'true', list: ['a'] });
  assert.equal(back.body, 'Body\n');
});

test('toml: tables, quoted keys, multi-line arrays, inline tables', () => {
  const t = parseToml('a = 1\n[mcp_servers.fs]\ncommand = "npx"\nargs = [\n "-y",\n "x", # c\n]\nenv = { K = "v", "Q" = \'w\' }\n[mcp_servers."web search"]\nurl = \'u\'\nenabled = false\n');
  assert.equal(t.a, 1);
  assert.deepEqual(t.mcp_servers.fs, { command: 'npx', args: ['-y', 'x'], env: { K: 'v', Q: 'w' } });
  assert.deepEqual(t.mcp_servers['web search'], { url: 'u', enabled: false });
});

test('toml: unsupported syntax reports the line', () => {
  assert.throws(() => parseToml('ok = 1\nbad = @nope\n'), /line 2/);
});

test('tool names: Claude tools map to Kiro ids, unknown ones reported', () => {
  assert.deepEqual(mapClaudeTools(['Read', 'Edit', 'MultiEdit', 'Bash(git:*)', 'Foo']), { mapped: ['read_file', 'str_replace', 'execute_bash'], unmapped: ['Foo'] });
});

test('tool names: hook matchers', () => {
  assert.deepEqual(mapClaudeMatcher('*'), { matcher: undefined, unmapped: [] });
  assert.deepEqual(mapClaudeMatcher('Bash'), { matcher: 'execute_bash', unmapped: [] });
  assert.equal(mapClaudeMatcher('Write|Edit').matcher, '^(fs_write|str_replace)$');
  assert.equal(mapClaudeMatcher('mcp__a__b').matcher, null);
});

test('safeName blocks path traversal', () => {
  assert.equal(safeName('../../etc/passwd'), 'etc-passwd');
  assert.equal(safeName('My Skill'), 'my-skill');
  assert.throws(() => safeName('///'));
});
