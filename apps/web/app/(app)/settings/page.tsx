'use client';

import { useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { importBackup, publicKey } from '@/lib/ownerKey';
import { downloadBackup } from '@/components/BackupGate';
import { Button, Card, ErrorNote, PageTitle } from '@/components/ui';
import { short } from '@/lib/format';

export default function SettingsPage() {
  const me = useMe()!;
  const [local, setLocal] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void publicKey(me.username).then(setLocal).catch(() => setLocal(null));
  }, [me.username]);

  return (
    <>
      <PageTitle title="Settings" />
      <Card title="Approval key" className="mb-6">
        {!me.self_serve ? (
          <p className="text-sm text-muted">This account approves payments with the install owner key (lute-owner on the owner&apos;s laptop).</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              Registered key: <span className="font-mono text-xs">{me.owner_pub ? short(me.owner_pub, 10) : '—'}</span>
            </p>
            <p>
              In this browser:{' '}
              {local === undefined ? 'checking…' : local === null ? <span className="text-warn">no key: restore your backup to approve payments here.</span> : local === me.owner_pub ? <span className="text-ok">present and matching.</span> : <span className="text-bad">a different key (not this account&apos;s).</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {local === me.owner_pub && (
                <Button
                  variant="ghost"
                  onClick={() => void downloadBackup(me.username, me.owner_pub!)}
                >
                  Download key backup
                </Button>
              )}
              <label className="cursor-pointer rounded-lg border border-line px-3.5 py-2 text-sm hover:bg-raised">
                Restore from backup
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={async (e) => {
                    setError(null);
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      await importBackup(me.username, await f.text(), me.owner_pub);
                      setLocal(await publicKey(me.username));
                      setNote('Key restored in this browser.');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Restore failed');
                    }
                  }}
                />
              </label>
            </div>
            <ErrorNote error={error} />
            {note && <p className="text-ok">{note}</p>}
            <p className="text-xs text-muted">The backup file can approve payouts from your wallets. Keep it private; Lute never receives it. It is not a wallet recovery phrase: it restores approvals on Lute, not the funds.</p>
          </div>
        )}
      </Card>
      <Card title="Custody">
        {me.browser_signed ? (
          <p className="text-sm text-muted">
            Non-custodial. Your merchant and payout wallets are signed in this browser: Lute holds only viewing keys, so it can show your payments but holds no key that can move your money. Your backup file
            holds the 24-word recovery phrase, which restores the wallets on another device or in Zodl. The AI-agent wallet, if you fund one, is the exception: Lute holds it so an agent can
            pay inside the budget you sign, so keep only a small budget there.
          </p>
        ) : (
        <p className="text-sm text-muted">
          Lute is custodial. Your Lute wallets (merchant, payout, agent) are hot wallets on the operator&apos;s server, each with its own sealed seed. Lute&apos;s software pays out only with
          your approval key or an agent budget you signed; whoever operates the server could bypass that, and there is no wallet recovery phrase yet. Keep working balances only. Payers always pay
          from their own wallets.
        </p>
        )}
      </Card>
    </>
  );
}
