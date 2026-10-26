'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { ApiError, get, post, type Me } from '@/lib/api';
import { Icon, type IconName } from './icons';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  hint?: string;
}

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Money',
    items: [
      { href: '/', label: 'Home', icon: 'home' },
      { href: '/send', label: 'Pay', icon: 'pay' },
      { href: '/receive', label: 'Request', icon: 'request' },
      { href: '/activity', label: 'Activity', icon: 'activity' },
    ],
  },
  {
    title: 'Business',
    items: [
      { href: '/commerce', label: 'Checkout', icon: 'store', hint: 'Sell with receipts and refunds' },
      { href: '/subscriptions', label: 'Subscriptions', icon: 'repeat', hint: 'Bill every month' },
      { href: '/groups', label: 'Split a bill', icon: 'users', hint: 'Everyone pays their share' },
      { href: '/streams', label: 'Streams', icon: 'stream', hint: 'Pay by the second' },
    ],
  },
  {
    title: 'Advanced',
    items: [
      { href: '/agents', label: 'AI agents', icon: 'agent', hint: 'Let an agent pay within a budget' },
      { href: '/privacy', label: 'Privacy', icon: 'shield', hint: 'What is proven, and what leaks' },
      { href: '/cross-chain', label: 'Cross-chain', icon: 'globe', hint: 'Route classification' },
      { href: '/settings', label: 'Settings', icon: 'settings', hint: 'Your key and backup' },
    ],
  },
];

const MOBILE: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/send', label: 'Pay', icon: 'pay' },
  { href: '/receive', label: 'Request', icon: 'request' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
  { href: '/more', label: 'More', icon: 'more' },
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
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface/60 px-4 py-6 md:flex">
          <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold">L</span>
            <span className="text-lg font-semibold tracking-tight">Lute</span>
          </Link>
          <nav className="flex flex-1 flex-col gap-6 overflow-y-auto">
            {NAV_GROUPS.map((g) => (
              <div key={g.title}>
                <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted/70">{g.title}</p>
                <div className="flex flex-col gap-0.5">
                  {g.items.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${active(n.href) ? 'bg-accent-soft text-text' : 'text-muted hover:bg-raised hover:text-text'}`}
                    >
                      <Icon name={n.icon} className="h-[18px] w-[18px]" />
                      {n.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate">{me.username}</p>
              <p className="text-[11px] text-muted">{me.network === 'main' ? 'Zcash mainnet' : me.network}</p>
            </div>
            <button
              title="Sign out"
              className="text-muted hover:text-text"
              onClick={async () => {
                await post('/v1/auth/logout').catch(() => undefined);
                router.replace('/login');
              }}
            >
              <Icon name="logout" className="h-[18px] w-[18px]" />
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 pb-28 pt-6 md:px-10 md:pb-12 md:pt-10">
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {MOBILE.map((n) => (
            <Link key={n.href} href={n.href} className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${active(n.href) ? 'text-accent' : 'text-muted'}`}>
              <Icon name={n.icon} className="h-[22px] w-[22px]" />
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </MeCtx.Provider>
  );
}

export async function signOut(router: ReturnType<typeof useRouter>) {
  await post('/v1/auth/logout').catch(() => undefined);
  router.replace('/login');
}
