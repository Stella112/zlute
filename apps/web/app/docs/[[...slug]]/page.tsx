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
  custody: { file: 'CUSTODY.md', title: 'Custody' },
  evidence: { file: 'PRIVACY-EVIDENCE.md', title: 'Evidence' },
};

export const REPO = 'https://github.com/Stella112/zlute';
const BLOB = `${REPO}/blob/main`;

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

/** Splits a markdown table row on `|`, ignoring escaped pipes and pipes inside code spans. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (c === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '`') {
      code = !code;
      cur += c;
    } else if (c === '|' && !code) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out.slice(1, -1);
}

/** Repository paths become links to the file on GitHub; mainnet txids link to a block explorer. */
function linkify(html: string, mainnet: boolean): string {
  let h = html.replace(/(?<![\w/.-])((?:evidence|docs|infrastructure|apps|services|tools|packages)\/[\w./-]+[\w/])/g, (m) => `<a href="${BLOB}/${m}">${m}</a>`);
  if (mainnet) h = h.replace(/(?<![\w/])([0-9a-f]{64})(?![\w])/g, (t) => `<a href="https://blockchair.com/zcash/transaction/${t}">${t}</a>`);
  return h;
}

/** The evidence register is one wide table in the repo; on the site each row is a card with an anchor (#e-011). */
function evidence(md: string) {
  const lines = md.split('\n');
  const head = lines.findIndex((l) => l.startsWith('| # |'));
  const cols = cells(lines[head]!);
  const intro = marked.parse(lines.slice(0, head).join('\n'), { async: false }) as string;
  const rows = lines
    .slice(head + 2)
    .filter((l) => l.startsWith('| E-'))
    .map((l) => Object.fromEntries(cells(l).map((v, i) => [cols[i] ?? `c${i}`, v])) as Record<string, string>)
    .sort((a, b) => a['#']!.localeCompare(b['#']!));
  const inline = (t: string | undefined, mainnet: boolean) => linkify(marked.parseInline(t ?? '', { async: false }) as string, mainnet);
  const FIELDS = ['Expected', 'Actual', 'Artifact', 'Command', 'Commit', 'Residual limits', 'Test', 'Threat-model ref', 'Reviewer'];
  const toc = rows.map((r) => ({ id: r['#']!.toLowerCase(), text: r['#']! }));
  const html =
    intro +
    rows
      .map((r) => {
        const main = /mainnet/i.test(r['Env'] ?? '');
        return `<section class="evidence-card" id="${r['#']!.toLowerCase()}">
  <p class="evidence-meta"><a href="#${r['#']!.toLowerCase()}">${r['#']}</a><span class="${main ? 'env-main' : 'env'}">${inline(r['Env'], false)}</span></p>
  <h3>${inline(r['Claim'], main)}</h3>
  <dl>${FIELDS.filter((f) => r[f])
    .map((f) => `<dt>${f}</dt><dd>${inline(r[f], main)}</dd>`)
    .join('')}</dl>
</section>`;
      })
      .join('\n');
  return { html, toc };
}

function load(key: string) {
  const raw = readFileSync(join(process.cwd(), '..', '..', 'docs', DOCS[key]!.file), 'utf8');
  if (key === 'evidence') return evidence(raw);
  const md = raw
    .replaceAll('(PRIVATE-PAID-APIS.md)', '(/docs/private-apis)')
    .replaceAll('(USER-GUIDE.md)', '(/docs)')
    .replaceAll('(CUSTODY.md)', '(/docs/custody)')
    .replaceAll('(docs/CUSTODY.md)', '(/docs/custody)')
    .replaceAll('(https://github.com/Stella112/zlute/blob/main/docs/CUSTODY.md)', '(/docs/custody)');
  const toc: { id: string; text: string }[] = [];
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }: Tokens.Heading) {
    const text = this.parser.parseInline(tokens);
    const id = slugify(decode(text));
    if (depth === 2) toc.push({ id, text: decode(text) });
    return `<h${depth} id="${id}">${text}</h${depth}>`;
  };
  // E-xxx references point at the evidence cards.
  const html = (marked.parse(md, { renderer, async: false }) as string).replace(/(?<![\w#/-])E-(0\d\d)(?![\w-])/g, '<a href="/docs/evidence#e-$1">E-$1</a>');
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
            <a href={REPO} className="hidden rounded-lg px-3 py-2 text-sm text-muted hover:text-text sm:inline-block">
              Source code
            </a>
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
