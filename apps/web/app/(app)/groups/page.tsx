'use client';

import { useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { zec, when } from '@/lib/format';
import { Button, Card, Empty, ErrorNote, Field, PageTitle, State, inputCls } from '@/components/ui';

interface Group {
  id: string;
  title: string;
  total_zat: string;
  collected_zat: string;
  paid_members: number;
  members: { idx: number; label: string; share_zat: string; status: string; share_path: string }[];
  created_at: number;
}

export default function GroupsPage() {
  const list = useLoad(() => get<{ groups: Group[] }>('/v1/groups'));
  const [title, setTitle] = useState('Dinner');
  const [total, setTotal] = useState('0.0003');
  const [members, setMembers] = useState('Ada, Bo, Cy');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <>
      <PageTitle title="Groups" sub="Split a bill. Each member gets their own shielded payment link, so members never see each other's payments; you see who has paid." />
      <Card title="New split" className="mb-6">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await post('/v1/groups', { title: title.trim(), total_zec: total.trim(), members: members.split(',').map((m) => m.trim()).filter(Boolean) });
              await list.reload();
            } catch (err) {
              setError(err instanceof ApiError ? err.code : 'Request failed');
            }
          }}
        >
          <Field label="What for">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Total (ZEC)">
            <input className={`${inputCls} num`} value={total} onChange={(e) => setTotal(e.target.value)} required />
          </Field>
          <Field label="Members (comma-separated, 2 to 20)" hint="Shares are exact; any remainder is 1 zat each to the first members.">
            <input className={inputCls} value={members} onChange={(e) => setMembers(e.target.value)} required />
          </Field>
          <Button type="submit">Split</Button>
        </form>
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
      </Card>

      <Card title="Groups">
        {(list.data?.groups ?? []).length === 0 ? (
          <Empty>No groups yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.groups.map((g) => (
              <li key={g.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p>
                      {g.title} <span className="num text-muted">· {zec(g.total_zat)} ZEC</span>
                    </p>
                    <p className="num text-xs text-muted">
                      {g.paid_members}/{g.members.length} paid · collected {zec(g.collected_zat)} · {when(g.created_at)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    disabled={busy === g.id}
                    onClick={async () => {
                      setBusy(g.id);
                      await post(`/v1/groups/${g.id}/refresh`).catch(() => setError('Could not check now.'));
                      await list.reload();
                      setBusy(null);
                    }}
                  >
                    {busy === g.id ? 'Checking…' : 'Check payments'}
                  </Button>
                </div>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {g.members.map((m) => (
                    <li key={m.idx} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-1.5 text-xs">
                      <span>
                        {m.label} <span className="num text-muted">{zec(m.share_zat)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <State s={m.status} />
                        <button
                          className="text-accent hover:underline"
                          onClick={async () => {
                            await navigator.clipboard.writeText(`${window.location.origin}${m.share_path}`);
                            setCopied(`${g.id}-${m.idx}`);
                          }}
                        >
                          {copied === `${g.id}-${m.idx}` ? 'copied' : 'copy link'}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
