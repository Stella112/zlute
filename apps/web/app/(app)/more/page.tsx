'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NAV_GROUPS, signOut, useMe } from '@/components/AppShell';
import { Icon } from '@/components/icons';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function More() {
  const me = useMe()!;
  const router = useRouter();
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">More</h1>
        <ThemeToggle withLabel />
      </div>
      {NAV_GROUPS.slice(1).map((g) => (
        <section key={g.title} className="mb-6">
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted">{g.title}</p>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {g.items.map((n) => (
              <Link key={n.href} href={n.href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-raised">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-raised text-accent">
                  <Icon name={n.icon} className="h-[18px] w-[18px]" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm">{n.label}</span>
                  {n.hint && <span className="block text-xs text-muted">{n.hint}</span>}
                </span>
                <Icon name="chevron" className="h-4 w-4 text-muted" />
              </Link>
            ))}
          </div>
        </section>
      ))}
      <button onClick={() => signOut(router)} className="w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-left text-sm text-bad hover:bg-raised">
        Sign out <span className="text-muted">({me.username})</span>
      </button>
    </>
  );
}
