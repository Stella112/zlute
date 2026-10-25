/**
 * Lute MCP tools (mandate §19.8). Each tool is backed by a real API route; nothing else exists.
 * Inputs are only opaque session ids (validated): an agent cannot name a recipient or an amount,
 * so prompt-injected text cannot redirect or inflate a payment (A8). Amounts are what the metered
 * service says is owed; recipients are resolved server-side from the grant.
 */
import { z } from 'zod';
import type { LuteAgentClient } from './client.js';

const SessionId = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'a Lute session id (22 characters)');

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: Record<string, z.ZodType>;
  run: (c: LuteAgentClient, args: Record<string, string>) => Promise<{ status: number; body: unknown }>;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'lute_get_wallet_status',
    title: 'Budget and grant status',
    description:
      'Shows this agent grant: the metered service it may pay, per-payment cap, total budget, amount spent, remaining, expiry and whether it was revoked. No keys or addresses.',
    input: {},
    run: (c) => c.call('GET', '/v1/agent/me'),
  },
  {
    name: 'lute_create_meter_session',
    title: 'Open a metered session',
    description: 'Opens a usage session with the metered service this grant pays.',
    input: {},
    run: (c) => c.call('POST', '/v1/meter/sessions'),
  },
  {
    name: 'lute_call_metered_api',
    title: 'Call the metered API',
    description:
      'Calls the metered demo API once (it returns the current Zcash chain tip height seen by Lute) and adds its price to the session. Returns PAYMENT_REQUIRED (402) when the unpaid amount reaches the credit limit; settle before calling again.',
    input: { session_id: SessionId },
    run: (c, a) => c.call('POST', `/v1/meter/sessions/${a.session_id}/call`),
  },
  {
    name: 'lute_get_meter_session',
    title: 'Session usage',
    description: 'Shows a session: calls, usage, pending and confirmed payments, and what is due now.',
    input: { session_id: SessionId },
    run: (c, a) => c.call('GET', `/v1/meter/sessions/${a.session_id}`),
  },
  {
    name: 'lute_propose_settlement',
    title: 'Pay what is due',
    description:
      'Pays what the session owes from the agent wallet as a shielded Zcash payment. LuteGuard checks it against the grant (per-payment cap, remaining budget, recipient, expiry) and the wallet sidecar re-checks the owner-signed mandate. Over budget it is denied with a reason. Repeating the call for the same unpaid amount never pays twice.',
    input: { session_id: SessionId },
    run: async (c, a) => {
      const s = await c.call('GET', `/v1/meter/sessions/${a.session_id}`);
      if (s.status !== 200) return s;
      const seq = ((s.body as { settlements?: unknown[] }).settlements?.length ?? 0) + 1;
      // Stable per (session, settlement number): a retried tool call reuses the same action.
      return c.call('POST', `/v1/meter/sessions/${a.session_id}/settle`, { 'idempotency-key': `mcp-${a.session_id}-${seq}` });
    },
  },
  {
    name: 'lute_verify_settlement',
    title: 'Check payment confirmations',
    description: 'Checks the chain for the session payments; a payment counts as paid only after confirmations.',
    input: { session_id: SessionId },
    run: (c, a) => c.call('POST', `/v1/meter/sessions/${a.session_id}/refresh`),
  },
];

/** Tool output: status plus the API's JSON body (which never contains keys or addresses). */
export function render(r: { status: number; body: unknown }): string {
  return JSON.stringify({ http_status: r.status, ...(typeof r.body === 'object' && r.body ? r.body : { body: r.body }) }, null, 1);
}
