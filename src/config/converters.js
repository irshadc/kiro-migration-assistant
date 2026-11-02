// Pure converters: config item -> planned Kiro file operations.
// Each returns { ops: [{ target, content } | { target, copyFrom, overrides }], warnings }.
// Paths are relative to the scope root (<kiro dir> or <workspace>/.kiro).
import path from 'node:path';
import { readText } from '../common/files.js';
import { parseFrontmatter, stringifyFrontmatter } from '../common/frontmatter.js';
import { mapClaudeTools } from './tool-names.js';

const DESCRIPTION_MAX = 200;

/** Kiro resource names: lowercase letters, digits, '-', '_'. Never a path. */
export function safeName(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) throw new Error(`Cannot derive a safe name from "${name}"`);
  return s;
}

function firstLine(body) {
  const line = body.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean);
  return (line || '').slice(0, DESCRIPTION_MAX);
}

export function convertSkill(item) {
  const name = safeName(item.name);
  const skillFile = path.join(item.path, 'SKILL.md');
  const { data, body } = parseFrontmatter(readText(skillFile));
  const warnings = [];
  const overrides = {};
  if (data.name !== name || !data.description) {
    if (data.name && data.name !== name) warnings.push(`front matter name "${data.name}" renamed to "${name}" to match its folder`);
    overrides['SKILL.md'] = stringifyFrontmatter({ ...data, name, description: data.description || firstLine(body) }, body);
  }
  return { ops: [{ target: path.join('skills', name), copyFrom: item.path, overrides }], warnings };
}

/** Slash command (markdown prompt) -> Kiro skill. */
export function convertCommand(item) {
  const name = safeName(item.name);
  const { data, body } = parseFrontmatter(readText(item.path));
  const warnings = [];
  let text = body;
  if (/\$ARGUMENTS|\$\d/.test(body)) {
    text = `${body.trimEnd()}\n\n> Migrated from a ${item.source} slash command: \`$ARGUMENTS\` / \`$1\`… mean the text the user gave when invoking this skill.\n`;
  }
  if (data['allowed-tools']) warnings.push('allowed-tools is not enforced for Kiro skills');
  const fm = { name, description: data.description || firstLine(body) || `Migrated ${item.source} command ${item.name}` };
  return { ops: [{ target: path.join('skills', name, 'SKILL.md'), content: stringifyFrontmatter(fm, text) }], warnings };
}

/** Claude Code sub-agent (.claude/agents/*.md) -> Kiro agent profile (.kiro/agents/*.md). */
export function convertAgent(item) {
  const { data, body } = parseFrontmatter(readText(item.path));
  const name = safeName(data.name || item.name);
  const warnings = [];
  let tools = '*';
  if (data.tools !== undefined && data.tools !== null) {
    const list = Array.isArray(data.tools) ? data.tools : String(data.tools).split(',');
    const { mapped, unmapped } = mapClaudeTools(list);
    tools = mapped;
    if (unmapped.length) warnings.push(`tools without a Kiro equivalent were dropped: ${unmapped.join(', ')}`);
    if (!mapped.length) warnings.push('no tools mapped; the agent will have no built-in tools until you edit it');
  }
  if (data.model) warnings.push(`model "${data.model}" not carried over; Kiro uses its default model`);
  const fm = { name, description: data.description || firstLine(body), tools };
  return { ops: [{ target: path.join('agents', `${name}.md`), content: stringifyFrontmatter(fm, body) }], warnings };
}

const MCP_KEYS = ['command', 'args', 'env', 'cwd', 'url', 'headers', 'disabled', 'timeout', 'disabledTools', 'autoApprove'];

/** One server definition -> Kiro mcp.json entry. */
export function convertMcpServer(name, cfg) {
  const warnings = [];
  const out = {};
  for (const k of MCP_KEYS) if (cfg[k] !== undefined) out[k] = cfg[k];
  const type = cfg.type || cfg.transport;
  if (type && type !== 'stdio') out.type = type;
  const dropped = Object.keys(cfg).filter((k) => !MCP_KEYS.includes(k) && k !== 'type' && k !== 'transport');
  if (dropped.length) warnings.push(`${name}: dropped unsupported keys ${dropped.join(', ')}`);
  if (!out.command && !out.url) warnings.push(`${name}: has neither command nor url`);
  if (JSON.stringify(out).includes('${')) warnings.push(`${name}: uses \${VAR} placeholders; check that Kiro expands them the same way`);
  return { server: out, warnings };
}

function cursorRuleFrontmatter(data) {
  if (data.alwaysApply === true) return { inclusion: 'always' };
  const globs = Array.isArray(data.globs) ? data.globs : String(data.globs || '').split(',').map((g) => g.trim()).filter(Boolean);
  if (globs.length) return { inclusion: 'fileMatch', fileMatchPattern: globs.length === 1 ? globs[0] : globs };
  if (data.description) return { inclusion: 'auto', description: data.description };
  return { inclusion: 'manual' };
}

/** CLAUDE.md / AGENTS.md / .cursorrules / .cursor/rules/*.mdc -> steering file. */
export function convertRule(item) {
  const raw = readText(item.path);
  const warnings = [];
  const name = safeName(item.format === 'cursor-mdc' ? `cursor-${item.name}` : item.name);
  let fm = { inclusion: 'always' };
  let body = raw;
  if (item.format === 'cursor-mdc') {
    const parsed = parseFrontmatter(raw);
    fm = cursorRuleFrontmatter(parsed.data);
    if (fm.inclusion === 'auto') fm = { name, ...fm };
    body = parsed.body;
  }
  if (item.format === 'claude-md' && /^@\S+/m.test(raw)) warnings.push('contains @file imports, which Kiro steering does not follow; inline or copy them');
  return { ops: [{ target: path.join('steering', `${name}.md`), content: stringifyFrontmatter(fm, body) }], warnings };
}
