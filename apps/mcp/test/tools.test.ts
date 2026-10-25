import { describe, expect, it } from 'vitest';
import { LuteAgentClient } from '../src/client.js';
import { render, TOOLS } from '../src/tools.js';

const TOKEN = `lute_agent_${'A'.repeat(43)}`;
const SID = 'S'.repeat(22);

function fake() {
  const seen: { method: string; url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: URL, init: RequestInit) => {
    seen.push({ method: String(init.method), url: String(url), headers: init.headers as Record<string, string> });
    const body = String(url).endsWith(`/v1/meter/sessions/${SID}`) ? { settlements: [{}, {}] } : { ok: true };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { seen, client: new LuteAgentClient({ baseUrl: 'http://127.0.0.1:48300', token: TOKEN, fetchImpl }) };
}

describe('Lute MCP tools (A6, A8, A9)', () => {
  it('exposes exactly the backed tools; none takes a recipient or an amount', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'lute_get_wallet_status',
      'lute_create_meter_session',
      'lute_call_metered_api',
      'lute_get_meter_session',
      'lute_propose_settlement',
      'lute_verify_settlement',
    ]);
    for (const t of TOOLS) expect(Object.keys(t.input).every((k) => k === 'session_id')).toBe(true);
  });

  it('A8: session ids are validated, so injected text never reaches a URL', () => {
    const s = TOOLS.find((t) => t.name === 'lute_propose_settlement')!.input.session_id!;
    expect(s.safeParse('../../v1/actions/send').success).toBe(false);
    expect(s.safeParse(`${SID}?to=t1attacker`).success).toBe(false);
    expect(s.safeParse(SID).success).toBe(true);
  });

  it('A6: every call goes to the Lute API with the agent token, never to the sidecar', async () => {
    const { seen, client } = fake();
    for (const t of TOOLS) await t.run(client, { session_id: SID });
    expect(seen.every((r) => r.url.startsWith('http://127.0.0.1:48300/v1/') && !r.url.includes(':48100'))).toBe(true);
    expect(seen.every((r) => r.headers.authorization === `Bearer ${TOKEN}` && r.headers['x-lute-caller'] === 'mcp')).toBe(true);
  });

  it('settlement retries are idempotent per (session, settlement number)', async () => {
    const { seen, client } = fake();
    await TOOLS.find((t) => t.name === 'lute_propose_settlement')!.run(client, { session_id: SID });
    const settle = seen.find((r) => r.url.endsWith('/settle'))!;
    expect(settle.headers['idempotency-key']).toBe(`mcp-${SID}-3`);
  });

  it('A9: tool output never contains the token', () => {
    expect(render({ status: 200, body: { ok: true } })).not.toContain(TOKEN);
    expect(() => new LuteAgentClient({ baseUrl: 'http://x', token: 'nope' })).toThrow();
  });
});
