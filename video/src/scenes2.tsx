import React from 'react';
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop, Body, Eyebrow, Headline, Mark, Screen, Tag, Terminal, useProgress } from './components';
import { C, mono, sans, serif, s } from './theme';

/* Agent-first cut: dashboard → MCP → real metered run → refusal → sell an API → streams → subscriptions → payroll. */

const SectionTitle: React.FC<{ n: string; title: string; sub?: string; start?: number; width?: number; top?: number }> = ({ n, title, sub, start = 0, width = 600, top = 120 }) => (
  <div style={{ position: 'absolute', left: 100, top, width }}>
    <Eyebrow text={n} start={start} />
    <div style={{ height: 22 }} />
    <Headline text={title} start={start + 6} size={74} />
    {sub && (
      <>
        <div style={{ height: 22 }} />
        <Body text={sub} start={start + 16} />
      </>
    )}
  </div>
);

/* ------------------------------------------------------------------ Opening (0–5) */
export const Opening2: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 4, fps, config: { damping: 14, mass: 0.8 } });
  const draw = useProgress(0, 50);
  const out = interpolate(f, [s(4.3), s(5)], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Backdrop glow={[50, 42]} />
      <svg width={1920} height={1080} style={{ position: 'absolute' }}>
        {Array.from({ length: 9 }, (_, i) => {
          const y = 140 + i * 100;
          return (
            <g key={i} opacity={0.5}>
              <path d={`M -40 ${y} C 600 ${y}, 760 540, 960 470`} stroke={C.accent} strokeWidth={1.4} fill="none" strokeDasharray={1400} strokeDashoffset={1400 * (1 - draw)} opacity={0.25 + (i % 3) * 0.15} />
              <path d={`M 1960 ${1080 - y} C 1320 ${1080 - y}, 1160 540, 960 470`} stroke={C.silver} strokeWidth={1} fill="none" strokeDasharray={1400} strokeDashoffset={1400 * (1 - draw)} opacity={0.15 + (i % 2) * 0.1} />
            </g>
          );
        })}
      </svg>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, transform: `scale(${0.6 + pop * 0.4})`, opacity: pop, marginTop: -40 }}>
          <Mark size={120} />
          <span style={{ fontFamily: serif, fontSize: 150, color: C.text, fontWeight: 500 }}>Lute</span>
        </div>
        <div style={{ height: 40 }} />
        <Headline text="PRIVATE MONEY." start={s(0.9)} size={60} style={{ letterSpacing: '0.22em' }} />
        <Headline text="PROGRAMMABLE PAYMENTS." start={s(1.8)} size={60} color={C.accent} style={{ letterSpacing: '0.22em' }} />
        <div style={{ height: 34 }} />
        <Body text="Agents · APIs · Streams · Subscriptions · on Zcash mainnet" start={s(2.6)} style={{ fontSize: 24, letterSpacing: '0.06em' }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ Dashboard (5–15.2) */
export const Dashboard: React.FC = () => (
  <AbsoluteFill>
    <Backdrop glow={[50, 30]} />
    <div style={{ position: 'absolute', left: 160, top: 80 }}>
      <Screen src="shots/app-home.png" url="uselute.xyz" start={0} dur={s(10)} width={1600} from={{ scale: 1, x: 0, y: 0 }} to={{ scale: 1.55, x: -70, y: -130 }} />
    </div>
    <Tag kind="mainnet" text="Real account · Zcash mainnet · 28 Oct" start={s(0.8)} style={{ position: 'absolute', left: 160, top: 20 }} />
    <Tag kind="mainnet" text="Agent payment confirming · over-limit payment blocked" start={s(6.3)} style={{ position: 'absolute', right: 160, top: 20 }} />
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ Paid request (15.2–20.3) */
export const Received: React.FC = () => (
  <AbsoluteFill>
    <Backdrop glow={[70, 40]} />
    <SectionTitle n="GET PAID" title="One link. Paid, confirmed." sub="A fresh shielded address and memo for every request." top={260} width={640} />
    <div style={{ position: 'absolute', right: 100, top: 180 }}>
      <Screen src="shots/request-paid.png" url="uselute.xyz/r/…" start={0} dur={s(5)} width={1040} from={{ scale: 1, x: 0, y: 0 }} to={{ scale: 1.08, x: 0, y: 0 }} />
    </div>
    <Tag kind="mainnet" text="0.0004 ZEC request, paid 28 Oct" start={s(0.8)} style={{ position: 'absolute', right: 100, top: 120 }} />
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ MCP tools (20.3–30.6) */
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

const ToolRow: React.FC<{ name: string; desc: string; start: number }> = ({ name, desc, start }) => {
  const p = useProgress(start, 12);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, padding: '9px 0', borderBottom: `1px solid ${C.line}`, opacity: p, transform: `translateX(${(1 - p) * 24}px)` }}>
      <span style={{ fontFamily: mono, fontSize: 25, color: C.accent, width: 420 }}>{name}</span>
      <span style={{ fontFamily: sans, fontSize: 22, color: C.muted }}>{desc}</span>
    </div>
  );
};

const Node: React.FC<{ label: string; sub: string; start: number; color?: string }> = ({ label, sub, start, color = C.accent }) => {
  const p = useProgress(start, 16);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 14}px)`, padding: '16px 22px', borderRadius: 16, border: `1.5px solid ${color}`, background: `${color}12`, width: 520 }}>
      <div style={{ fontFamily: sans, fontSize: 28, color: C.text, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: sans, fontSize: 20, color: C.muted, marginTop: 4 }}>{sub}</div>
    </div>
  );
};

const Arrow: React.FC<{ start: number }> = ({ start }) => {
  const p = useProgress(start, 10);
  return <div style={{ height: 34, marginLeft: 40, borderLeft: `2px dashed ${C.accent}`, opacity: p }} />;
};

export const McpTools: React.FC = () => (
  <AbsoluteFill>
    <Backdrop glow={[30, 30]} />
    <div style={{ position: 'absolute', left: 100, top: 90 }}>
      <Eyebrow text="AI AGENTS · LUTE MCP SERVER" start={0} />
      <div style={{ height: 22 }} />
      <Headline text="Agents pay for APIs," start={6} size={74} />
      <Headline text="inside rules you sign." start={16} size={74} color={C.accent} italic />
      <div style={{ height: 40 }} />
      <Node label="Claude (any MCP agent)" sub="expresses intent: call, quote, settle" start={s(1.5)} color={C.silver} />
      <Arrow start={s(2.0)} />
      <Node label="Lute MCP server" sub="10 tools · agent token · metered sessions" start={s(2.3)} />
      <Arrow start={s(2.8)} />
      <Node label="LuteGuard → shielded Zcash" sub="owner-signed mandate decides; pays from the agent wallet" start={s(3.1)} color={C.ok} />
    </div>
    <div style={{ position: 'absolute', right: 100, top: 130, width: 900, padding: '22px 32px', borderRadius: 20, background: C.surface, border: `1px solid ${C.line}` }}>
      <div style={{ fontFamily: sans, fontSize: 18, letterSpacing: '0.2em', color: C.muted, marginBottom: 8 }}>TOOLS (apps/mcp)</div>
      {TOOLS.map(([n, d], i) => (
        <ToolRow key={n} name={n} desc={d} start={s(4.6) + i * 6} />
      ))}
    </div>
    <Tag kind="live" text="10 tools · MCP stdio · 7/7 MCP tests" start={s(6)} style={{ position: 'absolute', right: 100, top: 860 }} />
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ Real run (30.6–52.2) */
const MandateRow: React.FC<{ k: string; v: string; start: number }> = ({ k, v, start }) => {
  const p = useProgress(start, 16);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${C.line}`, opacity: p }}>
      <span style={{ fontFamily: sans, fontSize: 22, color: C.muted }}>{k}</span>
      <span style={{ fontFamily: mono, fontSize: 22, color: C.text }}>{v}</span>
    </div>
  );
};

const Gate: React.FC<{ start: number; ok: boolean; label: string; sub: string }> = ({ start, ok, label, sub }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - start, fps, config: { damping: 12 } });
  const color = ok ? C.ok : C.bad;
  if (f < start) return null;
  return (
    <div style={{ opacity: Math.min(1, p), transform: `scale(${0.8 + 0.2 * p})`, padding: '20px 28px', borderRadius: 20, border: `2px solid ${color}`, background: `${color}14`, boxShadow: `0 0 50px ${color}33` }}>
      <div style={{ fontFamily: sans, fontSize: 17, color: C.muted, letterSpacing: '0.2em' }}>LUTEGUARD</div>
      <div style={{ fontFamily: sans, fontSize: 38, color, fontWeight: 800, marginTop: 6 }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 19, color: C.text, marginTop: 6 }}>{sub}</div>
    </div>
  );
};

const Mandate: React.FC = () => (
  <div style={{ marginTop: 16, padding: '12px 26px', borderRadius: 20, background: C.surface, border: `1px solid ${C.line}` }}>
    <MandateRow k="Payee" v="1 service address" start={8} />
    <MandateRow k="Per payment" v="≤ 10,000 zat" start={14} />
    <MandateRow k="Total budget" v="30,000 zat" start={20} />
    <MandateRow k="Expires" v="28 Oct 14:06 UTC" start={26} />
    <MandateRow k="Signed by" v="owner key (laptop)" start={32} />
  </div>
);

export const AgentRun: React.FC = () => {
  const G = C.ok;
  const T = (sec: number) => s(sec);
  return (
    <AbsoluteFill>
      <Backdrop glow={[50, 20]} />
      <div style={{ position: 'absolute', left: 80, top: 90, width: 560 }}>
        <Eyebrow text="REAL RUN · MAINNET · 13:46 UTC" start={0} />
        <Mandate />
        <div style={{ marginTop: 28 }}>
          <Gate start={T(15.4)} ok label="ALLOW · SUBMITTED" sub="1,000 zat → service, no click" />
        </div>
      </div>
      <div style={{ position: 'absolute', right: 70, top: 80 }}>
        <Terminal
          title="Claude → Lute MCP server (stdio) · real transcript"
          width={1150}
          height={800}
          fontSize={25}
          lines={[
            { text: '> lute_get_wallet_status', color: C.accent, at: T(2.4) },
            { text: '  network main · wallet agent · per tx 10,000 · remaining 23,000 zat', at: T(3.0) },
            { text: '> lute_create_meter_session', color: C.accent, at: T(4.3) },
            { text: '  session ckN4L-3X… · 1,000 zat per page · credit 15,000', at: T(4.9) },
            { text: '> lute_quote_document  invoice NW-2026-204', color: C.accent, at: T(7.2) },
            { text: '  quote QzbQmS02… · 1 page · 1,000 zat · one use', at: T(7.8) },
            { text: '> lute_extract_document  quote=QzbQmS02…', color: C.accent, at: T(10.2) },
            { text: '  Northwind Studio · NW-2026-204 · total USD 1,950.00', at: T(10.8) },
            { text: '  charge 1,000 zat · quote honoured', color: G, at: T(11.6) },
            { text: '> lute_extract_document  (same quote again)', color: C.accent, at: T(12.0) },
            { text: '  409 QUOTE_ALREADY_USED', color: C.bad, at: T(12.6) },
            { text: '> lute_propose_settlement', color: C.accent, at: T(14.1) },
            { text: '  SUBMITTED · broadcast · shielded', color: G, at: T(14.8) },
            { text: '  tx ac68ee91c3ad…6fcfa6d5 · mined 3533628', color: G, at: T(15.6) },
          ]}
        />
      </div>
      <Tag kind="mainnet" text="tx ac68ee91…a6d5 · mined 3533628 · SHIELDED_SINGLE_POOL" start={T(16)} style={{ position: 'absolute', right: 70, top: 905 }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ Meter + refusal (52.2–65) */
const Meter: React.FC = () => {
  const f = useCurrentFrame();
  const calls = Math.max(0, Math.min(11, Math.floor(interpolate(f, [s(1.8), s(5.2)], [0, 11], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))));
  const due = calls * 1000;
  const pct = Math.min(1, due / 15000);
  const capX = (10000 / 15000) * 100;
  return (
    <div style={{ padding: '26px 32px', borderRadius: 20, background: C.surface, border: `1px solid ${C.line}`, width: 720 }}>
      <div style={{ fontFamily: sans, fontSize: 18, letterSpacing: '0.2em', color: C.muted }}>METERED SESSION · DUE</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 8 }}>
        <span style={{ fontFamily: sans, fontSize: 92, fontWeight: 700, color: due > 10000 ? C.bad : C.text, fontVariantNumeric: 'tabular-nums' }}>{due.toLocaleString('en-US')}</span>
        <span style={{ fontFamily: sans, fontSize: 30, color: C.muted }}>zat · {calls} calls</span>
      </div>
      <div style={{ position: 'relative', height: 18, borderRadius: 9, background: C.raised, marginTop: 18 }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 9, background: due > 10000 ? C.bad : C.accent }} />
        <div style={{ position: 'absolute', left: `${capX}%`, top: -10, bottom: -10, borderLeft: `2px dashed ${C.warn}` }} />
      </div>
      <div style={{ position: 'relative', height: 30, marginTop: 8 }}>
        <span style={{ position: 'absolute', left: `${capX}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontFamily: mono, fontSize: 18, color: C.warn }}>per-payment limit 10,000</span>
      </div>
    </div>
  );
};

export const AgentLimit: React.FC = () => {
  const T = (sec: number) => s(sec);
  const calls = Array.from({ length: 11 }, (_, i) => ({ text: `  call ${String(i + 1).padStart(2, ' ')} · 200 · due ${((i + 1) * 1000).toLocaleString('en-US')} zat`, color: i === 10 ? C.warn : C.text, at: T(1.8) + Math.round(i * 9.2) }));
  return (
    <AbsoluteFill>
      <Backdrop glow={[40, 30]} />
      <div style={{ position: 'absolute', left: 80, top: 90 }}>
        <Eyebrow text="PAY PER CALL · SAME REAL RUN" start={0} />
        <div style={{ height: 22 }} />
        <Meter />
        <div style={{ marginTop: 30 }}>
          <Gate start={T(7.6)} ok={false} label="REJECTED · OVER_GRANT_PER_TX" sub="11,000 > 10,000 · nothing built" />
        </div>
      </div>
      <div style={{ position: 'absolute', right: 70, top: 80 }}>
        <Terminal
          title="Claude → Lute MCP server · real transcript (cont.)"
          width={1020}
          height={800}
          fontSize={23}
          lines={[
            { text: '> lute_call_metered_api  × 11', color: C.accent, at: T(1.2) },
            ...calls,
            { text: '> lute_propose_settlement', color: C.accent, at: T(5.6) },
            { text: '  REJECTED · OVER_GRANT_PER_TX', color: C.bad, at: T(7.4) },
            { text: '> lute_verify_settlement', color: C.accent, at: T(9.4) },
            { text: '  #1   1,000 zat  tx ac68ee91…a6d5', color: C.ok, at: T(10) },
            { text: '  #2  11,000 zat  REJECTED, no tx', color: C.bad, at: T(10.6) },
          ]}
        />
      </div>
      <Tag kind="mainnet" text="DENY recorded 28 Oct 13:49:33 UTC" start={T(8)} style={{ position: 'absolute', left: 80, top: 905 }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ Sell your API (65–73) */
export const SellApi: React.FC = () => (
  <AbsoluteFill>
    <Backdrop glow={[60, 40]} />
    <SectionTitle n="SELL AN API TO AGENTS" title="Price per call. Paid privately." sub="Run it on Lute, or let agents pay an outside API's invoices. Sell to other accounts' agents over HTTP 402." width={620} />
    <div style={{ position: 'absolute', right: 90, top: 150 }}>
      <Screen src="shots/app-agents.png" url="uselute.xyz/agents" start={0} dur={s(4)} width={1080} from={{ scale: 1.7, x: -120, y: 30 }} to={{ scale: 1.8, x: -120, y: 20 }} />
    </div>
    <Sequence from={s(4)}>
      <div style={{ position: 'absolute', right: 90, top: 150 }}>
        <Screen src="shots/app-agents-grants.png" url="uselute.xyz/agents" start={0} dur={s(4)} width={1080} from={{ scale: 1.8, x: -120, y: -175 }} to={{ scale: 1.9, x: -120, y: -180 }} />
      </div>
    </Sequence>
    <Tag kind="live" text="Agents page · active grant, spent 0.00008 of 0.0003 ZEC" start={s(4.3)} style={{ position: 'absolute', right: 90, top: 92 }} />
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ Streams (73–86) */
const StreamCounter: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Illustration: 0.0003 ZEC over 10 minutes = 50 zat per second.
  const secs = Math.max(0, f / fps - 0.6) * 60; // sped up 60×
  const zat = Math.min(30000, Math.floor(secs) * 50);
  const p = useProgress(6, 16);
  return (
    <div style={{ opacity: p, padding: '24px 30px', borderRadius: 20, background: C.surface, border: `1px solid ${C.line}`, width: 660 }}>
      <div style={{ fontFamily: sans, fontSize: 18, letterSpacing: '0.2em', color: C.muted }}>ACCRUED · 50 ZAT / SECOND</div>
      <div style={{ fontFamily: sans, fontSize: 80, fontWeight: 700, color: C.text, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
        {(zat / 1e8).toFixed(8)} <span style={{ fontSize: 30, color: C.muted }}>ZEC</span>
      </div>
      <div style={{ height: 14, borderRadius: 7, background: C.raised, marginTop: 14 }}>
        <div style={{ width: `${(zat / 30000) * 100}%`, height: '100%', borderRadius: 7, background: C.accent }} />
      </div>
      <div style={{ fontFamily: sans, fontSize: 20, color: C.muted, marginTop: 14 }}>A figure until a payout is approved. Then one shielded payment.</div>
    </div>
  );
};

export const Streams: React.FC = () => (
  <AbsoluteFill>
    <Backdrop glow={[30, 50]} />
    <SectionTitle n="STREAMS" title="Paid by the second." start={0} width={680} top={90} />
    <div style={{ position: 'absolute', left: 100, top: 330 }}>
      <StreamCounter />
      <Tag kind="diagram" text="accrual sped up 60× for the video" start={s(1)} style={{ marginTop: 16 }} />
    </div>
    <div style={{ position: 'absolute', right: 90, top: 150 }}>
      <Screen src="shots/app-streams.png" url="uselute.xyz/streams" start={0} dur={s(13)} width={1000} from={{ scale: 2.2, x: -67, y: 130 }} to={{ scale: 2.4, x: -67, y: 130 }} />
    </div>
    <Tag kind="mainnet" text="E-008 · stream paid out 0.0003 ZEC" start={s(9)} style={{ position: 'absolute', right: 90, top: 92 }} />
    <Sequence from={s(9.2)}>
      <div style={{ position: 'absolute', right: 90, top: 760, width: 1000, display: 'flex', gap: 16 }}>
        <Tag kind="live" text="What streams owe rolls into payroll" start={0} />
      </div>
    </Sequence>
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ Subscriptions (86–96.5) */
export const Subscriptions: React.FC = () => (
  <AbsoluteFill>
    <Backdrop glow={[70, 30]} />
    <SectionTitle n="SUBSCRIPTIONS" title="Recurring, without auto-debit." sub="A fresh shielded invoice every period. Active, due, lapsed after grace. Cancel any time." width={620} />
    <div style={{ position: 'absolute', right: 90, top: 150 }}>
      <Screen src="shots/app-subscriptions.png" url="uselute.xyz/subscriptions" start={0} dur={s(10.5)} width={1080} from={{ scale: 1.5, x: -90, y: 40 }} to={{ scale: 1.7, x: -90, y: 10 }} />
    </div>
    <Tag kind="regtest" text="E-013 · paid, due and lapsed periods" start={s(1)} style={{ position: 'absolute', right: 90, top: 92 }} />
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ Payroll (96.5–104) */
export const Payroll2: React.FC = () => (
  <AbsoluteFill>
    <Backdrop glow={[40, 60]} />
    <div style={{ position: 'absolute', left: 100, top: 90 }}>
      <Eyebrow text="PAYROLL · BATCHPAY" start={0} />
      <div style={{ height: 18 }} />
      <Headline text="A team, one transaction." start={6} size={70} />
    </div>
    <div style={{ position: 'absolute', left: 100, top: 300 }}>
      <Screen src="shots/app-payroll-runs.png" url="uselute.xyz/payroll" start={0} dur={s(7.5)} width={860} from={{ scale: 1.8, x: -40, y: -400 }} to={{ scale: 1.9, x: -40, y: -400 }} />
    </div>
    <div style={{ position: 'absolute', right: 100, top: 300 }}>
      <Screen src="shots/payslip.png" url="uselute.xyz/payslip/…" start={s(1.2)} dur={s(6)} width={860} from={{ scale: 1.8, x: 0, y: 0 }} to={{ scale: 1.95, x: 0, y: 0 }} />
    </div>
    <Tag kind="mainnet" text="E-020 · tx 26c815f9…a9be · payslip Paid and signed" start={s(1.5)} style={{ position: 'absolute', right: 100, top: 210 }} />
  </AbsoluteFill>
);
