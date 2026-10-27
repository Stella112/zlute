'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { createKey, createWalletPhrase, exportBackup, keySupported, walletSeedHex } from '@/lib/ownerKey';
import { deriveUfvks } from '@/lib/signer';
import { Button, ErrorNote, Field, inputCls } from '@/components/ui';
import { ThemeToggle } from '@/components/ThemeToggle';

const ERRORS: Record<string, string> = {
  USERNAME_TAKEN: 'That username is taken.',
  SIGNUPS_CLOSED: 'New accounts are paused right now. Please try again later.',
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<string | null>(null);

  if (backup) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-surface p-6 text-sm">
          <p className="text-lg font-semibold">Your account is ready.</p>
          <p>
            Your wallet was created <b>in this browser</b>: its recovery phrase and approval key never leave it, and Lute holds only the keys needed to show your payments. Every payout is
            signed here. Download your backup now: it holds the recovery phrase, which restores your wallets on another device or in Zodl, even without Lute. Anyone with this file can move
            your money, so keep it private. You will be asked to confirm the backup before adding money.
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
    <div className="bg-grid flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/welcome" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-display text-[1.05em] text-on-accent">L</span>
          <span className="font-display text-xl">Lute</span>
        </Link>
        <ThemeToggle />
      </header>
      <div className="grid flex-1 place-items-center px-4 pb-16">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-xl shadow-black/5"
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
            // Non-custodial: the wallet's recovery phrase is created here and never leaves this
            // browser; Lute receives only the viewing keys derived from it.
            const { network } = await get<{ network: string }>('/v1/health');
            await createWalletPhrase(u).catch(() => undefined);
            const ufvks = await deriveUfvks(await walletSeedHex(u), network);
            await post('/v1/auth/signup', { username: u, password, owner_pub: pub, ufvks });
            setBackup(await exportBackup(u));
          } catch (err) {
            setError(err instanceof ApiError ? (ERRORS[err.code] ?? err.code) : err instanceof Error ? err.message : 'Sign-up failed.');
          } finally {
            setPassword('');
            setBusy(false);
          }
        }}
      >
        <div>
          <p className="font-display text-[2rem] leading-tight">Create your account</p>
          <p className="mt-1 text-sm text-muted">Private payments on Zcash mainnet</p>
        </div>
        <Field label="Username" hint="3 to 32 lowercase letters, digits or _">
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password" hint="At least 12 characters">
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creating your wallets…' : 'Create account'}
        </Button>
        <p className="text-xs leading-relaxed text-muted">
          Your wallet is created in this browser, and only this browser can sign a payment: Lute holds no key that can move your money. Hosted Lute can see the payment activity it needs to operate. An AI-agent budget, if you set one up, is held by Lute and capped. Limits: 0.02 ZEC per payment, 0.05 ZEC per day.
        </p>
        <p className="text-center text-xs text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </form>
      </div>
    </div>
  );
}
