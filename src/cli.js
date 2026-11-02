#!/usr/bin/env node
// Command line entry (npm bin):
//   kiro-migration-assistant                    stdio MCP server (what mcp.json runs)
//   kiro-migration-assistant install            register the server + skill in ~/.kiro
//   kiro-migration-assistant call <tool> [json] run one tool once, print its JSON result
//   kiro-migration-assistant tools              list tool names and descriptions
import { z } from 'zod';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveRoots } from './roots.js';
import { createServer } from './server.js';
import { TOOLS } from './tools.js';
import { install } from './install.js';

const USAGE = 'usage: kiro-migration-assistant [install | tools | call <tool> [json-args]]';

async function callTool(roots, name, rawArgs) {
  const tool = TOOLS.find(([n]) => n === name);
  if (!tool) throw new Error(`unknown tool "${name}". Tools: ${TOOLS.map(([n]) => n).join(', ')}`);
  let parsed;
  try { parsed = rawArgs ? JSON.parse(rawArgs) : {}; } catch (err) {
    throw new Error(`arguments must be one JSON object: ${err.message}`);
  }
  const [, config, handler] = tool;
  const args = z.object(config.inputSchema).strict().parse(parsed);
  return handler(roots, args);
}

async function main([command, ...rest]) {
  const roots = resolveRoots();
  if (!command) return createServer({ roots }).connect(new StdioServerTransport());
  if (command === 'install') return print(install(roots));
  if (command === 'tools') return print(TOOLS.map(([name, c]) => ({ name, description: c.description })));
  if (command === 'call' && rest[0]) return print(await callTool(roots, rest[0], rest[1]));
  throw new Error(USAGE);
}

const print = (data) => process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);

main(process.argv.slice(2)).catch((err) => {
  const message = err instanceof z.ZodError ? z.prettifyError(err) : err.message;
  process.stderr.write(`kiro-migration-assistant: ${message}\n`);
  process.exit(1);
});
