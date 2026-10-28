// Lute's own design tokens (apps/web/app/globals.css, dark theme).
export const C = {
  bg: '#0a0a0b',
  surface: '#111112',
  raised: '#18181a',
  line: '#242426',
  muted: '#b5b2aa',
  text: '#f1efe9',
  accent: '#4fb3a3',
  accentDeep: '#146b60',
  ok: '#3ccf8e',
  warn: '#e3b341',
  bad: '#f2555a',
  silver: '#c9c5bc',
};

export const FPS = 30;
export const s = (sec: number) => Math.round(sec * FPS);

export const serif = "'Cormorant', 'Cormorant Garamond', Georgia, serif";
export const sans = "'Inter', ui-sans-serif, system-ui, sans-serif";
export const mono = "ui-monospace, 'Cascadia Mono', Consolas, monospace";
