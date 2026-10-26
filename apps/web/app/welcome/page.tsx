import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { ThemeToggle } from '@/components/ThemeToggle';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'request', title: 'Payment links', body: 'Share a link or a QR code. Your payer uses Zodl or any Zcash wallet, with no account and no app to install.' },
  { icon: 'store', title: 'Checkout and receipts', body: 'Sell anything with a checkout link. Customers get a signed receipt they can verify, and you can refund in two taps.' },
  { icon: 'repeat', title: 'Subscriptions', body: 'Bill every month without auto-debit. Subscribers get a private link with the invoice for each period.' },
  { icon: 'users', title: 'Split a bill', body: 'Everyone gets their own link for their share. Nobody sees what anyone else paid; you see who is done.' },
  { icon: 'stream', title: 'Streams', body: 'Pay a salary or a creator by the second. Earnings build up live, and each payout is a private payment you approve.' },
  { icon: 'agent', title: 'AI agents with a budget', body: 'Let an AI agent pay for a service on its own, inside a budget you sign once. Anything over it is refused.' },
];

const PILLARS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'shield', title: 'Shielded by default', body: 'Every payment stays inside Zcash’s shielded pool. Lute refuses transparent addresses and anything that would expose an amount.' },
  { icon: 'check', title: 'Nothing moves without you', body: 'Each payment is checked by LuteGuard, then approved with a key that only you hold. Even the server cannot spend on its own.' },
  { icon: 'activity', title: 'Proven, not promised', body: 'Every feature’s status comes from real test runs and real mainnet transactions, with the limits written down next to it.' },
];

const STEPS: [string, string][] = [
  ['Create your account', 'Your browser makes a private approval key. Lute creates your own shielded wallets bound to it.'],
  ['Share a link', 'Request an amount, sell with a checkout, start a subscription or split a bill.'],
  ['Get paid privately', 'Your payer pays from their own wallet. The page turns to Paid once the network confirms it.'],
  ['Pay out when you choose', 'Send, refund or stream. You confirm every payment with your key.'],
];

const FAQ: [string, string][] = [
  ['What does my payer need?', 'Only a Zcash wallet that supports shielded payments, such as Zodl. No account, no sign-up, no app from us.'],
  ['Who can see my payments?', 'On the blockchain, nobody can see the sender, the recipient or the amount. Lute’s server knows your own wallets’ activity; details like recipients and notes are stored encrypted.'],
  ['Who holds the money?', 'This hosted version keeps your Lute wallets on the server, like a hot wallet, so use small amounts. Payments out always need your approval key. Self-hosting removes the operator.'],
  ['What does it cost?', 'Lute adds no fee. The Zcash network fee for a payment is about 0.0001 ZEC.'],
  ['What still leaks?', 'The light-wallet server Lute syncs from sees network-level information such as IP address and timing, but never keys, amounts or memos. The Privacy page lists every known limit.'],
];

export default function Welcome() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/welcome" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-display text-[1.05em] text-on-accent">L</span>
            <span className="font-display text-xl">Lute</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
            <a href="#features" className="hover:text-text">
              Features
            </a>
            <a href="#how" className="hover:text-text">
              How it works
            </a>
            <a href="#privacy" className="hover:text-text">
              Privacy
            </a>
            <a href="#faq" className="hover:text-text">
              FAQ
            </a>
            <Link href="/docs" className="hover:text-text">
              Docs
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className="hidden rounded-lg px-3.5 py-2 text-sm text-muted hover:text-text sm:inline-block">
              Sign in
            </Link>
            <Link href="/signup" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <section className="bg-grid relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 md:grid-cols-[1.15fr_1fr] md:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Live on Zcash mainnet
            </span>
            <h1 className="mt-6 font-display text-6xl leading-[1.02] md:text-[5.25rem]">
              Get paid.
              <br />
              <span className="text-silver-gradient">Privately.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Lute turns shielded Zcash into everyday payments: links, checkout, subscriptions, split bills and streams. Only you and your payer know who paid whom, and how much.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-lg bg-accent px-6 py-3 font-medium text-on-accent hover:opacity-90">
                Create a free account
              </Link>
              <a href="#how" className="rounded-lg border border-line bg-surface px-6 py-3 font-medium hover:border-silver">
                See how it works
              </a>
            </div>
            <p className="mt-6 text-xs text-muted">Hosted demo: your Lute wallets are hot wallets on our server. Use small amounts.</p>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-2xl bg-gradient-to-br from-silver/25 via-transparent to-transparent blur-2xl" />
            <div className="rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/10">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-[10px] font-display text-[1.05em] text-on-accent">L</span>
                  Payment request
                </span>
                <span className="rounded-full bg-ok/12 px-2.5 py-0.5 text-xs text-ok">Shielded</span>
              </div>
              <ol className="mt-6 space-y-3">
                {[
                  ['request', 'You create a request', 'Amount and an optional private note'],
                  ['share', 'Your payer opens the link', 'Scans the QR with their Zcash wallet'],
                  ['shield', 'LuteGuard checks it', 'Single shielded pool, nothing public'],
                  ['check', 'Paid', 'Confirmed on the network, receipt issued'],
                ].map(([icon, title, sub], i) => (
                  <li key={title} className="flex items-center gap-3 rounded-2xl bg-raised px-4 py-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${i === 3 ? 'bg-ok/15 text-ok' : 'bg-accent-soft text-text'}`}>
                      <Icon name={icon as IconName} className="h-[18px] w-[18px]" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{title}</span>
                      <span className="block text-xs text-muted">{sub}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-8 text-center text-sm text-muted md:grid-cols-4">
          {['Shielded by default', 'Zero transparent', 'You approve every payment', 'Open source'].map((t) => (
            <p key={t} className="flex items-center justify-center gap-2">
              <Icon name="check" className="h-4 w-4 text-silver" /> {t}
            </p>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-5 py-24">
        <p className="label-caps">Features</p>
        <h2 className="font-display mt-3 max-w-2xl text-5xl leading-[1.08]">Everything a business needs to get paid, without going public.</h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-silver">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft">
                <Icon name={f.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-medium">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="privacy" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <p className="label-caps">Why Lute</p>
          <h2 className="font-display mt-3 max-w-2xl text-5xl leading-[1.08]">Privacy you can check, not just trust.</h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.title} className="rounded-2xl border border-line bg-bg p-7">
                <Icon name={p.icon} className="h-6 w-6 text-silver" />
                <h3 className="mt-6 text-xl font-medium">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-5 py-24">
        <p className="label-caps">How it works</p>
        <h2 className="font-display mt-3 text-5xl leading-[1.08]">Four steps. No crypto expertise needed.</h2>
        <ol className="mt-12 grid gap-4 md:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="rounded-2xl border border-line bg-surface p-6">
              <span className="font-display num text-silver-gradient text-5xl">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="mt-4 font-medium">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="faq" className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-24 md:grid-cols-[1fr_1.6fr]">
          <div>
            <p className="label-caps">FAQ</p>
            <h2 className="font-display mt-3 text-5xl leading-[1.08]">Questions, answered honestly.</h2>
          </div>
          <div className="divide-y divide-line border-y border-line">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {q}
                  <span className="text-xl text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="bg-grid rounded-2xl border border-line bg-surface px-8 py-14 text-center">
          <h2 className="font-display text-5xl leading-[1.08]">
            Start getting paid <span className="text-silver-gradient">privately</span>.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted">Create an account in under a minute. Your payers need nothing but a Zcash wallet.</p>
          <Link href="/signup" className="mt-8 inline-block rounded-lg bg-accent px-7 py-3 font-medium text-on-accent hover:opacity-90">
            Get started
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 text-sm md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-display text-[1.05em] text-on-accent">L</span>
              <span className="font-semibold">Lute</span>
            </div>
            <p className="mt-3 max-w-sm text-muted">Private payments on Zcash. Built for ZECATHON 2026. Hosted demo: use small amounts.</p>
          </div>
          <div>
            <p className="font-medium">Product</p>
            <ul className="mt-3 space-y-2 text-muted">
              <li>
                <a href="#features" className="hover:text-text">
                  Features
                </a>
              </li>
              <li>
                <a href="#how" className="hover:text-text">
                  How it works
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-text">
                  FAQ
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-medium">Resources</p>
            <ul className="mt-3 space-y-2 text-muted">
              <li>
                <Link href="/docs" className="hover:text-text">
                  User guide
                </Link>
              </li>
              <li>
                <Link href="/docs/private-apis" className="hover:text-text">
                  Private paid APIs
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-medium">Account</p>
            <ul className="mt-3 space-y-2 text-muted">
              <li>
                <Link href="/signup" className="hover:text-text">
                  Create account
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-text">
                  Sign in
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
