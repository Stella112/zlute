import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { Reveal, StreamTicker, TypedRun, type TermLine } from '@/components/landing';
import { ThemeToggle } from '@/components/ThemeToggle';

/** From the real MCP run on mainnet, 28 Oct 2026 (tx ac68ee91…a6d5, mined 3533628). */
const RUN: TermLine[] = [
  ['call', 'lute_get_wallet_status'],
  ['out', 'network main · per payment 10,000 · left 23,000 zat'],
  ['call', 'lute_quote_document  NW-2026-204'],
  ['out', '1 page · 1,000 zat · one use'],
  ['call', 'lute_extract_document'],
  ['out', 'Northwind Studio · total USD 1,950.00'],
  ['call', 'lute_propose_settlement'],
  ['ok', 'SUBMITTED · shielded · tx ac68ee91…a6d5'],
  ['call', 'lute_call_metered_api × 11'],
  ['out', 'due 11,000 zat · limit 10,000'],
  ['call', 'lute_propose_settlement'],
  ['bad', 'REJECTED · OVER_GRANT_PER_TX · nothing built'],
];

const TOOLS: [string, string][] = [
  ['lute_get_wallet_status', 'budget, limits, expiry'],
  ['lute_create_meter_session', 'open a metered session'],
  ['lute_get_meter_session', 'usage, due, paid'],
  ['lute_quote_document', 'one-time price quote'],
  ['lute_extract_document', 'paid document extraction'],
  ['lute_call_metered_api', 'pay per call'],
  ['lute_fetch_paid', 'pay HTTP 402 resources'],
  ['lute_pay_invoice', "pay an outside API's invoice"],
  ['lute_propose_settlement', 'settle what is due, shielded'],
  ['lute_verify_settlement', 'check the payment landed'],
];

const MCP_CONFIG = `"lute": {
  "command": "node",
  "args": ["apps/mcp/dist/server.js"],
  "env": {
    "LUTE_AGENT_TOKEN": "lute_agent_…",
    "LUTE_API_URL": "https://uselute.xyz"
  }
}`;

const PROOF: [string, string, string][] = [
  ['mainnet', 'An AI agent pays a document API over MCP; its over-limit payment is refused', 'E-018'],
  ['mainnet', 'All 16 mainnet transactions re-audited: fully shielded, one pool, nothing transparent', 'E-021'],
  ['mainnet', 'Payroll of two people in one shielded BatchPay transaction, private payslips', 'E-020'],
  ['mainnet', 'Non-custodial payout, signed in the browser', 'E-017'],
  ['mainnet', 'A stream paid out in approved shielded payouts', 'E-008'],
  ['mainnet', 'Payment link paid from Zodl, verified by address, memo and confirmations', 'E-004'],
  ['regtest', 'Checkout, signed receipts and capped private refunds', 'E-012'],
  ['regtest', 'Subscriptions (active, due, lapsed) and split bills', 'E-013'],
];

const SEES: [string, string, string][] = [
  ['Anyone reading the blockchain', 'That a shielded transaction happened, when, its fee and size', 'Sender, recipient, amount, memo'],
  ['Your payer', 'The amount and address they pay, and your note if you share it', 'Your balance, your other payments'],
  ['Lute (hosted)', 'Your payment activity, through a viewing key', 'Your recovery phrase; it cannot move your money (new accounts)'],
  ['A payslip or receipt holder', 'Only their own line, signed', 'Anyone else on the payroll or in the shop'],
];

const FAQ: [string, string][] = [
  ['What does my payer need?', 'Only a compatible shielded Zcash wallet, such as Zodl. No account, no sign-up, no app from us.'],
  [
    'How does an AI agent pay?',
    'You set up a metered service and sign a mandate (payee, limit per payment, total budget, expiry). The agent connects to Lute’s MCP server with a scoped token and calls tools; LuteGuard checks every settlement against your mandate, and payment comes from a separate agent wallet. Revoke the grant any time.',
  ],
  [
    'Are refunds private too?',
    'Yes. A refund is a new shielded payment to the customer, approved by you and capped at what was paid. The signed receipt carries no address or item text, so it can be verified without revealing what was bought.',
  ],
  [
    'Who holds the money?',
    'You do. Your recovery phrase is created in your browser and never sent to Lute; every payout is signed there, and your backup restores the wallet in Zodl without Lute. Lute holds viewing keys only. The exception is an AI-agent budget, which Lute holds so the agent can pay unattended: keep it small. Accounts created before 27 Oct 2026 remain custodial.',
  ],
  ['What does it cost?', 'Lute adds no fee. The Zcash network fee is about 0.0001 ZEC per payment, and a payroll or a batch of agent calls pays it once.'],
  [
    'What still leaks?',
    'The light-wallet server sees network information such as the server’s IP and timing, never keys, amounts or memos. Lute links to no block explorer. The Privacy page and the evidence register list every known limit.',
  ],
];

function Section({ id, eyebrow, title, sub, children, alt }: { id?: string; eyebrow: string; title: React.ReactNode; sub?: string; children: React.ReactNode; alt?: boolean }) {
  return (
    <section id={id} className={`relative overflow-hidden ${alt ? 'border-y border-line bg-surface/50' : ''}`}>
      <div className="mx-auto max-w-6xl px-5 py-24 md:py-28">
        <Reveal>
          <p className="label-caps">{eyebrow}</p>
          <h2 className="font-display mt-3 max-w-3xl text-5xl leading-[1.05] md:text-6xl">{title}</h2>
          {sub && <p className="mt-5 max-w-2xl text-lg text-muted">{sub}</p>}
        </Reveal>
        <div className="mt-14">{children}</div>
      </div>
    </section>
  );
}

function Feature({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}

function Tag({ env, children }: { env: 'mainnet' | 'regtest' | 'live'; children: React.ReactNode }) {
  const c = env === 'mainnet' ? 'bg-ok/12 text-ok' : env === 'regtest' ? 'bg-warn/12 text-warn' : 'bg-accent-soft text-accent';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${c}`}>{children}</span>;
}

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/70 py-2.5 text-sm last:border-0">
      <span className="text-muted">{k}</span>
      <span className={`num text-right ${tone ?? ''}`}>{v}</span>
    </div>
  );
}

export default function Welcome() {
  return (
    <div className="landing min-h-screen overflow-x-hidden">
      <header className="sticky top-0 z-30 border-b border-line/50 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/welcome" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg logo-tile font-display text-[1.05em] ">L</span>
            <span className="font-display text-xl">Lute</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted lg:flex">
            {[
              ['#agents', 'AI agents'],
              ['#streams', 'Streams'],
              ['#subscriptions', 'Subscriptions'],
              ['#payroll', 'Payroll'],
              ['#commerce', 'Receipts & refunds'],
              ['#privacy', 'Privacy'],
              ['#proof', 'Proof'],
            ].map(([h, l]) => (
              <a key={h} href={h} className="hover:text-text">
                {l}
              </a>
            ))}
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

      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden">
        <div className="liquid liquid-a left-[-10%] top-[-10%] h-[38rem] w-[38rem]" />
        <div className="liquid liquid-b right-[-12%] top-[10%] h-[34rem] w-[34rem]" />
        <div className="liquid liquid-c bottom-[-20%] left-[30%] h-[30rem] w-[30rem]" />
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-24 pt-20 md:grid-cols-[1.05fr_1fr] md:pt-28">
          <Reveal>
            <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-muted">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ok" /> Live on Zcash mainnet
            </span>
            <h1 className="mt-6 font-display text-6xl leading-[0.98] md:text-[5.4rem]">
              Private money.
              <br />
              <span className="text-silver-gradient">Programmable payments.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">
              Zcash makes money private. Lute makes it programmable: AI agents that pay for APIs inside a budget you sign, streams, subscriptions, payroll, receipts and refunds, all shielded on
              mainnet.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-xl bg-accent px-6 py-3.5 font-medium text-on-accent shadow-lg shadow-accent/20 hover:opacity-90">
                Create a free account
              </Link>
              <Link href="/docs/agents" className="glass rounded-xl px-6 py-3.5 font-medium hover:border-silver">
                Connect an agent →
              </Link>
            </div>
            <p className="mt-6 text-xs text-muted">Non-custodial: your keys stay in your browser (AI-agent budgets excepted). Lute sees your payments, never your keys.</p>
          </Reveal>

          <Reveal delay={150} className="relative">
            <div className="glass float-slow rounded-3xl p-6">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Home</span>
                <span className="flex items-center gap-1.5">
                  <Icon name="shield" className="h-3.5 w-3.5 text-ok" /> Shielded
                </span>
              </div>
              <p className="mt-5 text-sm text-muted">Private balance</p>
              <p className="num mt-1 font-display text-5xl">
                0.00015 <span className="text-xl text-muted">ZEC</span>
              </p>
              <div className="mt-5 grid grid-cols-4 gap-2 text-center text-[11px]">
                {(
                  [
                    ['request', 'Request'],
                    ['pay', 'Pay'],
                    ['stream', 'Stream'],
                    ['agent', 'Agents'],
                  ] as [IconName, string][]
                ).map(([i, l]) => (
                  <span key={l} className="rounded-xl bg-raised/80 py-2.5">
                    <Icon name={i} className="mx-auto mb-1 h-4 w-4" />
                    {l}
                  </span>
                ))}
              </div>
              <ul className="mt-5 divide-y divide-line/70 text-sm">
                {[
                  ['AI agent payment', 'Blocked · over limit', '0.00011', 'text-bad line-through'],
                  ['AI agent payment', 'Confirming', '−0.00001', 'text-warn'],
                  ['Payroll · 2 people', 'Completed', '−0.00001', 'text-ok'],
                  ['Payment request', 'Paid', '+0.0004', 'text-ok'],
                ].map(([t, s, a, c]) => (
                  <li key={t + s} className="flex items-center justify-between py-2.5">
                    <span>
                      {t}
                      <span className="block text-xs text-muted">{s}</span>
                    </span>
                    <span className={`num ${c}`}>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="glass absolute -bottom-8 -left-6 hidden rounded-2xl px-4 py-3 text-xs md:block">
              <p className="text-muted">LuteGuard</p>
              <p className="font-medium text-bad">REJECTED · OVER_GRANT_PER_TX</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-y border-line bg-surface/60">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-7 text-center text-sm text-muted md:grid-cols-5">
          {['16/16 mainnet txs fully shielded', 'AI agents over MCP', '277 passing tests', 'Browser-signed payouts', 'Open source'].map((t) => (
            <p key={t} className="flex items-center justify-center gap-2">
              <Icon name="check" className="h-4 w-4 text-ok" /> {t}
            </p>
          ))}
        </div>
      </section>

      {/* ---------------- Agents ---------------- */}
      <Section
        id="agents"
        eyebrow="AI agents · MCP"
        title={
          <>
            Agents pay for APIs. <span className="text-silver-gradient">You sign the rules once.</span>
          </>
        }
        sub="Lute runs as an MCP server. Claude, or any MCP agent, gets ten payment tools. It pays a service from its own shielded wallet, inside a mandate you signed: one payee, a limit per payment, a total budget, an expiry. No click per payment, and nothing outside the rules."
      >
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <Reveal>
            <div className="glass overflow-hidden rounded-3xl">
              <div className="flex items-center justify-between border-b border-line/70 px-5 py-3 text-xs text-muted">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-bad/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-ok/70" />
                  <span className="ml-2">Claude → Lute MCP · real mainnet run, 28 Oct</span>
                </span>
                <Tag env="mainnet">mainnet</Tag>
              </div>
              <div className="px-5 py-4">
                <TypedRun lines={RUN} />
              </div>
            </div>
          </Reveal>
          <div className="space-y-6">
            <Reveal delay={100}>
              <div className="glass rounded-3xl p-6">
                <p className="label-caps">Mandate · signed once by the owner</p>
                <div className="mt-3">
                  <Row k="Payee" v="1 service address" />
                  <Row k="Per payment" v="≤ 10,000 zat" />
                  <Row k="Total budget" v="30,000 zat" />
                  <Row k="Expires" v="in 24 h" />
                  <Row k="Signed by" v="owner key, on the laptop" />
                </div>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="rounded-3xl border border-bad/40 bg-bad/5 p-6">
                <p className="label-caps">LuteGuard</p>
                <p className="mt-2 text-2xl font-semibold text-bad">REJECTED</p>
                <p className="mt-1 font-mono text-sm">OVER_GRANT_PER_TX · 11,000 &gt; 10,000</p>
                <p className="mt-3 text-sm text-muted">Deterministic rules, not model judgment. Refused with a reason before a transaction is built; the wallet re-checks on its own.</p>
              </div>
            </Reveal>
          </div>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {(
            [
              [
                'activity',
                'Pay per call, settle once',
                'Metered sessions and one-time quotes. Each call adds to a running meter; one shielded payment settles everything due. A hundred calls, one network fee.',
              ],
              [
                'store',
                'Sell your API to agents',
                'Set a price per call or page and a credit limit. Run it on Lute, let agents pay an outside API’s invoices, or sell to other accounts’ agents over HTTP 402.',
              ],
              ['shield', 'Scoped and revocable', 'The agent token can only pay the one service in its grant. Revoke it any time; an expired or replayed approval pays nothing.'],
            ] as [IconName, string, string][]
          ).map(([i, t, b], k) => (
            <Reveal key={t} delay={k * 100}>
              <div className="glass h-full rounded-3xl p-6">
                <Feature icon={i} title={t} body={b} />
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <Reveal>
            <div className="glass h-full rounded-3xl p-6">
              <p className="label-caps">The ten MCP tools</p>
              <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {TOOLS.map(([n, d]) => (
                  <li key={n} className="text-sm">
                    <span className="font-mono text-[13px] text-accent">{n}</span>
                    <span className="block text-xs text-muted">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="glass h-full rounded-3xl p-6">
              <p className="label-caps">Connect Claude</p>
              <pre className="mt-4 overflow-x-auto rounded-2xl bg-raised/80 p-4 font-mono text-[12px] leading-5 text-muted">{MCP_CONFIG}</pre>
              <Link href="/docs/agents" className="mt-4 inline-block text-sm text-accent hover:underline">
                Set up an agent in five minutes →
              </Link>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ---------------- Streams ---------------- */}
      <Section
        id="streams"
        alt
        eyebrow="Streams"
        title="Pay by the second."
        sub="Pay a salary, a contractor or a creator as time passes. Earnings accrue live as a figure; money moves only in the payouts you approve, each one a shielded payment. What streams owe can roll straight into payroll."
      >
        <div className="grid items-center gap-6 md:grid-cols-2">
          <Reveal>
            <div className="glass rounded-3xl p-7">
              <div className="flex items-center justify-between">
                <p className="label-caps">Accruing now</p>
                <span className="text-xs text-muted">illustration · 60× speed</span>
              </div>
              <div className="mt-4">
                <StreamTicker />
              </div>
              <p className="mt-4 text-sm text-muted">50 zat per second · 0.0003 ZEC over 10 minutes</p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="glass rounded-3xl p-7">
              <div className="flex items-center justify-between">
                <p className="label-caps">Stream · ended</p>
                <Tag env="mainnet">mainnet · E-008</Tag>
              </div>
              <div className="mt-3">
                <Row k="Accrued" v="0.00030000 / 0.00030000" />
                <Row k="Paid out" v="0.00030000 ZEC" tone="text-ok" />
                <Row k="Owed" v="0.00000000" />
                <Row k="Payouts" v="2 shielded, owner-approved" />
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ---------------- Subscriptions ---------------- */}
      <Section
        id="subscriptions"
        eyebrow="Subscriptions"
        title="Recurring revenue, without auto-debit."
        sub="Each period the subscriber gets a fresh shielded invoice and pays from their own wallet. Lute never pulls funds. Status moves from active to due, and lapses after a grace period. Cancel any time."
      >
        <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
          <Reveal>
            <div className="glass rounded-3xl p-7">
              <p className="label-caps">Pro plan · 0.0001 ZEC / 30 days</p>
              <ol className="mt-5 space-y-4">
                {[
                  ['Period 1', 'Invoice paid', 'bg-ok', 'text-ok', 'Active'],
                  ['Period 2', 'Invoice paid', 'bg-ok', 'text-ok', 'Active'],
                  ['Period 3', 'New shielded invoice sent', 'bg-warn', 'text-warn', 'Due'],
                  ['Grace ends', 'If unpaid', 'bg-silver', 'text-muted', 'Lapsed'],
                ].map(([p, s, dot, tone, st]) => (
                  <li key={p} className="flex items-center gap-4">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
                    <span className="flex-1 text-sm">
                      {p}
                      <span className="block text-xs text-muted">{s}</span>
                    </span>
                    <span className={`text-xs font-medium ${tone}`}>{st}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="glass rounded-3xl p-7">
              <div className="flex items-center justify-between">
                <p className="label-caps">What the subscriber sees</p>
                <Tag env="regtest">regtest · E-013</Tag>
              </div>
              <p className="mt-5 font-display text-3xl">Pro plan</p>
              <p className="num mt-1 text-4xl">0.0001 ZEC</p>
              <p className="mt-2 text-sm text-warn">Period 3 due · pay from your own wallet</p>
              <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                <span className="rounded-xl bg-accent py-3 text-center font-medium text-on-accent">Pay this period</span>
                <span className="rounded-xl border border-line py-3 text-center">Cancel</span>
              </div>
              <p className="mt-4 text-xs text-muted">A private link. No merchant identity, no stored card, nothing to revoke.</p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ---------------- Payroll ---------------- */}
      <Section
        id="payroll"
        alt
        eyebrow="Payroll · organizations"
        title="A whole team, one transaction."
        sub="BatchPay pays up to ten people in one shielded transaction: one approval, one network fee. On chain, the batch reveals only how many outputs it has. Each person gets a private, signed payslip, and its id in their own shielded memo."
      >
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Reveal>
            <div className="glass rounded-3xl p-7">
              <div className="flex items-center justify-between">
                <p className="label-caps">Payroll run · October</p>
                <Tag env="mainnet">mainnet · E-020</Tag>
              </div>
              <div className="mt-4">
                <Row k="Ada" v="0.000005 ZEC" />
                <Row k="Ben" v="0.000005 ZEC" />
                <Row k="Network fee (once)" v="0.00015 ZEC" />
                <Row k="Transaction" v="26c815f9…a9be" />
                <Row k="Status" v="Confirmed" tone="text-ok" />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-center text-xs">
                {[
                  ['Admin', 'prepares, edits templates'],
                  ['Operator', 'runs saved payrolls'],
                  ['Owner', 'approves and signs'],
                ].map(([r, d]) => (
                  <span key={r} className="rounded-xl bg-raised/80 px-2 py-3">
                    <span className="block font-medium">{r}</span>
                    <span className="text-muted">{d}</span>
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="glass float-slow rounded-3xl p-7">
              <p className="text-xs text-muted">Lute payslip</p>
              <p className="mt-1 font-medium">Ada</p>
              <p className="num mt-2 font-display text-4xl">0.000005 ZEC</p>
              <span className="mt-3 inline-block rounded-full bg-ok/12 px-2.5 py-0.5 text-xs text-ok">Paid</span>
              <div className="mt-4">
                <Row k="Network" v="Zcash mainnet" />
                <Row k="Signed by" v="receipt key 02e7a22f…" />
              </div>
              <p className="mt-4 text-xs text-muted">This page shows only Ada’s line. Nobody on the payroll sees anyone else’s pay.</p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ---------------- Commerce: receipts & refunds ---------------- */}
      <Section
        id="commerce"
        eyebrow="Checkout · receipts · refunds"
        title="Sell privately. Refund privately."
        sub="Share a checkout link; your customer pays from their own wallet and gets a signed receipt anyone can verify, without it revealing an address or what was bought. A refund is a new shielded payment, approved by you and capped at what was paid."
      >
        <div className="grid gap-6 md:grid-cols-3">
          <Reveal>
            <div className="glass h-full rounded-3xl p-6">
              <p className="label-caps">1 · Checkout</p>
              <p className="mt-4 font-medium">Sticker pack</p>
              <p className="num mt-1 font-display text-4xl">0.002 ZEC</p>
              <div className="mt-4">
                <Row k="Status" v="Paid" tone="text-ok" />
                <Row k="Matched by" v="unique address + memo" />
                <Row k="Confirmations" v="≥ 3" />
              </div>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="glass h-full rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <p className="label-caps">2 · Signed receipt</p>
                <span className="rounded-full bg-ok/12 px-2 py-0.5 text-[11px] text-ok">valid</span>
              </div>
              <pre className="mt-4 overflow-x-auto rounded-2xl bg-raised/80 p-4 font-mono text-[11.5px] leading-5 text-muted">{`{
  "version": "lute-receipt-v2",
  "receipt_id": "Xq7…Tg",
  "amount_zat": "200000",
  "paid_zat": "200000",
  "txids": ["33ed40…812a"],
  "item_hash": "<salted commitment>",
  "network": "regtest"
}
sig  ed25519 · 4be0…91a`}</pre>
              <p className="mt-3 text-xs text-muted">No address, no item text: the item is a salted commitment. A tampered copy fails verification.</p>
            </div>
          </Reveal>
          <Reveal delay={200}>
            <div className="glass h-full rounded-3xl p-6">
              <p className="label-caps">3 · Private refund</p>
              <div className="mt-4">
                <Row k="Paid" v="0.0020 ZEC" />
                <Row k="Refund 0.0021" v="OVER_REFUNDABLE" tone="text-bad" />
                <Row k="Refund 0.0015" v="Owner signed · confirmed" tone="text-ok" />
                <Row k="Still refundable" v="0.0005 ZEC" />
              </div>
              <p className="mt-3 text-xs text-muted">A new shielded payment to the customer. Nobody can tell on chain that it was a refund.</p>
            </div>
          </Reveal>
        </div>
        <Reveal className="mt-6">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <Tag env="regtest">regtest · E-012</Tag> Checkout, receipts and refunds are proven end to end on regtest; payment links themselves are proven on mainnet (E-004).
          </div>
        </Reveal>
      </Section>

      {/* ---------------- Links & split ---------------- */}
      <Section
        alt
        eyebrow="Get paid"
        title="A link, a QR code, or a split bill."
        sub="Every request gets a fresh shielded address and memo, and turns Paid only after confirmations. Your payer needs nothing but a shielded Zcash wallet, like Zodl."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <Reveal>
            <div className="glass rounded-3xl p-7 text-center">
              <p className="text-sm text-muted">Private payment via Lute</p>
              <p className="num mt-4 font-display text-6xl">0.0004 ZEC</p>
              <span className="mx-auto mt-5 grid h-16 w-16 place-items-center rounded-full bg-ok/15 text-ok">
                <Icon name="check" className="h-8 w-8" />
              </span>
              <p className="mt-4 text-sm">Payment received and confirmed.</p>
              <p className="mt-1 text-xs text-muted">A real request, paid on mainnet, 28 Oct.</p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="glass rounded-3xl p-7">
              <p className="label-caps">Split a bill · dinner, 4 people</p>
              <div className="mt-4">
                <Row k="Share link · Ama" v="Paid" tone="text-ok" />
                <Row k="Share link · Kofi" v="Paid" tone="text-ok" />
                <Row k="Share link · Nia" v="Waiting" tone="text-warn" />
                <Row k="Share link · Tobi" v="Waiting" tone="text-warn" />
              </div>
              <p className="mt-4 text-xs text-muted">Each person gets their own link. Participants don’t see each other’s payments; you see who is done.</p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ---------------- Privacy ---------------- */}
      <Section
        id="privacy"
        eyebrow="Privacy"
        title="Privacy you can check, not just trust."
        sub="Every payment stays in one shielded pool, with nothing transparent. LuteGuard refuses transparent addresses and any payment that would cross pools. New accounts keep their recovery phrase in the browser, which checks and signs every payout."
      >
        <Reveal>
          <div className="glass overflow-x-auto rounded-3xl">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line/70">
                  <th className="px-6 py-4 font-medium">Who</th>
                  <th className="px-6 py-4 font-medium">Can see</th>
                  <th className="px-6 py-4 font-medium">Cannot see</th>
                </tr>
              </thead>
              <tbody>
                {SEES.map(([w, c, n]) => (
                  <tr key={w} className="border-b border-line/50 last:border-0">
                    <td className="px-6 py-4 font-medium">{w}</td>
                    <td className="px-6 py-4 text-muted">{c}</td>
                    <td className="px-6 py-4 text-ok">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {(
            [
              ['shield', 'Shielded by default', 'One shielded pool, no transparent parts; only the network fee leaves the pool.'],
              ['check', 'Your keys, your approval', 'Payouts are signed in your browser. Lute holds a viewing key, not your spending key.'],
              ['globe', 'No third parties', 'Pages load nothing from other sites, send no referrer, and link to no block explorer.'],
            ] as [IconName, string, string][]
          ).map(([i, t, b], k) => (
            <Reveal key={t} delay={k * 100}>
              <div className="glass h-full rounded-3xl p-6">
                <Feature icon={i} title={t} body={b} />
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ---------------- Proof ---------------- */}
      <Section
        id="proof"
        alt
        eyebrow="Proof"
        title="Every claim has evidence."
        sub="Real transactions, the commands that produced them, and the limits that remain. Mainnet where it ran on mainnet; regtest where it has not yet."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <Reveal>
            <div className="glass grid h-full grid-cols-2 gap-6 rounded-3xl p-7 lg:grid-cols-1">
              {[
                ['16/16', 'mainnet transactions fully shielded'],
                ['277', 'passing tests across 7 suites'],
                ['21', 'evidence records with commands'],
              ].map(([n, l]) => (
                <div key={l}>
                  <p className="num font-display text-6xl text-accent">{n}</p>
                  <p className="text-sm text-muted">{l}</p>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={100}>
            <ul className="glass divide-y divide-line/70 rounded-3xl">
              {PROOF.map(([env, claim, id]) => (
                <li key={id} className="flex flex-wrap items-center gap-3 px-6 py-4 text-sm">
                  <Tag env={env as 'mainnet' | 'regtest'}>{env}</Tag>
                  <span className="min-w-0 flex-1">{claim}</span>
                  <Link href={`/docs/evidence#${id.toLowerCase()}`} className="font-mono text-xs text-accent hover:underline">
                    {id} →
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Section>

      {/* ---------------- How + developers ---------------- */}
      <Section eyebrow="How it works" title="From sign-up to an agent with a budget.">
        <ol className="grid gap-6 md:grid-cols-4">
          {[
            ['Create your account', 'Your browser creates your recovery phrase and signing key. Lute creates your shielded wallets, bound to it.'],
            ['Get paid', 'Share a link, sell with a checkout, start a subscription, split a bill.'],
            ['Pay out', 'Send, refund, stream or run payroll. LuteGuard checks it; your browser signs it.'],
            ['Hand an agent a budget', 'Sign a mandate once. Your agent pays for APIs over MCP, never past your limits.'],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 100}>
              <li className="glass h-full list-none rounded-3xl p-6">
                <span className="num text-silver-gradient font-display text-5xl">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-4 font-medium">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
              </li>
            </Reveal>
          ))}
        </ol>
        <Reveal className="mt-6">
          <div className="glass grid gap-6 rounded-3xl p-7 md:grid-cols-3">
            {[
              ['/docs/agents', 'Agents and MCP', 'Mandates, metered APIs, the tools'],
              ['/docs/api', 'API reference', 'Every endpoint, by area'],
              ['/docs/evidence', 'Evidence register', 'Every claim with its proof'],
            ].map(([h, t, d]) => (
              <Link key={h} href={h} className="group">
                <p className="font-medium group-hover:text-accent">{t} →</p>
                <p className="text-sm text-muted">{d}</p>
              </Link>
            ))}
          </div>
        </Reveal>
      </Section>

      {/* ---------------- FAQ ---------------- */}
      <section id="faq" className="border-t border-line bg-surface/50">
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

      <section className="relative overflow-hidden">
        <div className="liquid liquid-a left-[10%] top-[10%] h-[26rem] w-[26rem]" />
        <div className="liquid liquid-b right-[10%] top-[20%] h-[24rem] w-[24rem]" />
        <div className="relative mx-auto max-w-6xl px-5 py-28">
          <Reveal>
            <div className="glass rounded-[2rem] px-8 py-16 text-center">
              <h2 className="font-display text-5xl leading-[1.05] md:text-6xl">
                Private money, <span className="text-silver-gradient">programmable</span>.
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-muted">Create an account in under a minute, then get paid, pay out, run payroll or hand an agent a budget.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/signup" className="rounded-xl bg-accent px-7 py-3.5 font-medium text-on-accent hover:opacity-90">
                  Get started
                </Link>
                <Link href="/docs" className="glass rounded-xl px-7 py-3.5 font-medium">
                  Read the docs
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 text-sm md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md logo-tile font-display text-[1.05em] ">L</span>
              <span className="font-semibold">Lute</span>
            </div>
            <p className="mt-3 max-w-sm text-muted">Programmable private payments on Zcash, for people, businesses and AI agents. Built for ZECATHON 2026.</p>
          </div>
          {(
            [
              [
                'Product',
                [
                  ['#agents', 'AI agents'],
                  ['#streams', 'Streams'],
                  ['#subscriptions', 'Subscriptions'],
                  ['#payroll', 'Payroll'],
                  ['#commerce', 'Receipts & refunds'],
                ],
              ],
              [
                'Resources',
                [
                  ['/docs', 'Docs'],
                  ['/docs/agents', 'Agents and MCP'],
                  ['/docs/private-apis', 'Private paid APIs'],
                  ['/docs/custody', 'Custody'],
                  ['/docs/evidence', 'Evidence'],
                  ['https://github.com/Stella112/zlute', 'Source code'],
                ],
              ],
              [
                'Account',
                [
                  ['/signup', 'Create account'],
                  ['/login', 'Sign in'],
                ],
              ],
            ] as [string, [string, string][]][]
          ).map(([h, links]) => (
            <div key={h}>
              <p className="font-medium">{h}</p>
              <ul className="mt-3 space-y-2 text-muted">
                {links.map(([href, l]) => (
                  <li key={href}>
                    <a href={href} className="hover:text-text">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
