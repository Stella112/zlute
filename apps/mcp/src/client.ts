/**
 * Thin client for the Lute API's agent routes. The MCP server has no route to the sidecar: every
 * spend goes apps/api → executeAction → LuteGuard → sidecar (mandate §13.4). The token is a
 * grant-scoped agent token; it is never echoed in tool output.
 */
export interface AgentClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class LuteAgentClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(o: AgentClientOptions) {
    if (!/^lute_agent_[A-Za-z0-9_-]{20,}$/.test(o.token)) throw new Error('LUTE_AGENT_TOKEN is missing or malformed');
    this.baseUrl = o.baseUrl;
    this.token = o.token;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  async call(method: 'GET' | 'POST', path: string, headers: Record<string, string> = {}, json: object = {}): Promise<{ status: number; body: unknown }> {
    const res = await this.fetchImpl(new URL(path, this.baseUrl), {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'x-lute-caller': 'mcp', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(method === 'POST' ? { body: JSON.stringify(json) } : {}),
    });
    const body = await res.json().catch(() => ({ error: `HTTP_${res.status}` }));
    return { status: res.status, body };
  }
}
