import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { marked, type Tokens } from 'marked';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Documentation, rendered at build time from the repository's own markdown (docs/*.md), so the site
 * and the repo never disagree.
 */
const DOCS: Record<string, { file: string; title: string }> = {
  '': { file: 'USER-GUIDE.md', title: 'User guide' },
  'private-apis': { file: 'PRIVATE-PAID-APIS.md', title: 'Private paid APIs' },
};

export const dynamic = 'force-static';

export function generateStaticParams() {
  return Object.keys(DOCS).map((k) => ({ slug: k ? [k] : [] }));
}

const decode = (t: string) =>
  t
    .replace(/<[^>]+>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

const slugify = (t: string) =>
  t
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function load(key: string) {
  const md = readFileSync(join(process.cwd(), '..', '..', 'docs', DOCS[key]!.file), 'utf8')
    .replaceAll('(PRIVATE-PAID-APIS.md)', '(/docs/private-apis)')
    .replaceAll('(USER-GUIDE.md)', '(/docs)');
  const toc: { id: string; text: string }[] = [];
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }: Tokens.Heading) {
    const text = this.parser.parseInline(tokens);
    const id = slugify(decode(text));
    if (depth === 2) toc.push({ id, text: decode(text) });
    return `<h${depth} id="${id}">${text}</h${depth}>`;
  };
  const html = marked.parse(md, { renderer, async: false }) as string;
  return { html, toc };
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const key = slug?.[0] ?? '';
  if (!(key in DOCS) || (slug?.length ?? 0) > 1) notFound();
  const { html, toc } = load(key);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/welcome" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-display text-[1.05em] text-on-accent">L</span>
            <span className="font-display text-lg tracking-tight">Lute</span>
          </Link>
          <span className="hidden text-sm text-muted sm:inline">Documentation</span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/signup" className="whitespace-nowrap rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90">
              Get started
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-10 md:grid-cols-[14rem_1fr]">
        <aside className="md:sticky md:top-24 md:self-start">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Guides</p>
          <nav className="mb-2 flex gap-4 text-sm md:mb-6 md:flex-col md:gap-1">
            {Object.entries(DOCS).map(([k, d]) => (
              <Link key={k} href={k ? `/docs/${k}` : '/docs'} className={k === key ? 'font-medium' : 'text-muted hover:text-text'}>
                {d.title}
              </Link>
            ))}
          </nav>
          <p className="mb-2 hidden text-[11px] font-medium uppercase tracking-[0.18em] text-muted md:block">On this page</p>
          <nav className="hidden flex-col gap-1 text-sm md:flex">
            {toc.map((t) => (
              <a key={t.id} href={`#${t.id}`} className="text-muted hover:text-text">
                {t.text}
              </a>
            ))}
          </nav>
        </aside>
        <article className="doc min-w-0" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
