import React from 'react';
import { AbsoluteFill, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop, Body, Eyebrow, Headline, Mark, Screen, Tag, Terminal, ease, useProgress } from './components';
import { C, mono, sans, serif, s } from './theme';

/* ------------------------------------------------------------------ 1. Opening (0:00–0:12) */
export const Opening: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 10, fps, config: { damping: 14, mass: 0.8 } });
  // Shielded paths: lines converge into the mark.
  const paths = Array.from({ length: 9 }, (_, i) => i);
  const draw = useProgress(0, 70);
  const out = interpolate(f, [s(10.6), s(12)], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Backdrop glow={[50, 42]} />
      <svg width={1920} height={1080} style={{ position: 'absolute' }}>
        {paths.map((i) => {
          const y = 140 + i * 100;
          const d = `M -40 ${y} C 600 ${y}, 760 540, 960 470`;
          const d2 = `M 1960 ${1080 - y} C 1320 ${1080 - y}, 1160 540, 960 470`;
          return (
            <g key={i} opacity={0.5}>
              <path d={d} stroke={C.accent} strokeWidth={1.4} fill="none" strokeDasharray={1400} strokeDashoffset={1400 * (1 - draw)} opacity={0.25 + (i % 3) * 0.15} />
              <path d={d2} stroke={C.silver} strokeWidth={1} fill="none" strokeDasharray={1400} strokeDashoffset={1400 * (1 - draw)} opacity={0.15 + (i % 2) * 0.1} />
            </g>
          );
        })}
      </svg>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, transform: `scale(${0.6 + pop * 0.4})`, opacity: pop, marginTop: -40 }}>
          <Mark size={120} />
          <span style={{ fontFamily: serif, fontSize: 150, color: C.text, fontWeight: 500, letterSpacing: '-0.01em' }}>Lute</span>
        </div>
        <div style={{ height: 46 }} />
        <Headline text="PRIVATE MONEY." start={s(3.2)} size={64} style={{ letterSpacing: '0.22em' }} />
        <Headline text="PROGRAMMABLE PAYMENTS." start={s(4.4)} size={64} color={C.accent} style={{ letterSpacing: '0.22em' }} />
        <div style={{ height: 40 }} />
        <Body text="Built on Zcash · Live on mainnet at uselute.xyz" start={s(6.5)} style={{ fontSize: 24, letterSpacing: '0.06em' }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Section title on the left, content on the right. */
const SectionTitle: React.FC<{ n: string; title: string; sub: string; start?: number }> = ({ n, title, sub, start = 0 }) => (
  <div style={{ position: 'absolute', left: 110, top: 120, width: 560 }}>
    <Eyebrow text={n} start={start} />
    <div style={{ height: 22 }} />
    <Headline text={title} start={start + 6} size={78} />
    <div style={{ height: 22 }} />
    <Body text={sub} start={start + 16} />
  </div>
);

/* ------------------------------------------------------------------ 2. Shielded payments (0:12–0:35) */
const Redacted: React.FC<{ label: string; start: number }> = ({ label, start }) => {
  const p = useProgress(start, 20);
  const bar = useProgress(start + 10, 22);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: p, transform: `translateX(${(1 - p) * 30}px)` }}>
      <span style={{ width: 170, fontFamily: sans, fontSize: 26, color: C.muted }}>{label}</span>
      <span style={{ height: 34, width: 380 * bar, borderRadius: 8, background: `repeating-linear-gradient(90deg, ${C.raised}, ${C.raised} 14px, #202023 14px, #202023 28px)`, border: `1px solid ${C.line}` }} />
      <span style={{ fontFamily: mono, fontSize: 20, color: C.accent, opacity: bar }}>shielded</span>
    </div>
  );
};

const FlowStep: React.FC<{ i: number; title: string; sub: string; start: number; color?: string }> = ({ i, title, sub, start, color = C.accent }) => {
  const p = useProgress(start, 18);
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', opacity: p, transform: `translateY(${(1 - p) * 18}px)` }}>
      <span style={{ width: 54, height: 54, borderRadius: 27, border: `1.5px solid ${color}`, color, display: 'grid', placeItems: 'center', fontFamily: sans, fontWeight: 700, fontSize: 22 }}>{i}</span>
      <span>
        <div style={{ fontFamily: sans, fontSize: 28, color: C.text, fontWeight: 600 }}>{title}</div>
        <div style={{ fontFamily: sans, fontSize: 21, color: C.muted, marginTop: 4 }}>{sub}</div>
      </span>
    </div>
  );
};

export const Shielded: React.FC<{ paid: boolean }> = ({ paid }) => {
  return (
    <AbsoluteFill>
      <Backdrop glow={[78, 28]} />
      {/* A: real request with QR */}
      <Sequence durationInFrames={s(8)}>
        <SectionTitle n="01 · SHIELDED PAYMENTS" title="Get paid with a link." sub="A fresh shielded address and memo for every request. Paid only after confirmations." />
        <div style={{ position: 'absolute', right: 90, top: 150 }}>
          <Screen src="shots/app-request-qr.png" url="uselute.xyz/receive" start={0} dur={s(8)} width={1080} from={{ scale: 1.12, x: -60, y: 60 }} to={{ scale: 1.42, x: -95, y: 90 }} />
        </div>
        <Tag kind="live" text="Real request on mainnet, created 28 Oct" start={s(1)} style={{ position: 'absolute', right: 90, top: 92 }} />
      </Sequence>
      {/* B: what the chain sees */}
      <Sequence from={s(8)} durationInFrames={s(6.5)}>
        <SectionTitle n="ON CHAIN" title="Nothing to read." sub="Zcash shields the sender, recipient, amount and memo. Lute refuses anything transparent or cross-pool." />
        <div style={{ position: 'absolute', right: 150, top: 300, display: 'flex', flexDirection: 'column', gap: 34 }}>
          <div style={{ fontFamily: mono, fontSize: 20, color: C.muted, marginBottom: 8 }}>tx e8f1de04…887a · Ironwood · 2 actions · 0 transparent</div>
          <Redacted label="Sender" start={10} />
          <Redacted label="Recipient" start={18} />
          <Redacted label="Amount" start={26} />
          <Redacted label="Memo" start={34} />
        </div>
        <Tag kind="mainnet" text="E-014 · every Lute transaction audited SHIELDED_SINGLE_POOL" start={s(1.4)} style={{ position: 'absolute', right: 150, top: 760 }} />
      </Sequence>
      {/* C: non-custodial browser signing */}
      <Sequence from={s(14.5)} durationInFrames={s(8.5)}>
        <SectionTitle n="NON-CUSTODIAL" title="Your keys stay in your browser." sub="Lute builds the transaction. Your browser checks exactly what it pays, then signs it." />
        <div style={{ position: 'absolute', right: 130, top: 230, display: 'flex', flexDirection: 'column', gap: 34 }}>
          <FlowStep i={1} title="Recovery phrase created in the browser" sub="Lute receives viewing keys only" start={6} />
          <FlowStep i={2} title="Lute builds and proves the payment" sub="An unsigned transaction (PCZT)" start={26} />
          <FlowStep i={3} title="Browser checks recipient, amount, fee" sub="Refuses anything else, then signs" start={46} />
          <FlowStep i={4} title="Broadcast once, shielded" sub="Lute holds no key that can move the money" start={66} color={C.ok} />
        </div>
        <Tag kind="mainnet" text="E-017 · browser-signed payout · tx e8f1de04…887a" start={s(3.2)} style={{ position: 'absolute', right: 130, top: 800 }} />
        <div style={{ position: 'absolute', left: 110, top: 500 }}>
          <Screen src="shots/signup.png" url="uselute.xyz/signup" start={s(1.2)} dur={s(7)} width={760} from={{ scale: 1.5, x: 0, y: 20 }} to={{ scale: 1.62, x: 0, y: 20 }} />
        </div>
      </Sequence>
      {paid ? null : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ 3. Payroll (0:35–0:55) */
const Recipient: React.FC<{ name: string; amount: string; y: number; start: number }> = ({ name, amount, y, start }) => {
  const p = useProgress(start, 22);
  return (
    <g opacity={p}>
      <path d={`M 560 300 C 700 300, 720 ${y}, 860 ${y}`} stroke={C.accent} strokeWidth={2} fill="none" strokeDasharray={420} strokeDashoffset={420 * (1 - p)} />
      <rect x={870} y={y - 38} width={420} height={76} rx={16} fill={C.surface} stroke={C.line} />
      <text x={898} y={y - 4} fill={C.text} fontFamily={sans} fontSize={26} fontWeight={600}>{name}</text>
      <text x={898} y={y + 26} fill={C.muted} fontFamily={sans} fontSize={20}>sees only their own pay</text>
      <text x={1270} y={y + 8} fill={C.accent} fontFamily={mono} fontSize={24} textAnchor="end">{amount}</text>
    </g>
  );
};

export const Payroll: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={[30, 70]} />
      <Sequence durationInFrames={s(7)}>
        <SectionTitle n="02 · ORGANIZATIONS" title="Pay a team in one transaction." sub="BatchPay: up to ten people, one approval, one network fee." />
        <div style={{ position: 'absolute', right: 80, top: 150 }}>
          <Screen src="shots/app-payroll-runs.png" url="uselute.xyz/payroll" start={0} dur={s(7)} width={1100} from={{ scale: 1.08, x: -40, y: -400 }} to={{ scale: 1.7, x: -60, y: -400 }} />
        </div>
        <Tag kind="mainnet" text="E-020 · payroll of 2 · tx 26c815f9…a9be" start={s(1.5)} style={{ position: 'absolute', right: 80, top: 92 }} />
      </Sequence>
      <Sequence from={s(7)} durationInFrames={s(7)}>
        <svg width={1920} height={1080} style={{ position: 'absolute', left: 230, top: 90 }}>
          <rect x={220} y={240} width={340} height={120} rx={20} fill={C.raised} stroke={C.accent} />
          <text x={390} y={292} fill={C.text} fontFamily={sans} fontSize={28} fontWeight={700} textAnchor="middle">1 shielded tx</text>
          <text x={390} y={330} fill={C.muted} fontFamily={sans} fontSize={21} textAnchor="middle">1 approval · 1 fee (0.0002)</text>
          <Recipient name="Payee 1" amount="0.001 ZEC" y={180} start={14} />
          <Recipient name="Payee 2" amount="0.002 ZEC" y={300} start={26} />
          <Recipient name="Payee 3" amount="0.003 ZEC" y={420} start={38} />
        </svg>
        <div style={{ position: 'absolute', left: 450, top: 650, display: 'flex', gap: 22 }}>
          {[
            ['Owner', 'approves and signs'],
            ['Admin', 'prepares payroll'],
            ['Operator', 'runs saved payrolls only'],
          ].map(([r, d], i) => {
            const p = interpolate(f - s(7), [50 + i * 10, 70 + i * 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
            return (
              <div key={r} style={{ padding: '18px 26px', borderRadius: 16, background: C.surface, border: `1px solid ${C.line}`, opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
                <div style={{ fontFamily: sans, fontSize: 26, color: i === 0 ? C.accent : C.text, fontWeight: 700 }}>{r}</div>
                <div style={{ fontFamily: sans, fontSize: 20, color: C.muted, marginTop: 4 }}>{d}</div>
              </div>
            );
          })}
        </div>
        <Tag kind="regtest" text="E-019 · 3 recipients, one transaction; a changed line was refused" start={20} style={{ position: 'absolute', left: 450, top: 820 }} />
        <div style={{ position: 'absolute', left: 450, top: 110 }}>
          <Eyebrow text="BATCHPAY · ONE TRANSACTION, MANY PEOPLE" start={0} />
        </div>
      </Sequence>
      <Sequence from={s(14)} durationInFrames={s(6)}>
        <SectionTitle n="PRIVATE PAYSLIPS" title="Each person, their own proof." sub="A private link, also sent in their own shielded memo. Signed once paid." />
        <div style={{ position: 'absolute', right: 110, top: 190 }}>
          <Screen src="shots/payslip.png" url="uselute.xyz/payslip/…" start={0} dur={s(6)} width={1020} from={{ scale: 1.7, x: 0, y: 0 }} to={{ scale: 1.95, x: 0, y: 0 }} />
        </div>
        <Tag kind="mainnet" text="E-020 · real payslip, Paid and signed" start={s(1)} style={{ position: 'absolute', right: 110, top: 132 }} />
      </Sequence>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ 4. Agents + LuteGuard (0:55–1:30) */
const MandateRow: React.FC<{ k: string; v: string; start: number }> = ({ k, v, start }) => {
  const p = useProgress(start, 16);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderBottom: `1px solid ${C.line}`, opacity: p }}>
      <span style={{ fontFamily: sans, fontSize: 23, color: C.muted }}>{k}</span>
      <span style={{ fontFamily: mono, fontSize: 23, color: C.text }}>{v}</span>
    </div>
  );
};

const Gate: React.FC<{ start: number; ok: boolean; label: string; sub: string }> = ({ start, ok, label, sub }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - start, fps, config: { damping: 12 } });
  const color = ok ? C.ok : C.bad;
  return (
    <div style={{ opacity: Math.min(1, p), transform: `scale(${0.8 + 0.2 * p})`, padding: '22px 30px', borderRadius: 20, border: `2px solid ${color}`, background: `${color}14`, boxShadow: `0 0 50px ${color}33` }}>
      <div style={{ fontFamily: sans, fontSize: 18, color: C.muted, letterSpacing: '0.2em' }}>LUTEGUARD</div>
      <div style={{ fontFamily: sans, fontSize: 40, color, fontWeight: 800, marginTop: 6 }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 20, color: C.text, marginTop: 6 }}>{sub}</div>
    </div>
  );
};

export const Agents: React.FC = () => {
  const G = C.ok;
  return (
    <AbsoluteFill>
      <Backdrop glow={[50, 20]} />
      {/* Title */}
      <Sequence durationInFrames={s(5)}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <Eyebrow text="03 · AI AGENTS + LUTEGUARD" start={0} />
          <div style={{ height: 30 }} />
          <Headline text="The agent has intent." start={6} size={96} />
          <Headline text="LuteGuard has authority." start={20} size={96} color={C.accent} italic />
        </AbsoluteFill>
      </Sequence>
      {/* Mandate + terminal */}
      <Sequence from={s(5)} durationInFrames={s(18.6)}>
        <div style={{ position: 'absolute', left: 90, top: 110, width: 560 }}>
          <Eyebrow text="MANDATE SIGNED ONCE BY THE OWNER" start={0} />
          <div style={{ marginTop: 18, padding: '18px 28px', borderRadius: 20, background: C.surface, border: `1px solid ${C.line}` }}>
            <MandateRow k="Payee" v="1 service address" start={8} />
            <MandateRow k="Per payment" v="≤ 0.0001 ZEC" start={16} />
            <MandateRow k="Total budget" v="0.0003 ZEC" start={24} />
            <MandateRow k="Expires" v="28 Oct 14:06 UTC" start={32} />
            <MandateRow k="Signed by" v="owner key (laptop)" start={40} />
          </div>
          <div style={{ marginTop: 34 }}>
            <Gate start={s(10.5)} ok label="ALLOW · SUBMITTED" sub="1,000 zat → service, under mandate" />
          </div>
        </div>
        <div style={{ position: 'absolute', right: 80, top: 110 }}>
          <Terminal
            title="Agent via MCP · real run, 28 Oct 2026 13:46 UTC"
            width={1060}
            height={760}
            lines={[
              { text: '> lute_quote_document  (invoice NW-2026-204)', color: C.accent, at: 10 },
              { text: '  pages 1 · amount_zat 1000 · expires in 2 min', at: 40 },
              { text: '  binds: this session, service, price, exact text; one use', color: C.muted, at: 70 },
              { text: '> lute_extract_document  quote_id=QzbQmS02…', color: C.accent, at: 120 },
              { text: '  invoice_number  NW-2026-204', at: 150 },
              { text: '  amounts  USD 1,800.00 · ZEC 0.2 · USD 1,950.00', at: 175 },
              { text: '  total    USD 1,950.00', at: 200 },
              { text: '  charge   1000 zat · quote honoured', color: G, at: 225 },
              { text: '> lute_extract_document  (same quote)', color: C.accent, at: 265 },
              { text: '  409 QUOTE_ALREADY_USED', color: C.bad, at: 290 },
              { text: '> lute_propose_settlement', color: C.accent, at: 320 },
              { text: '  state SUBMITTED · shielded · tx ac68ee91…a6d5', color: G, at: 345 },
            ]}
          />
        </div>
        <Tag kind="mainnet" text="tx ac68ee91…a6d5 · mined 3533628 · SHIELDED_SINGLE_POOL" start={s(12)} style={{ position: 'absolute', right: 80, top: 900 }} />
      </Sequence>
      {/* Over the limit */}
      <Sequence from={s(23.6)} durationInFrames={s(11.4)}>
        <div style={{ position: 'absolute', left: 90, top: 120, width: 760 }}>
          <Eyebrow text="THE AGENT TRIES TO PAY MORE" start={0} />
          <div style={{ height: 20 }} />
          <Headline text="11,000 zat due." start={6} size={84} />
          <Headline text="Limit: 10,000." start={18} size={84} color={C.muted} />
          <div style={{ height: 40 }} />
          <Gate start={s(3)} ok={false} label="REJECTED" sub="OVER_GRANT_PER_TX · nothing built" />
          <div style={{ height: 36 }} />
          <Body text="Deterministic rules, signed by the owner. Not model judgment." start={s(5)} style={{ fontSize: 30, color: C.text }} />
        </div>
        <div style={{ position: 'absolute', right: 80, top: 150 }}>
          <Screen src="shots/app-privacy-tests.png" url="uselute.xyz/privacy" start={s(1)} dur={s(12)} width={980} from={{ scale: 2.2, x: -61, y: -70 }} to={{ scale: 2.35, x: -61, y: -77 }} />
        </div>
        <Tag kind="mainnet" text="DENY recorded 28 Oct 13:49:33 UTC" start={s(4)} style={{ position: 'absolute', right: 80, top: 92 }} />
      </Sequence>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ 5. Commerce montage (1:30–1:44) */
const Tile: React.FC<{ src: string; url: string; title: string; tag: React.ReactNode; start: number; x: number; y: number }> = ({ src, url, title, tag, start, x, y }) => {
  const p = useProgress(start, 18);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 600, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, height: 44 }}>
        <div style={{ fontFamily: sans, fontSize: 24, color: C.text, fontWeight: 600 }}>{title}</div>
        {tag}
      </div>
      <Screen src={src} url={url} start={start} dur={s(13)} width={600} from={{ scale: 1.6, x: -44, y: 40 }} to={{ scale: 1.75, x: -44, y: 40 }} />
    </div>
  );
};

export const Commerce: React.FC = () => (
  <AbsoluteFill>
    <Backdrop glow={[50, 50]} />
    <div style={{ position: 'absolute', left: 330, top: 40 }}>
      <Eyebrow text="04 · ONE ENGINE, EVERY PAYMENT" start={0} />
    </div>
    <Tile src="shots/app-commerce.png" url="uselute.xyz/commerce" title="Checkout · receipts · refunds" tag={<Tag kind="regtest" text="E-012" start={12} style={{ fontSize: 16, padding: '6px 12px' }} />} start={4} x={330} y={70} />
    <Tile src="shots/app-subscriptions.png" url="uselute.xyz/subscriptions" title="Recurring, no auto-debit" tag={<Tag kind="regtest" text="E-013" start={30} style={{ fontSize: 16, padding: '6px 12px' }} />} start={22} x={990} y={70} />
    <Tile src="shots/app-streams.png" url="uselute.xyz/streams" title="Streams, paid by the second" tag={<Tag kind="mainnet" text="E-008" start={48} style={{ fontSize: 16, padding: '6px 12px' }} />} start={40} x={330} y={505} />
    <Tile src="shots/app-send-fee.png" url="uselute.xyz/send" title="Fee shown before approval" tag={<Tag kind="live" text="ZIP-317" start={66} style={{ fontSize: 16, padding: '6px 12px' }} />} start={58} x={990} y={505} />
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ 6. Proof + close (1:44–1:59) */
export const Proof: React.FC = () => {
  const f = useCurrentFrame();
  const count = Math.round(interpolate(f, [s(1), s(3.5)], [0, 277], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }));
  return (
    <AbsoluteFill>
      <Backdrop glow={[70, 40]} />
      <Sequence durationInFrames={s(6.3)}>
        <SectionTitle n="05 · PROOF, NOT PROMISES" title="Every claim has evidence." sub="20 evidence records with mainnet transactions, tests and limits written down." />
        <div style={{ position: 'absolute', left: 110, top: 560, display: 'flex', gap: 48 }}>
          <div>
            <div style={{ fontFamily: sans, fontSize: 96, color: C.accent, fontWeight: 700, lineHeight: 1 }}>{count}</div>
            <div style={{ fontFamily: sans, fontSize: 22, color: C.muted, marginTop: 8 }}>tests passing</div>
          </div>
          <div>
            <div style={{ fontFamily: sans, fontSize: 96, color: C.text, fontWeight: 700, lineHeight: 1 }}>11/11</div>
            <div style={{ fontFamily: sans, fontSize: 22, color: C.muted, marginTop: 8 }}>mainnet txs single-pool</div>
          </div>
        </div>
        <Tag kind="ci" text="evidence/results.json · all suites pass" start={s(2)} style={{ position: 'absolute', left: 110, top: 800 }} />
        <div style={{ position: 'absolute', right: 80, top: 150 }}>
          <Screen src="shots/evidence-e014.png" url="uselute.xyz/docs/evidence#e-014" start={0} dur={s(7.5)} width={1060} from={{ scale: 1, x: 0, y: 0 }} to={{ scale: 1.12, x: 0, y: -20 }} />
        </div>
      </Sequence>
      <Sequence from={s(6.3)} durationInFrames={s(8.7)}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <Mark size={96} />
          <div style={{ height: 34 }} />
          <Headline text="Programmable privacy" start={6} size={92} />
          <Headline text="for people, businesses and AI agents." start={16} size={64} color={C.muted} italic />
          <div style={{ height: 50 }} />
          <div style={{ display: 'flex', gap: 60, fontFamily: sans, fontSize: 30, color: C.text, opacity: interpolate(f - s(7.5), [30, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
            <span>
              <span style={{ color: C.accent }}>●</span> uselute.xyz
            </span>
            <span>
              <span style={{ color: C.accent }}>●</span> github.com/Stella112/zlute
            </span>
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

export const EndCard: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
      <Mark size={80} />
      <span style={{ fontFamily: serif, fontSize: 110, color: C.text }}>Lute</span>
    </div>
    <div style={{ fontFamily: sans, fontSize: 22, color: C.muted, marginTop: 18, letterSpacing: '0.2em' }}>ZECATHON 2026 · SHIELDED PAYMENTS</div>
  </AbsoluteFill>
);

export { Img, staticFile };
