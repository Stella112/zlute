'use client';

import { useEffect, useRef, useState } from 'react';

/** Fades and lifts its children into view the first time they scroll on screen. */
export function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Visible until JavaScript runs (no blank page while loading); only off-screen blocks are hidden to animate in.
  const [seen, setSeen] = useState(true);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setArmed(true);
    setSeen(false);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`${armed ? `reveal ${seen ? 'in' : ''}` : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Illustration: a stream accruing 50 zat per second, shown 60× faster. */
export function StreamTicker() {
  const [zat, setZat] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setZat((z) => (z >= 30000 ? 0 : z + 50)), 1000 / 60);
    return () => clearInterval(t);
  }, []);
  return (
    <div>
      <p className="num font-display text-5xl tabular-nums">
        {(zat / 1e8).toFixed(8)} <span className="text-lg text-muted">ZEC</span>
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-accent" style={{ width: `${(zat / 30000) * 100}%` }} />
      </div>
    </div>
  );
}

export type TermLine = ['call' | 'out' | 'ok' | 'bad', string];

/** Replays a recorded MCP transcript line by line, then loops. */
export function TypedRun({ lines }: { lines: TermLine[] }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((k) => (k > lines.length + 3 ? 0 : k + 1)), 700);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <div className="min-h-[17rem] space-y-1 font-mono text-[12.5px] leading-6">
      {lines.slice(0, n).map(([kind, text], i) => (
        <p key={i} className={kind === 'call' ? 'text-accent' : kind === 'ok' ? 'pl-4 text-ok' : kind === 'bad' ? 'pl-4 text-bad' : 'pl-4 text-muted'}>
          {kind === 'call' ? '> ' : ''}
          {text}
        </p>
      ))}
      {n <= lines.length && <span className="inline-block h-4 w-2 animate-pulse bg-accent align-middle" />}
    </div>
  );
}
