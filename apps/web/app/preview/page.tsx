import Link from 'next/link';
import { Icon } from '@/components/icons';

/**
 * What a payer sees when they open a Lute payment link, with sample content. Nothing here is payable:
 * the code area is a placeholder, not a QR code.
 */
export default function PayerPreview() {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-8">
      <p className="mb-6 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
        Sample preview of a payer&apos;s page. Not a real payment request. <Link href="/welcome" className="text-accent hover:underline">Back to Lute</Link>
      </p>
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <span className="grid h-6 w-6 place-items-center rounded-md logo-tile text-xs font-display text-[1.05em] ">L</span>
        Private payment via Lute
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="text-sm text-muted">Amount to pay</p>
        <p className="font-display num mt-1 text-6xl">
          0.015 <span className="text-2xl font-normal text-muted">ZEC</span>
        </p>
        <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-raised px-4 py-3 text-left text-sm">Logo design, invoice #12. Thank you!</p>
        <div className="mx-auto mt-6 grid aspect-square w-full max-w-[240px] place-items-center rounded-2xl border border-dashed border-line bg-raised text-xs text-muted">
          QR code with the payment details
          <br />
          (address, amount and memo)
        </div>
        <p className="mt-4 text-sm text-muted">Scan with Zodl or another compatible shielded Zcash wallet.</p>
        <span className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 font-medium text-on-accent opacity-60">Open in my wallet</span>
        <span className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-raised py-3.5 text-sm opacity-60">
          <Icon name="copy" className="h-4 w-4" /> Copy payment details
        </span>
        <div className="mt-6 space-y-2 text-left text-xs text-muted">
          <p className="font-medium text-text">The page then shows, as it happens:</p>
          <p>
            <span className="rounded-full bg-raised px-2 py-0.5">Waiting for your payment…</span>
          </p>
          <p>
            <span className="rounded-full bg-bad/12 px-2 py-0.5 text-bad">Partially paid: 0.005 of 0.015 ZEC</span> with what is left to pay
          </p>
          <p>
            <span className="rounded-full bg-warn/15 px-2 py-0.5 text-warn">Confirming: full amount seen</span> about 4 minutes on mainnet
          </p>
          <p>
            <span className="rounded-full bg-ok/15 px-2 py-0.5 text-ok">Paid: received and confirmed</span> with a signed receipt for checkouts
          </p>
        </div>
      </div>
      <p className="mt-6 max-w-sm text-center text-[11px] text-muted">
        The note is encrypted in the link itself; Lute&apos;s server never sees it. The payer needs no account. Payment details stay off the public blockchain; Lute, which hosts this page, sees the
        amount and when it was paid.
      </p>
    </div>
  );
}
