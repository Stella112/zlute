'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { ApiError, get, post, type Me } from '@/lib/api';

const NAV: { href: string; label: string; off?: boolean }[] = [
  { href: '/', label: 'Overview' },
  { href: '/send', label: 'Send' },
  { href: '/receive', label: 'Receive' },
  { href: '/requests', label: 'Requests' },
  { href: '/streams', label: 'Streams' },
  { href: '/agents', label: 'Agents and Meter' },
  { href: '/unavailable/subscriptions', label: 'Subscriptions', off: true },
  { href: '/unavailable/groups', label: 'Groups', off: true },
  { href: '/unavailable/commerce', label: 'Commerce', off: true },
  { href: '/activity', label: 'Actions' },
  { href: '/cross-chain', label: 'Cross-Chain' },
  { href: '/privacy', label: 'Privacy Center' },
];

const MOBILE = [
  { href: '/', label: 'Home' },
  { href: '/send', label: 'Send' },
  { href: '/receive', label: 'Receive' },
  { href: '/activity', label: 'Activity' },
  { href: '/more', label: 'More' },
];

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    get<Me>('/v1/me')
      .then(setMe)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) router.replace(`/login?next=${encodeURIComponent(path)}`);
      });
  }, [path, router]);

  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  if (!me) return <div className="grid min-h-screen place-items-center text-sm text-muted">Loading…</div>;

  return (
    <MeCtx.Provider value={me}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface/60 px-3 py-5 md:flex">
          <div className="mb-6 flex items-center gap-2 px-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold">L</span>
            <span className="font-semibold tracking-tight">Lute</span>
            <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${me.network === 'main' ? 'border-accent/50 text-accent' : 'border-line text-muted'}`}>
              {me.network === 'main' ? 'mainnet' : me.network}
            </span>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${active(n.href) ? 'bg-accent-soft text-text' : 'text-muted hover:bg-raised hover:text-text'}`}
              >
                {n.label}
                {n.off && <span className="text-[10px] text-muted/70">off</span>}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex items-center justify-between border-t border-line px-2 pt-4 text-xs text-muted">
            <span>{me.username}</span>
            <button
              className="hover:text-text"
              onClick={async () => {
                await post('/v1/auth/logout').catch(() => undefined);
                router.replace('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 pb-24 pt-6 md:px-10 md:pb-10">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface md:hidden">
          {MOBILE.map((n) => (
            <Link key={n.href} href={n.href} className={`flex-1 py-3 text-center text-xs ${active(n.href) ? 'text-accent' : 'text-muted'}`}>
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </MeCtx.Provider>
  );
}

export const MORE_LINKS = NAV.filter((n) => !MOBILE.some((m) => m.href === n.href));
