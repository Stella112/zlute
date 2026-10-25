#!/usr/bin/env node
/**
 * Lute MCP server (stdio). Env: LUTE_AGENT_TOKEN (grant-scoped, from the owner), LUTE_API_URL
 * (default http://127.0.0.1:48300, the Lute web origin, which proxies /v1 to the API).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LuteAgentClient } from './client.js';
import { render, TOOLS } from './tools.js';

const client = new LuteAgentClient({ baseUrl: process.env.LUTE_API_URL ?? 'http://127.0.0.1:48300', token: process.env.LUTE_AGENT_TOKEN ?? '' });
const server = new McpServer({ name: 'lute', version: '0.1.0' });

for (const t of TOOLS) {
  server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input }, async (args) => {
    try {
      // Inputs were validated against the tool's Zod shape (session ids only).
      const r = await t.run(client, args as Record<string, string>);
      return { content: [{ type: 'text' as const, text: render(r) }], isError: r.status >= 400 };
    } catch {
      return { content: [{ type: 'text' as const, text: '{"error":"LUTE_UNREACHABLE"}' }], isError: true };
    }
  });
}

await server.connect(new StdioServerTransport());
