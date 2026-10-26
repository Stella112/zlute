'use client';

import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';

function apply(m: Mode) {
  const el = document.documentElement;
  if (m === 'system') delete el.dataset.theme;
  else el.dataset.theme = m;
  try {
    if (m === 'system') localStorage.removeItem('lute-theme');
    else localStorage.setItem('lute-theme', m);
  } catch {
    // Storage blocked (private mode): the choice lasts for this page only.
  }
}

const ICON: Record<Mode, string> = {
  light: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  dark: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  system: 'M4 5h16v11H4zM8 20h8M12 16v4',
};

/** Cycles System → Light → Dark. */
export function ThemeToggle({ className = '', withLabel = false }: { className?: string; withLabel?: boolean }) {
  const [mode, setMode] = useState<Mode>('system');
  useEffect(() => {
    try {
      const t = localStorage.getItem('lute-theme');
      if (t === 'light' || t === 'dark') setMode(t);
    } catch {
      // ignore
    }
  }, []);
  const next: Record<Mode, Mode> = { system: 'light', light: 'dark', dark: 'system' };
  const label = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' }[mode];
  return (
    <button
      type="button"
      title={`${label} (click to change)`}
      aria-label={label}
      onClick={() => {
        const m = next[mode];
        setMode(m);
        apply(m);
      }}
      className={`inline-flex items-center gap-2 rounded-full border border-line px-2.5 py-1.5 text-sm text-muted hover:text-text ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
        <path d={ICON[mode]} />
      </svg>
      {withLabel && <span>{label}</span>}
    </button>
  );
}
