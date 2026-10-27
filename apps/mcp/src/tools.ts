/**
 * Lute MCP tools (mandate §19.8). Each tool is backed by a real API route; nothing else exists.
 * Inputs are opaque session ids (validated), document text, and invoices / paid URLs. An agent can
 * never choose who is paid: an invoice is paid only if its address is the payee the owner signed,
 * so prompt-injected text cannot redirect a payment; amounts stay inside the signed budget (A8).
 * Amounts are what the metered service says is owed (per call or per page, bounded by the credit
 * limit and the signed budget); recipients are resolved server-side from the grant.
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
    name: 'lute_quote_document',
    title: 'Get a one-time price quote for a document',
    description:
      'Returns a one-time quote for extracting this document: pages, price, total and expiry (2 minutes). The quote binds the price, the service, this session and the exact text; pass its quote_id to lute_extract_document to be charged exactly that. Nothing is charged for a quote.',
    input: { session_id: SessionId, text: z.string().min(1).max(40000).describe('The document as plain text (up to 40,000 characters).') },
    run: (c, a) => c.call('POST', `/v1/meter/sessions/${a.session_id}/quote`, {}, { text: a.text }),
  },
  {
    name: 'lute_extract_document',
    title: 'Extract fields from a document (paid per page)',
    description:
      'Paid document extraction: send the plain text of an invoice, receipt or email; get back its title, invoice number, dates, amounts with currencies and labels, the total, emails and links. Charged per page (2,000 characters) to the session. The response shows the charge, what is due, the remaining budget and the network fee; payment is batched into one shielded settlement. The text is not stored. Over the credit limit it returns PAYMENT_REQUIRED (402) with the reason: settle first.',
    input: {
      session_id: SessionId,
      text: z.string().min(1).max(40000).describe('The document as plain text (up to 40,000 characters).'),
      quote_id: z.string().regex(/^[A-Za-z0-9_-]{22}$/).optional().describe('A quote from lute_quote_document for this exact text; it is used once.'),
    },
    run: (c, a) => c.call('POST', `/v1/meter/sessions/${a.session_id}/extract`, {}, { text: a.text, ...(a.quote_id ? { quote_id: a.quote_id } : {}) }),
  },
  {
    name: 'lute_pay_invoice',
    title: 'Pay an invoice from the API this agent may pay',
    description:
      "Pays a Zcash payment request (ZIP-321 'zcash:' URI) issued by the outside API this grant pays, as a shielded payment from the agent wallet. Paid only if the invoice's address is exactly the payee the owner signed, within the budget; its memo may only be a short invoice reference. The same invoice is never paid twice.",
    input: { uri: z.string().min(8).max(2048).describe("The invoice: a 'zcash:' payment request from the paid API.") },
    run: (c, a) => c.call('POST', '/v1/agent/invoices/pay', {}, { uri: a.uri }),
  },
  {
    name: 'lute_fetch_paid',
    title: 'Call a paid API that answers HTTP 402',
    description:
      'Calls a paid API (POST with JSON {text}). If it answers 402 with a Zcash payment request, pays it through Lute (only to the payee this grant may pay, within budget) and returns payment_ref. Once the payment is mined (about 1-2 minutes), call again with the same url, text and payment_ref to receive the result.',
    input: {
      url: z.string().url().max(512).describe('The paid endpoint (https).'),
      text: z.string().min(1).max(40000).describe('The request body text, e.g. a document to extract.'),
      payment_ref: z.string().regex(/^[A-Za-z0-9_-]{22}$/).optional().describe('From the earlier call, once paid.'),
    },
    run: async (c, a) => {
      const url = new URL(a.url ?? '');
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return { status: 400, body: { error: 'HTTPS_REQUIRED' } };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(a.payment_ref ? { 'x-payment-ref': a.payment_ref } : {}) },
        body: JSON.stringify({ text: a.text }),
      });
      const body = (await res.json().catch(() => ({ error: `HTTP_${res.status}` }))) as Record<string, unknown>;
      if (res.status !== 402 || a.payment_ref) return { status: res.status, body: { api_status: res.status, ...body } };
      const zip321 = typeof body.zip321 === 'string' ? body.zip321 : null;
      if (!zip321 || typeof body.payment_ref !== 'string') return { status: 402, body: { error: 'NO_ZCASH_PAYMENT_REQUEST', api: body } };
      const paid = await c.call('POST', '/v1/agent/invoices/pay', {}, { uri: zip321 });
      return {
        status: paid.status,
        body: {
          api_status: 402,
          api_price_zat: body.amount_zat,
          payment: paid.body,
          payment_ref: body.payment_ref,
          next: 'When the payment is mined (about 1-2 minutes), call lute_fetch_paid again with the same url, text and this payment_ref.',
        },
      };
    },
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

/**
 * Fields the agent never needs to decide its next step. Tool output is copied into the agent's
 * conversation, which the AI provider stores, so it carries only what the next call needs: status,
 * amounts, budget, the session id and the action state. Identifiers that link this agent to its
 * grant, mandate, service or on-chain transactions stay out (docs/PRIVATE-PAID-APIS.md).
 */
const WITHHELD = new Set(['grant_id', 'mandate', 'mandate_id', 'mandate_hash', 'txid', 'txids', 'action_id', 'decision_id', 'proposal_hash', 'id_service', 'key_id']);

function minimize(v: unknown, parent = ''): unknown {
  if (Array.isArray(v)) return v.map((x) => minimize(x, parent));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (WITHHELD.has(k)) {
        // Keep the fact that a payment was broadcast, not its identifier.
        if (k === 'txid' && x) out.broadcast = true;
        continue;
      }
      // The service object's id is internal; its name and prices are what the agent needs.
      if (parent === 'service' && k === 'id') continue;
      out[k] = minimize(x, k);
    }
    return out;
  }
  return v;
}

/** Tool output: status plus the minimized API body (never keys, addresses or linking ids). */
export function render(r: { status: number; body: unknown }, verbose = process.env.LUTE_MCP_VERBOSE === '1'): string {
  const body = typeof r.body === 'object' && r.body ? r.body : { body: r.body };
  return JSON.stringify({ http_status: r.status, ...((verbose ? body : minimize(body)) as object) }, null, 1);
}
