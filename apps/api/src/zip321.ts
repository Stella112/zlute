/**
 * Strict ZIP-321 payment-request parsing for agent invoice payments. Only a single payment is
 * accepted: multi-payment requests (`param.N`) and required extensions (`req-…`) are refused, so
 * nothing in an invoice is silently ignored.
 */
import { AmountError, parseZec } from '@lute/core';

export interface Invoice {
  address: string;
  amount_zat: bigint;
  /** Memo as UTF-8 text, if the request carries one. */
  memo: string | null;
}

export class InvoiceError extends Error {}

function b64urlToText(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new InvoiceError('memo is not base64url');
  const bytes = Buffer.from(s, 'base64url');
  if (bytes.length > 512) throw new InvoiceError('memo longer than 512 bytes');
  // Memos are zero-padded on chain; trailing zero bytes are not part of the text.
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0+$/, '');
}

export function parseInvoice(uri: string): Invoice {
  if (uri.length > 2048 || !uri.toLowerCase().startsWith('zcash:')) throw new InvoiceError('not a zcash: payment request');
  const rest = uri.slice('zcash:'.length);
  const q = rest.indexOf('?');
  let address = decodeURIComponent(q === -1 ? rest : rest.slice(0, q));
  const params = new URLSearchParams(q === -1 ? '' : rest.slice(q + 1));
  let amount: string | null = null;
  let memo: string | null = null;
  const seen = new Set<string>();
  for (const [k, v] of params) {
    if (seen.has(k)) throw new InvoiceError(`duplicate parameter ${k}`);
    seen.add(k);
    if (k.includes('.')) throw new InvoiceError('multi-payment requests are not supported');
    if (k.startsWith('req-')) throw new InvoiceError(`required parameter ${k} is not supported`);
    if (k === 'address') {
      if (address) throw new InvoiceError('address given twice');
      address = v;
    } else if (k === 'amount') amount = v;
    else if (k === 'memo') memo = b64urlToText(v);
    // label and message are display-only; other optional parameters are ignored per ZIP-321.
  }
  if (!address) throw new InvoiceError('no address');
  if (!amount) throw new InvoiceError('no amount');
  let amount_zat: bigint;
  try {
    amount_zat = parseZec(amount);
  } catch (e) {
    if (e instanceof AmountError) throw new InvoiceError('invalid amount');
    throw e;
  }
  if (amount_zat <= 0n) throw new InvoiceError('amount must be positive');
  return { address, amount_zat, memo };
}
