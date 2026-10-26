'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { Button, ErrorNote, Field, inputCls } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="w-full max-w-sm space-y-4 rounded-3xl border border-line bg-surface p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await post('/v1/auth/login', { username, password });
          // Only same-site relative paths (no open redirect).
          router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
        } catch (err) {
          setError(err instanceof ApiError && err.code === 'INVALID_CREDENTIALS' ? 'Wrong username or password.' : 'Sign-in failed.');
        } finally {
          setPassword('');
          setBusy(false);
        }
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-accent font-bold">L</span>
        <div>
          <p className="font-semibold">Lute</p>
          <p className="text-xs text-muted">Welcome back</p>
        </div>
      </div>
      <Field label="Username">
        <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
      </Field>
      <Field label="Password">
        <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </Field>
      <ErrorNote error={error} />
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> New to Lute? <span className="h-px flex-1 bg-line" />
      </div>
      <Link href="/signup" className="block w-full rounded-xl border border-line py-2.5 text-center text-sm font-medium hover:border-accent hover:bg-raised">
        Create a free account
      </Link>
    </form>
  );
}

const POINTS: [string, string][] = [
  ['Get paid privately', 'Share a link or QR. Your customer pays from Zodl or any Zcash wallet; nobody else can see who paid whom, or how much.'],
  ['Sell, bill, split, stream', 'Checkout with receipts, monthly subscriptions, split bills, and pay-by-the-second streams.'],
  ['Nothing leaves without you', 'Every payment is checked for privacy and approved with a key only you hold. Even AI agents only spend inside a budget you sign.'],
];

export default function LoginPage() {
  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-4 py-10 md:grid-cols-[1.1fr_1fr]">
      <section>
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-bold">L</span>
          <span className="text-xl font-semibold tracking-tight">Lute</span>
        </div>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">Private payments, as easy as a link.</h1>
        <p className="mt-3 text-muted">Built on Zcash shielded payments. Live on mainnet.</p>
        <ul className="mt-8 space-y-5">
          {POINTS.map(([t, d]) => (
            <li key={t} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
              <span>
                <span className="block font-medium">{t}</span>
                <span className="block text-sm text-muted">{d}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <div className="grid place-items-center">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
