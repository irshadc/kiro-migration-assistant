// Source agent declarations -> current Kiro CLI V3 JSON profiles.
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { readText } from '../common/files.js';
import { parseAgentFrontmatter } from '../common/frontmatter.js';
import { convertMcpServer, safeName } from './converters.js';
import { convertClaudeInlineHooks } from './hooks.js';
import { mapClaudeTools } from './tool-names.js';

const WRITE_TOOLS = ['write', 'shell'];
const WRITE_DENIES = [
  { capability: 'fs_write', effect: 'deny' },
  { capability: 'shell', effect: 'deny' },
];

const CLAUDE_UNSUPPORTED = [
  'maxTurns', 'autoCompactWindow', 'memory', 'background', 'omitClaudeMd',
  'effort', 'isolation', 'color', 'initialPrompt', 'experimental',
];

const asList = (value) => value === undefined || value === null
  ? []
  : Array.isArray(value) ? value : String(value).split(',').map((part) => part.trim()).filter(Boolean);

const unique = (values) => [...new Set(values.filter(Boolean))];

function firstLine(text) {
  return text.split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
}

function modelField(value, warnings) {
  if (!value || value === 'inherit') return {};
  warnings.push(`model "${value}" was preserved; verify that this model ID is available in Kiro`);
  return { model: String(value) };
}

function permissionRuleForClaudeTool(raw) {
  const name = String(raw).replace(/\(.*\)$/, '');
  if (['Read', 'Grep', 'Glob', 'LS'].includes(name)) return { capability: 'fs_read', effect: 'deny' };
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return { capability: 'fs_write', effect: 'deny' };
  if (name === 'Bash') return { capability: 'shell', effect: 'deny' };
  if (name === 'WebFetch') return { capability: 'web_fetch', effect: 'deny' };
  if (name === 'WebSearch') return { capability: 'web_search', effect: 'deny' };
  if (name === 'Task' || name === 'Agent') return { capability: 'subagent', effect: 'deny' };
  if (name === 'Skill') return { capability: 'skill', effect: 'deny' };
  if (name.startsWith('mcp__')) {
    const split = name.indexOf('__', 5);
    if (split > 5) return { capability: 'mcp', match: [`${name.slice(5, split)}/${name.slice(split + 2)}`], effect: 'deny' };
  }
  return null;
}

function addRestrictions(config, sourceTools, warnings) {
  const { mapped, unmapped } = mapClaudeTools(asList(sourceTools));
  if (unmapped.length) warnings.push(`excluded tools without a Kiro equivalent were dropped: ${unmapped.join(', ')}`);
  const rules = unique(asList(sourceTools).map(permissionRuleForClaudeTool).filter(Boolean).map(JSON.stringify)).map(JSON.parse);
  if (mapped.length) config.excludedTools = unique([...(config.excludedTools || []), ...mapped]);
  if (rules.length) config.permissions = { rules: [...(config.permissions?.rules || []), ...rules] };
}

function makeReadOnly(config) {
  config.excludedTools = unique([...(config.excludedTools || []), ...WRITE_TOOLS]);
  config.permissions = { rules: [...(config.permissions?.rules || []), ...WRITE_DENIES] };
}

function normalizeMcpServers(value, warnings) {
  const inline = {};
  const references = [];
  const entries = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : asList(value);
  for (const entry of entries) {
    if (typeof entry === 'string') { references.push(entry); continue; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push('an MCP server entry was not an object or server name and was dropped');
      continue;
    }
    for (const [name, sourceConfig] of Object.entries(entry)) {
      if (!sourceConfig || typeof sourceConfig !== 'object' || Array.isArray(sourceConfig)) {
        warnings.push(`MCP server ${name} has no inline configuration and was dropped`);
        continue;
      }
      const converted = convertMcpServer(name, sourceConfig);
      inline[name] = converted.server;
      warnings.push(...converted.warnings);
    }
  }
  return { inline, references: unique(references) };
}

function targetResult(item, config, warnings) {
  const name = safeName(item.targetName || config.name || item.name);
  const output = { ...config, name };
  return {
    ops: [{ target: path.join('agents', `${name}.json`), content: JSON.stringify(output, null, 2) + '\n' }],
    warnings,
  };
}


function addClaudeResources(config, data, warnings) {
  const skills = asList(data.skills).map((skill) => `skill://${skill}`);
  if (skills.length) {
    config.resources = skills;
    warnings.push('agent skill resources require the matching skills to be migrated to Kiro');
  }
  const mcp = normalizeMcpServers(data.mcpServers, warnings);
  if (Object.keys(mcp.inline).length) config.mcpServers = mcp.inline;
  if (mcp.references.length) {
    config.includeMcpJson = true;
    if (!config.tools.includes('*')) config.tools = unique([...config.tools, ...mcp.references.map((name) => `@${name}`)]);
    warnings.push(`referenced MCP servers must also exist in Kiro settings: ${mcp.references.join(', ')}`);
  }
  if (Object.keys(mcp.inline).length && !config.tools.includes('*')) {
    config.tools = unique([...config.tools, ...Object.keys(mcp.inline).map((server) => `@${server}`)]);
  }
  if (data.hooks) {
    const converted = convertClaudeInlineHooks(data.hooks);
    if (converted.hooks.length) config.hooks = converted.hooks;
    warnings.push(...converted.warnings);
  }
}
function convertClaudeAgent(item) {
  const { data, body } = parseAgentFrontmatter(readText(item.path));
  const warnings = [];
  const name = safeName(item.targetName || data.name || item.name);
  const config = {
    name,
    description: data.description || firstLine(body) || `Migrated Claude Code agent ${name}`,
    prompt: body.trimEnd(),
  };

  const sourceTools = data.tools === undefined ? null : asList(data.tools);
  if (sourceTools === null) config.tools = ['*'];
  else {
    const { mapped, unmapped } = mapClaudeTools(sourceTools);
    config.tools = mapped;
    if (unmapped.length) warnings.push(`tools without a Kiro equivalent were dropped: ${unmapped.join(', ')}`);
  }

  addRestrictions(config, data.disallowedTools, warnings);
  Object.assign(config, modelField(data.model, warnings));

  addClaudeResources(config, data, warnings);

  if (data.permissionMode === 'plan') {
    makeReadOnly(config);
    warnings.push('permissionMode plan became Kiro write and shell deny rules');
  } else if (data.permissionMode && data.permissionMode !== 'default' && data.permissionMode !== 'manual') {
    warnings.push(`permissionMode ${data.permissionMode} has no safe exact Kiro mapping and was not granted`);
  }
  for (const key of CLAUDE_UNSUPPORTED) if (data[key] !== undefined) warnings.push(`${key} has no current Kiro agent equivalent and was not carried over`);
  return targetResult(item, config, warnings);
}

function convertCursorAgent(item) {
  const { data, body } = parseAgentFrontmatter(readText(item.path));
  const warnings = [];
  const name = safeName(item.targetName || data.name || item.name);
  const config = {
    name,
    description: data.description || firstLine(body) || `Migrated Cursor agent ${name}`,
    prompt: body.trimEnd(),
    tools: ['*'],
    ...modelField(data.model, warnings),
  };
  if (data.readonly === true) makeReadOnly(config);
  if (data.is_background !== undefined) warnings.push('is_background has no Kiro agent-file equivalent and was not carried over');
  return targetResult(item, config, warnings);
}

function convertCodexAgent(item) {
  let data;
  try { data = parseToml(readText(item.path)); } catch (err) { throw new Error(`invalid Codex agent TOML: ${err.message}`); }
  const warnings = [];
  const name = safeName(item.targetName || data.name || item.name);
  const config = {
    name,
    description: data.description || `Migrated Codex agent ${name}`,
    prompt: data.developer_instructions || '',
    tools: ['*'],
    ...modelField(data.model, warnings),
  };
  if (data.features?.shell_tool === false) addRestrictions(config, ['Bash'], warnings);
  const disabledSkills = asList(data.skills?.config).filter((entry) => entry && typeof entry === 'object' && entry.enabled === false);
  if (disabledSkills.length) warnings.push('Codex per-agent disabled skills have no Kiro agent-file equivalent and were not carried over');
  for (const key of ['model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity']) {
    if (data[key] !== undefined) warnings.push(`${key} has no Kiro agent-file equivalent and was not carried over`);
  }
  for (const key of ['sandbox_mode', 'approval_policy', 'model_provider', 'mcp_servers']) {
    if (data[key] !== undefined) warnings.push(`${key} is inherited by Codex agents and was not copied into the Kiro agent`);
  }
  return targetResult(item, config, warnings);
}

export function convertAgent(item) {
  if (item.format === 'cursor-agent') return convertCursorAgent(item);
  if (item.format === 'codex-agent') return convertCodexAgent(item);
  return convertClaudeAgent(item);
}
