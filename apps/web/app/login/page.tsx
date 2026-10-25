'use client';

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
      className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-6"
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
          <p className="text-xs text-muted">Private payments on Zcash</p>
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
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
