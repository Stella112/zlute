import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, mono, sans, serif } from './theme';

export const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** 0→1 over [start, start+dur] with a premium ease. */
export const useProgress = (start: number, dur: number) => {
  const f = useCurrentFrame();
  return interpolate(f, [start, start + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
};

export const FontFaces: React.FC = () => (
  <style>{`
    @font-face { font-family: 'Cormorant'; src: url('${staticFile('fonts/cormorant.woff2')}') format('woff2'); font-weight: 300 700; }
    @font-face { font-family: 'Inter'; src: url('${staticFile('fonts/inter.woff2')}') format('woff2'); font-weight: 100 900; }
  `}</style>
);

/** Dark background with Lute's faint grid and a slow teal glow. */
export const Backdrop: React.FC<{ glow?: [number, number] }> = ({ glow = [70, 30] }) => {
  const f = useCurrentFrame();
  const drift = Math.sin(f / 90) * 4;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at 50% 40%, black 30%, transparent 80%)',
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${glow[0] + drift}% ${glow[1]}%, rgba(79,179,163,0.16), transparent 45%)` }} />
    </AbsoluteFill>
  );
};

/** Real product screenshot in a browser frame, with a slow camera move. */
export const Screen: React.FC<{
  src: string;
  url: string;
  start: number;
  dur: number;
  width?: number;
  from?: { scale: number; x: number; y: number };
  to?: { scale: number; x: number; y: number };
  style?: React.CSSProperties;
}> = ({ src, url, start, dur, width = 1440, from = { scale: 1, x: 0, y: 0 }, to = { scale: 1.06, x: 0, y: 0 }, style }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f - start, fps, config: { damping: 200 }, durationInFrames: 24 });
  const t = interpolate(f, [start, start + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const sc = from.scale + (to.scale - from.scale) * t;
  const h = (width * 1080) / 1920;
  // Never pan past the screenshot's edges (no empty space in the frame).
  const mx = (width / 2) * (1 - 1 / sc);
  const my = (h / 2) * (1 - 1 / sc);
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  const x = clamp(from.x + (to.x - from.x) * t, mx);
  const y = clamp(from.y + (to.y - from.y) * t, my);
  return (
    <div
      style={{
        width,
        borderRadius: 18,
        overflow: 'hidden',
        border: `1px solid ${C.line}`,
        boxShadow: '0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)',
        background: C.surface,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 40}px)`,
        ...style,
      }}
    >
      <div style={{ height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', background: C.raised, borderBottom: `1px solid ${C.line}` }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 11, height: 11, borderRadius: 6, background: c, opacity: 0.8 }} />
        ))}
        <span style={{ marginLeft: 16, flex: 1, height: 24, borderRadius: 8, background: C.bg, color: C.muted, fontFamily: sans, fontSize: 13, display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
          🔒 {url}
        </span>
      </div>
      <div style={{ width, height: h, overflow: 'hidden' }}>
        <Img src={staticFile(src)} style={{ width, height: h, transform: `scale(${sc}) translate(${x}px, ${y}px)`, transformOrigin: 'center center' }} />
      </div>
    </div>
  );
};

export type TagKind = 'mainnet' | 'regtest' | 'live' | 'diagram' | 'ci';
const TAG: Record<TagKind, [string, string]> = {
  mainnet: ['MAINNET', C.ok],
  regtest: ['REGTEST', C.warn],
  live: ['LIVE PRODUCT', C.accent],
  diagram: ['DIAGRAM', C.silver],
  ci: ['TESTS', C.accent],
};

/** Evidence label: what kind of proof the viewer is looking at. */
export const Tag: React.FC<{ kind: TagKind; text: string; start: number; style?: React.CSSProperties }> = ({ kind, text, start, style }) => {
  const p = useProgress(start, 18);
  const [label, color] = TAG[kind];
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 18px',
        borderRadius: 999,
        background: 'rgba(17,17,18,0.92)',
        border: `1px solid ${color}55`,
        fontFamily: sans,
        fontSize: 20,
        color: C.text,
        opacity: p,
        transform: `translateY(${(1 - p) * 12}px)`,
        backdropFilter: 'blur(6px)',
        ...style,
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 5, background: color, boxShadow: `0 0 12px ${color}` }} />
      <span style={{ color, fontWeight: 700, letterSpacing: '0.12em', fontSize: 15 }}>{label}</span>
      <span style={{ color: C.text }}>{text}</span>
    </div>
  );
};

/** Masked kinetic headline. */
export const Headline: React.FC<{ text: string; start: number; size?: number; italic?: boolean; color?: string; style?: React.CSSProperties }> = ({ text, start, size = 84, italic, color = C.text, style }) => {
  const p = useProgress(start, 26);
  return (
    <div style={{ overflow: 'hidden', ...style }}>
      <div style={{ fontFamily: serif, fontSize: size, lineHeight: 1.05, color, fontStyle: italic ? 'italic' : 'normal', fontWeight: 500, transform: `translateY(${(1 - p) * 110}%)`, opacity: p }}>{text}</div>
    </div>
  );
};

export const Eyebrow: React.FC<{ text: string; start: number; style?: React.CSSProperties }> = ({ text, start, style }) => {
  const p = useProgress(start, 20);
  return (
    <div style={{ fontFamily: sans, fontSize: 18, letterSpacing: '0.32em', color: C.accent, fontWeight: 600, opacity: p, transform: `translateX(${(1 - p) * -20}px)`, ...style }}>{text}</div>
  );
};

export const Body: React.FC<{ text: string; start: number; style?: React.CSSProperties }> = ({ text, start, style }) => {
  const p = useProgress(start, 22);
  return <div style={{ fontFamily: sans, fontSize: 26, lineHeight: 1.45, color: C.muted, opacity: p, transform: `translateY(${(1 - p) * 16}px)`, ...style }}>{text}</div>;
};

/** Lute's mark: the teal tile with the serif L. */
export const Mark: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.22,
      background: C.accent,
      color: '#08110f',
      display: 'grid',
      placeItems: 'center',
      fontFamily: serif,
      fontSize: size * 0.62,
      fontWeight: 600,
      boxShadow: `0 0 ${size * 0.6}px rgba(79,179,163,0.35)`,
      ...style,
    }}
  >
    L
  </div>
);

/** Monospace terminal panel that types out real recorded output. */
export const Terminal: React.FC<{ lines: { text: string; color?: string; at: number }[]; title: string; width: number; height: number; fontSize?: number; style?: React.CSSProperties }> = ({ lines, title, width, height, fontSize = 19, style }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ width, height, borderRadius: 16, background: '#070708', border: `1px solid ${C.line}`, boxShadow: '0 30px 90px rgba(0,0,0,0.55)', overflow: 'hidden', ...style }}>
      <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', background: C.raised, borderBottom: `1px solid ${C.line}` }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 10, height: 10, borderRadius: 5, background: c, opacity: 0.8 }} />
        ))}
        <span style={{ marginLeft: 12, color: C.muted, fontFamily: sans, fontSize: 14 }}>{title}</span>
      </div>
      <div style={{ padding: '18px 22px', fontFamily: mono, fontSize, lineHeight: 1.55 }}>
        {lines.map((l, i) => {
          const n = Math.max(0, Math.min(l.text.length, Math.floor((f - l.at) * 2.4)));
          if (f < l.at) return null;
          return (
            <div key={i} style={{ color: l.color ?? C.text, whiteSpace: 'pre' }}>
              {l.text.slice(0, n)}
              {n < l.text.length && <span style={{ background: C.accent, color: C.accent }}>_</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Lower-third subtitle synced to the narration. */
export const Caption: React.FC<{ text: string; start: number; end: number }> = ({ text, start, end }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [start, start + 8, end - 8, end], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (f < start || f > end) return null;
  return (
    <div style={{ position: 'absolute', bottom: 46, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: o }}>
      <div style={{ maxWidth: 1400, padding: '10px 22px', borderRadius: 12, background: 'rgba(10,10,11,0.78)', color: C.text, fontFamily: sans, fontSize: 28, textAlign: 'center', lineHeight: 1.35 }}>{text}</div>
    </div>
  );
};
