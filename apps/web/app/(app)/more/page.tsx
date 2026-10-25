'use client';

import Link from 'next/link';
import { MORE_LINKS } from '@/components/AppShell';
import { Card, PageTitle } from '@/components/ui';

export default function More() {
  return (
    <>
      <PageTitle title="More" />
      <Card>
        <ul className="divide-y divide-line">
          {MORE_LINKS.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="flex justify-between py-3 text-sm hover:text-accent">
                {n.label}
                {n.off && <span className="text-xs text-muted">not available</span>}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
