#!/usr/bin/env node
// stdio MCP server entry point.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveRoots } from './roots.js';
import { registerTools } from './tools.js';

export const SERVER_INFO = { name: 'kiro-migration-assistant', version: '0.1.0' };

export function createServer({ roots = resolveRoots() } = {}) {
  const server = new McpServer(SERVER_INFO);
  registerTools(server, roots);
  return server;
}

// Run only when executed directly (bin links via npx are symlinks).
const entry = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
if (import.meta.url === entry) {
  await createServer().connect(new StdioServerTransport());
}
