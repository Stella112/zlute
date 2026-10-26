'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { createKey, exportBackup, keySupported } from '@/lib/ownerKey';
import { Button, ErrorNote, Field, inputCls } from '@/components/ui';

const ERRORS: Record<string, string> = {
  USERNAME_TAKEN: 'That username is taken.',
  SIGNUPS_CLOSED: 'This demo has reached its account limit.',
  RATE_LIMITED: 'Too many attempts. Try again in a minute.',
  WALLET_CREATION_FAILED: 'Could not create your wallets right now. Try again shortly.',
  SIGNUP_DISABLED: 'Sign-up is not enabled on this server.',
  BAD_REQUEST: 'Username: 3 to 32 lowercase letters, digits or _. Password: at least 12 characters.',
};

/**
 * Sign-up: the browser creates the account's approval key (Ed25519, kept in this browser); only
 * the public key is sent. Lute then creates this account's own wallets bound to that key.
 */
export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<string | null>(null);

  if (backup) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-surface p-6 text-sm">
          <p className="text-lg font-semibold">Your account is ready.</p>
          <p>
            Your approval key was created <b>in this browser</b>. Every payment out of your wallets needs it. Download a backup now: if you clear this browser&apos;s data or use another device,
            you restore it in Settings. Anyone with this file can approve payments from your wallets, so keep it private.
          </p>
          <Button
            onClick={() => {
              const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `lute-key-${username}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download key backup
          </Button>
          <Button variant="ghost" className="ml-2" onClick={() => router.replace('/')}>
            Go to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (!keySupported()) throw new Error('This browser cannot create Ed25519 keys. Use a current Chrome, Edge, Firefox or Safari.');
            const u = username.trim().toLowerCase();
            const pub = await createKey(u).catch(async (err: unknown) => {
              if (err instanceof Error && err.message === 'KEY_EXISTS') throw new Error('This browser already holds a key for that username.');
              throw new Error('This browser cannot create Ed25519 keys. Use a current Chrome, Edge, Firefox or Safari.');
            });
            await post('/v1/auth/signup', { username: u, password, owner_pub: pub });
            setBackup(await exportBackup(u));
          } catch (err) {
            setError(err instanceof ApiError ? (ERRORS[err.code] ?? err.code) : err instanceof Error ? err.message : 'Sign-up failed.');
          } finally {
            setPassword('');
            setBusy(false);
          }
        }}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-accent font-bold">L</span>
          <div>
            <p className="font-semibold">Create a Lute account</p>
            <p className="text-xs text-muted">Private payments on Zcash mainnet</p>
          </div>
        </div>
        <Field label="Username" hint="3 to 32 lowercase letters, digits or _">
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password" hint="At least 12 characters">
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
        </Field>
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>
            I understand this is a hosted demo: my Lute wallets are hot wallets held on the operator&apos;s server, so I will only use small amounts. My payers only ever use their own wallets.
          </span>
        </label>
        <ErrorNote error={error} />
        <Button type="submit" disabled={busy || !ack} className="w-full">
          {busy ? 'Creating your wallets…' : 'Create account'}
        </Button>
        <p className="text-center text-xs text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
