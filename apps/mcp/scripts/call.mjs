#!/usr/bin/env node
/**
 * Minimal MCP client: starts the Lute MCP server over stdio (as a chat client would), calls one
 * tool, prints its result. Used to drive the agent demo from a terminal.
 *   node apps/mcp/scripts/call.mjs <tool> [session_id]
 * Env: LUTE_MCP_CONFIG (default ~/lute-owner/lute-mcp-config.json, the same block a Claude client
 * would load); the token inside it is passed to the server and never printed.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Extra arguments: key=value, or key=@file to read the value from a file (e.g. text=@invoice.txt).
const [tool, sessionId, ...extra] = process.argv.slice(2);
const extraArgs = Object.fromEntries(
  extra.map((kv) => {
    const i = kv.indexOf('=');
    const v = kv.slice(i + 1);
    return [kv.slice(0, i), v.startsWith('@') ? readFileSync(v.slice(1), 'utf8') : v];
  }),
);
const cfg = JSON.parse(readFileSync(process.env.LUTE_MCP_CONFIG ?? join(homedir(), 'lute-owner', 'lute-mcp-config.json'), 'utf8')).mcpServers.lute;
const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...process.env, ...cfg.env } });
const client = new Client({ name: 'lute-demo-agent', version: '0.1.0' });
await client.connect(transport);
if (!tool) {
  console.log((await client.listTools()).tools.map((t) => t.name).join('\n'));
} else {
  const r = await client.callTool({ name: tool, arguments: { ...(sessionId ? { session_id: sessionId } : {}), ...extraArgs } });
  console.log(`${tool}${sessionId ? ` ${sessionId}` : ''}${r.isError ? ' (error)' : ''}\n${r.content.map((c) => c.text).join('\n')}`);
}
await client.close();
