import { Card, PageTitle } from '@/components/ui';

const NAMES: Record<string, string> = {
  meter: 'Meter',
  subscriptions: 'Subscriptions',
  groups: 'Groups',
  commerce: 'Commerce',
  developers: 'Developers',
};

export default async function Unavailable({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  return (
    <>
      <PageTitle title={NAMES[module] ?? 'Not available'} />
      <Card>
        <p className="text-sm">Not available in this build.</p>
        <p className="mt-2 text-sm text-muted">
          There is no route, SDK method or MCP tool for it, so nothing here can move money. Agent and SDK spends fail closed: this build has no mandates, so LuteGuard denies them.
        </p>
      </Card>
    </>
  );
}

export function generateStaticParams() {
  return Object.keys(NAMES).map((module) => ({ module }));
}
