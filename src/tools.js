// MCP tool definitions: input validation + calls into the use cases. No
// business logic lives here.
import { z } from 'zod';
import { CONFIG_KINDS, applyConfigPlan, discover, planConfigMigration, publicEntry, summarize } from './config/migrate-config.js';
import { kiroInventory } from './config/kiro-inventory.js';
import { DEFAULT_MAX_CHARS, handoffSession, importSessions, listAllSessions } from './sessions/import-sessions.js';
import { CONFIG_SOURCES, DEFAULT_CONFIG_SOURCES, DEFAULT_SESSION_SOURCES, SESSION_SOURCES, UPGRADE_CONFIG_SOURCES, sessionSource } from './sources/index.js';

const configSources = z.array(z.enum(Object.keys(CONFIG_SOURCES))).optional()
  .describe('Config sources to read: claude-code, cursor, codex, or kiro (Kiro IDE *.kiro.hook files, converted to the hooks/*.json files kiro-cli V3 reads). Default: claude-code, cursor, codex.');
const sessionSourceName = z.enum(Object.keys(SESSION_SOURCES))
  .describe('claude-code | cursor (IDE chats) | cursor-agent (cursor-agent CLI / agent transcripts) | codex');
const workspace = z.string().optional()
  .describe('Absolute project path. Adds workspace-scoped config (written to <workspace>/.kiro).');
const maxChars = z.number().int().min(10_000).max(4_000_000).optional()
  .describe(`Character budget per imported session; older turns beyond it are dropped. Default ${DEFAULT_MAX_CHARS}.`);
const fallbackCwd = z.string().optional()
  .describe('Absolute folder to file a session under when the source recorded none (some Cursor Agent chats). Pass the current project path: Kiro lists sessions per folder, and a session with no folder is resumable only by id.');

const asResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

// Counting stops here so a scan stays quick on machines with thousands of sessions.
const SESSION_COUNT_CAP = 500;

function countConfig(items) {
  const out = {};
  for (const item of items) {
    const bySource = (out[item.source] ??= {});
    bySource[item.kind] = (bySource[item.kind] || 0) + (item.kind === 'mcp' ? Object.keys(item.servers).length : 1);
  }
  return out;
}

async function sessionSummary(roots, names) {
  const out = {};
  for (const name of names) {
    try {
      const listed = await sessionSource(name).listSessions(roots, { limit: SESSION_COUNT_CAP });
      out[name] = listed.length
        ? { found: true, count: listed.length, ...(listed.length === SESSION_COUNT_CAP ? { countIsAtLeast: true } : {}), newest: listed[0] }
        : { found: false, count: 0 };
    } catch (err) {
      out[name] = { found: false, count: 0, error: err.message };
    }
  }
  return out;
}

async function scanSources(roots, { workspace: ws }) {
  const config = countConfig(discover(roots, { workspace: ws }));
  const sessions = await sessionSummary(roots, DEFAULT_SESSION_SOURCES);
  const toolOf = (sessionSourceName) => sessionSourceName.replace(/-agent$/, '');
  const detected = Object.fromEntries(DEFAULT_CONFIG_SOURCES.map((tool) => [tool,
    Boolean(config[tool]) || Object.entries(sessions).some(([s, v]) => toolOf(s) === tool && v.found)]));
  const kiroUpgrade = {
    ideHooks: countConfig(discover(roots, { sources: [...UPGRADE_CONFIG_SOURCES], workspace: ws })).kiro?.hook || 0,
  };
  return { detected, config, sessions, kiro: kiroInventory(roots, { workspace: ws }), kiroUpgrade, kiroDir: roots.kiro.dir };
}

function migrateConfig(roots, args) {
  const plan = planConfigMigration(roots, args);
  const entries = args.dryRun === false ? applyConfigPlan(plan) : plan;
  return { dryRun: args.dryRun !== false, summary: summarize(entries), entries: entries.map(publicEntry) };
}

/** [name, config, handler(roots, args)] for every tool. */
export const TOOLS = [
  ['scan_sources', {
    title: 'Scan migratable sources',
    description: 'Find which of Claude Code, Cursor and Codex are on this machine (`detected`), what config (skills, commands, agents, MCP servers, hooks, rules) and how many sessions each has, what Kiro already has (`kiro`), and how many Kiro IDE hooks could be converted for kiro-cli V3 (`kiroUpgrade.ideHooks`). Read-only. Call this first.',
    inputSchema: { workspace },
    annotations: { readOnlyHint: true },
  }, scanSources],
  ['migrate_config', {
    title: 'Migrate configuration to Kiro',
    description: 'Convert skills, slash commands (-> skills), sub-agents, MCP servers, hooks and rules (-> steering) into Kiro. dryRun defaults to true and returns the plan with per-item status (create, unchanged, conflict, overwrite) and warnings. Run with dryRun=false only after the user approved the plan. Existing files are never replaced unless overwrite=true, and replaced files are backed up.',
    inputSchema: {
      sources: configSources,
      kinds: z.array(z.enum(CONFIG_KINDS)).optional().describe('Kinds to migrate. Default: all.'),
      names: z.array(z.string()).optional().describe('Only items with these names (as listed by a dry run).'),
      ids: z.array(z.string()).optional().describe('Only these items, by the `id` a dry run returns (source/kind/scope/name). Use this to apply exactly what the user ticked.'),
      workspace,
      overwrite: z.boolean().default(false),
      dryRun: z.boolean().default(true),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  }, migrateConfig],
  ['list_sessions', {
    title: 'List sessions',
    description: 'List sessions from other agents, newest first, with ids, titles and working directories.',
    inputSchema: {
      sources: z.array(sessionSourceName).optional(),
      cwd: z.string().optional().describe('Only sessions whose working directory is this absolute path.'),
      limit: z.number().int().min(1).max(500).default(20),
    },
    annotations: { readOnlyHint: true },
  }, (roots, args) => listAllSessions(roots, args)],
  ['import_sessions', {
    title: 'Import sessions into Kiro',
    description: 'Copy sessions into the Kiro V3 session store so they appear in `kiro-cli chat --v3 --list-sessions` / `--resume-picker` in their folder and can be resumed with --resume-id. Pass source + ids, or all=true for the newest `limit` sessions (from `source`, or across every source when source is omitted). dryRun defaults to true. Re-importing updates the same Kiro session; a session already continued in Kiro is kept unless fork=true.',
    inputSchema: {
      source: sessionSourceName.optional(),
      ids: z.array(z.string()).optional(),
      all: z.boolean().default(false),
      cwd: z.string().optional().describe('With all=true: only sessions from this directory.'),
      fallbackCwd,
      limit: z.number().int().min(1).max(500).default(20),
      maxChars,
      fork: z.boolean().default(false),
      dryRun: z.boolean().default(true),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  }, async (roots, args) => ({ results: await importSessions(roots, args) })],
  ['handoff_session', {
    title: 'Continue a live session in Kiro',
    description: 'Move a running Claude Code / Cursor / Codex session into Kiro now. Give sessionId, or cwd to take the most recently active session in that directory. Writes the Kiro session immediately and returns resumeCommand to run in a terminal.',
    inputSchema: {
      source: sessionSourceName,
      sessionId: z.string().optional(),
      cwd: z.string().optional(),
      fallbackCwd,
      maxChars,
      fork: z.boolean().default(false),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  }, (roots, { sessionId, ...rest }) => handoffSession(roots, { id: sessionId, ...rest })],
];

export function registerTools(server, roots) {
  for (const [name, config, handler] of TOOLS) {
    server.registerTool(name, config, async (args) => {
      try {
        return asResult(await handler(roots, args));
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: `${name} failed: ${err.message}` }] };
      }
    });
  }
}
