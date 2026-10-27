'use client';

import { useEffect, useState } from 'react';
import { exportBackup, publicKey } from '@/lib/ownerKey';

const flag = (username: string) => `lute.backup.${username}`;

function readFlag(username: string): string | null {
  try {
    return window.localStorage.getItem(flag(username));
  } catch {
    return null;
  }
}

/** Records that this account's key backup was saved (per browser, bound to the key). */
export function markBackedUp(username: string, ownerPub: string) {
  try {
    window.localStorage.setItem(flag(username), ownerPub);
  } catch {
    /* storage blocked: the gate shows again next time, which is safe */
  }
}

export async function downloadBackup(username: string, ownerPub: string) {
  const json = await exportBackup(username);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `lute-key-${username}.json`;
  a.click();
  URL.revokeObjectURL(url);
  markBackedUp(username, ownerPub);
}

/**
 * Before any money goes into a Lute wallet (receive, fund an agent), a self-serve account must have
 * saved its approval-key backup and read what it does and does not recover. Owner accounts (key on the
 * owner's laptop) pass through.
 */
export function BackupGate({ me, children }: { me: { username: string; self_serve?: boolean; owner_pub?: string | null; browser_signed?: boolean }; children: React.ReactNode }) {
  const [done, setDone] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const [ack, setAck] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    if (!me.self_serve || !me.owner_pub) return setDone(true);
    setDone(readFlag(me.username) === me.owner_pub);
    void publicKey(me.username)
      .then((k) => setHasKey(k === me.owner_pub))
      .catch(() => setHasKey(false));
  }, [me.self_serve, me.owner_pub, me.username]);

  if (done === null) return null;
  if (done) return <>{children}</>;

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-line bg-surface p-6 text-sm">
      <p className="label-caps">Before you add money</p>
      <h2 className="font-display mt-2 text-3xl leading-tight">{me.browser_signed ? 'Save your wallet backup' : 'Save your approval key'}</h2>
      {me.browser_signed ? (
        <div className="mt-4 space-y-3 leading-relaxed">
          <p>Your wallet&apos;s keys exist only in this browser: Lute holds no key that can move your money, and cannot recover it for you either. Save the backup file before adding money.</p>
          <p className="rounded-xl bg-raised px-4 py-3">
            <b>What the backup recovers:</b> your wallet, on another device or without Lute. It holds your 24-word recovery phrase, which you can also import into Zodl (account 0 is your
            merchant wallet, account 1 your payout wallet).
          </p>
          <p className="text-muted">Anyone with the file can move your money. Store it privately and offline; Lute never receives it.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3 leading-relaxed">
          <p>Payouts from your Lute wallets need the approval key stored in this browser. Save a backup file so you can approve payouts from another device or after clearing this browser.</p>
          <p className="rounded-xl bg-raised px-4 py-3">
            <b>What the backup recovers:</b> your ability to approve payouts on Lute. <b>What it does not:</b> it is not a wallet recovery phrase. Your wallets are held by Lute (custodial); if Lute stops
            operating, this file cannot move the funds. Keep only working balances here.
          </p>
          <p className="text-muted">Anyone with the file can approve payouts from your wallets. Store it privately; Lute never receives it.</p>
        </div>
      )}
      {hasKey === false ? (
        <p className="mt-4 text-warn">This browser does not hold your key. Restore your backup in Settings first.</p>
      ) : (
        <>
          <button
            className="mt-5 w-full rounded-xl bg-accent py-3 font-medium text-on-accent hover:opacity-90"
            onClick={async () => {
              await downloadBackup(me.username, me.owner_pub!);
              setSaved(true);
            }}
          >
            {saved ? 'Downloaded. Download again' : 'Download key backup'}
          </button>
          <label className="mt-4 flex items-start gap-3">
            <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{me.browser_signed ? 'I saved the backup somewhere safe. Without it, a lost browser means lost funds.' : 'I saved the backup somewhere safe, and I understand it is not a wallet recovery phrase.'}</span>
          </label>
          <button
            disabled={!saved || !ack}
            className="mt-4 w-full rounded-xl border border-line py-3 font-medium disabled:opacity-40"
            onClick={() => {
              markBackedUp(me.username, me.owner_pub!);
              setDone(true);
            }}
          >
            Continue
          </button>
        </>
      )}
    </div>
  );
}
