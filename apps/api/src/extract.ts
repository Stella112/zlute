/**
 * The metered document-extraction service: plain text in (an invoice, a receipt, an email), the
 * fields a bookkeeping agent needs out. Deterministic and local: no model, no third party, and the
 * text is neither stored nor logged (only its size is used, for billing).
 *
 * Billing unit: one page = up to 2,000 characters.
 */
export const PAGE_CHARS = 2000;
export const MAX_CHARS = 40_000;

export const pagesOf = (text: string) => Math.max(1, Math.ceil(text.length / PAGE_CHARS));

export interface Extraction {
  pages: number;
  characters: number;
  lines: number;
  words: number;
  title: string | null;
  invoice_number: string | null;
  dates: string[];
  amounts: { value: string; currency: string; label: string | null }[];
  total: { value: string; currency: string } | null;
  emails: string[];
  urls: string[];
  zcash_addresses: number;
}

const CUR: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₦': 'NGN', usd: 'USD', eur: 'EUR', gbp: 'GBP', ngn: 'NGN', zec: 'ZEC', taz: 'TAZ' };
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const uniq = <T>(xs: T[]) => [...new Set(xs)];
const num = (s: string) => s.replace(/,(?=\d{3}\b)/g, '');

export function extract(text: string): Extraction {
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);

  const dates = uniq([
    ...(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []),
    ...(text.match(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g) ?? []),
    ...(text.match(new RegExp(`\\b(?:\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{4}|(?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+\\d{4})\\b`, 'gi')) ?? []),
  ]).slice(0, 20);

  // Amounts: a currency symbol or code next to a number, with the line's label (text before it).
  const amounts: Extraction['amounts'] = [];
  const re = /(?:([$€£₦])\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(USD|EUR|GBP|NGN|ZEC|TAZ)\b|\b(USD|EUR|GBP|NGN|ZEC|TAZ)\s?(\d[\d,]*(?:\.\d+)?))/gi;
  for (const line of lines) {
    for (const m of line.matchAll(re)) {
      const sym = (m[1] ?? m[4] ?? m[5] ?? '').toLowerCase();
      const value = num(m[2] ?? m[3] ?? m[6] ?? '');
      const label = line.slice(0, m.index).replace(/[:\-–\s.]+$/, '').trim();
      amounts.push({ value, currency: CUR[sym] ?? sym.toUpperCase(), label: label ? label.slice(-40) : null });
      if (amounts.length >= 50) break;
    }
  }
  const totalRow = [...amounts].reverse().find((a) => a.label && /\b(total|amount due|balance due|grand total)\b/i.test(a.label));

  const inv = text.match(/\b(?:invoice|inv|receipt|order)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i);

  return {
    pages: pagesOf(text),
    characters: text.length,
    lines: nonEmpty.length,
    words: text.split(/\s+/).filter(Boolean).length,
    title: nonEmpty[0]?.slice(0, 80) ?? null,
    invoice_number: inv?.[1] ?? null,
    dates,
    amounts,
    total: totalRow ? { value: totalRow.value, currency: totalRow.currency } : null,
    emails: uniq(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).slice(0, 20),
    urls: uniq(text.match(/https?:\/\/[^\s<>"')]+/g) ?? []).slice(0, 20),
    // Counted, never echoed: an address in a document is not something to repeat into a transcript.
    zcash_addresses: (text.match(/\b(?:u1|zs1|t1|t3|utest1|uregtest1)[0-9a-z]{20,}\b/g) ?? []).length,
  };
}
