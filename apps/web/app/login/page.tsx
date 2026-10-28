'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { Button, ErrorNote, Field, inputCls } from '@/components/ui';
import { ThemeToggle } from '@/components/ThemeToggle';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-xl shadow-black/5"
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
        <div>
          <p className="font-display text-[2rem] leading-tight">Welcome back</p>
          <p className="mt-1 text-sm text-muted">Sign in to your Lute account</p>
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

export default function LoginPage() {
  return (
    <div className="bg-grid flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/welcome" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg logo-tile text-sm font-display text-[1.05em] ">L</span>
          <span className="font-display text-xl">Lute</span>
        </Link>
        <ThemeToggle />
      </header>
      <div className="grid flex-1 place-items-center px-4 pb-16">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
