'use client';

import { useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { exportBackup, importBackup, publicKey } from '@/lib/ownerKey';
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
                  onClick={async () => {
                    const json = await exportBackup(me.username);
                    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `lute-key-${me.username}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
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
            <p className="text-xs text-muted">The backup file can approve payments from your wallets. Keep it private. Lute never receives it.</p>
          </div>
        )}
      </Card>
      <Card title="Custody">
        <p className="text-sm text-muted">
          Your Lute wallets (merchant, payout, agent) are hot wallets on the operator&apos;s server, each with its own sealed seed. Payments out of them need your approval key, or an agent
          mandate you signed. Payers always pay from their own wallets.
        </p>
      </Card>
    </>
  );
}
