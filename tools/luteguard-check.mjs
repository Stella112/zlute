// Runs LuteGuard (packages/luteguard, built) on a sidecar proposal view + recipient inspection.
// Used for the P1b mainnet payout before the API is deployed: the decision is computed on the exact
// proposal the sidecar will execute (same proposal_hash the owner signs).
// Usage: node tools/luteguard-check.mjs <proposal-view.json> <inspection.json> <network> <amount_zat>
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { evaluate } from '../packages/luteguard/dist/index.js';

const [viewPath, inspPath, network, amount] = process.argv.slice(2);
if (!viewPath || !inspPath || !network || !amount) {
  console.error('usage: node tools/luteguard-check.mjs <proposal-view.json> <inspection.json> <network> <amount_zat>');
  process.exit(2);
}
const view = JSON.parse(readFileSync(viewPath, 'utf8'));
const recipient = JSON.parse(readFileSync(inspPath, 'utf8'));
const now = Math.floor(Date.now() / 1000);

const decision = evaluate(
  {
    action: {
      id: `p1b-${view.summary.proposal_id}`,
      type: 'SEND',
      network,
      amount_zat: BigInt(amount),
      idempotency_key: `p1b-${view.summary.proposal_id}`,
      expires_at: view.summary.expires_at,
    },
    configured_network: network,
    caller: 'api',
    via_execute_action: true,
    principal: { kind: 'owner', id: 'owner', authenticated: true },
    recipient,
    proposal: { summary: view.summary, proposal_hash: view.proposal_hash, fee_source: 'library' },
    spend_authorization: 'owner_approval',
  },
  { now: () => now, newId: () => randomUUID() },
);
console.log(JSON.stringify(decision, null, 2));
process.exit(decision.outcome === 'ALLOW' ? 0 : 1);
