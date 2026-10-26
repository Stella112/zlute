/**
 * The browser signer (services/lute-signer, compiled to WebAssembly and served from
 * /lute-signer/). It derives the viewing keys Lute's server receives and signs payments after
 * checking, on the unsigned transaction itself, that it pays exactly what the user approved.
 */
import type { ProposalSummary } from './api';

interface SignerModule {
  default: (opts: { module_or_path: string }) => Promise<unknown>;
  deriveUfvk(seedHex: string, network: string, account: number): string;
  signPczt(seedHex: string, network: string, account: number, pcztHex: string, recipient: string, amountZat: string, feeZat: string): string;
}

let loading: Promise<SignerModule> | null = null;

function load(): Promise<SignerModule> {
  loading ??= (async () => {
    const url = '/lute-signer/lute_signer.js';
    const m = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as SignerModule;
    await m.default({ module_or_path: '/lute-signer/lute_signer_bg.wasm' });
    return m;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Wallet accounts derived from the recovery phrase: 0 = merchant, 1 = payout. */
export const ACCOUNTS = { merchant: 0, payout: 1 } as const;

export async function signerAvailable(): Promise<boolean> {
  try {
    await load();
    return true;
  } catch {
    return false;
  }
}

export async function deriveUfvks(seedHex: string, network: string): Promise<{ merchant: string; payout: string }> {
  const m = await load();
  return { merchant: m.deriveUfvk(seedHex, network, ACCOUNTS.merchant), payout: m.deriveUfvk(seedHex, network, ACCOUNTS.payout) };
}

export interface SpendAuthSig {
  index: number;
  sig: string;
}

/**
 * Checks and signs the prepared transaction. The account is whichever of this user's wallets the
 * transaction spends from; the signer refuses a wallet the transaction does not spend.
 */
export async function signPayment(seedHex: string, network: string, pcztHex: string, s: ProposalSummary): Promise<SpendAuthSig[]> {
  const m = await load();
  let last: unknown = null;
  for (const account of [ACCOUNTS.payout, ACCOUNTS.merchant]) {
    try {
      return JSON.parse(m.signPczt(seedHex, network, account, pcztHex, s.recipient, String(s.amount_zat), String(s.fee_zat))) as SpendAuthSig[];
    } catch (e) {
      last = e;
      if (!String(e instanceof Error ? e.message : e).includes('spends nothing from this wallet')) break;
    }
  }
  throw new Error(last instanceof Error ? last.message : 'Signing refused');
}
