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
type Doc = {
  slug: string;
  title: string;
  file: string;
  part?: string;
  blurb: string;
};

/** The user guide is one file in the repo; on the site each numbered section is its own page. */
const GROUPS: { name: string; docs: Doc[] }[] = [
  {
    name: 'Start here',
    docs: [
      {
        slug: '',
        title: 'Overview',
        file: 'USER-GUIDE.md',
        part: 'intro',
        blurb: 'What Lute is, who needs an account, custody in one paragraph.',
      },
      {
        slug: 'account',
        title: 'Account and keys',
        file: 'USER-GUIDE.md',
        part: '1',
        blurb: 'Sign up, your recovery phrase, backups, how a payment is approved.',
      },
    ],
  },
  {
    name: 'Payments',
    docs: [
      {
        slug: 'getting-paid',
        title: 'Getting paid',
        file: 'USER-GUIDE.md',
        part: '2',
        blurb: 'Payment links, checkout with receipts and private refunds, subscriptions, split bills.',
      },
      {
        slug: 'paying-out',
        title: 'Paying out and streams',
        file: 'USER-GUIDE.md',
        part: '3',
        blurb: 'Send, and pay someone by the second.',
      },
      {
        slug: 'payroll',
        title: 'Payroll and teams',
        file: 'USER-GUIDE.md',
        part: '4',
        blurb: 'BatchPay, private payslips, saved payrolls, admin and operator roles.',
      },
    ],
  },
  {
    name: 'AI agents',
    docs: [
      {
        slug: 'agents',
        title: 'Agents and MCP',
        file: 'USER-GUIDE.md',
        part: '5',
        blurb: 'Mandates, metered APIs, quotes, HTTP 402, MCP setup and the tools.',
      },
      {
        slug: 'private-apis',
        title: 'Private paid APIs',
        file: 'PRIVATE-PAID-APIS.md',
        blurb: 'What stays private when an agent pays for an API, channel by channel.',
      },
    ],
  },
  {
    name: 'Developers',
    docs: [
      {
        slug: 'api',
        title: 'API reference',
        file: 'USER-GUIDE.md',
        part: '6',
        blurb: 'Every endpoint, by area.',
      },
    ],
  },
  {
    name: 'Trust',
    docs: [
      {
        slug: 'custody',
        title: 'Custody',
        file: 'CUSTODY.md',
        blurb: 'Who can spend the money, account by account.',
      },
      {
        slug: 'evidence',
        title: 'Evidence',
        file: 'PRIVACY-EVIDENCE.md',
        blurb: 'Every claim with its mainnet or regtest proof, commands and limits.',
      },
      {
        slug: 'limits',
        title: 'Limits and fees',
        file: 'USER-GUIDE.md',
        part: '7',
        blurb: 'Payment limits, network fees, custody summary.',
      },
      {
        slug: 'troubleshooting',
        title: 'Troubleshooting',
        file: 'USER-GUIDE.md',
        part: '8',
        blurb: 'What an error means and what to do.',
      },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.docs);
const DOCS: Record<string, Doc> = Object.fromEntries(ALL.map((d) => [d.slug, d]));

/** Cuts one numbered "## N." section out of the guide (or the intro before the first one), one heading level up. */
function part(raw: string, which: string): string {
  const lines = raw.split('\n');
  const first = lines.findIndex((l) => l.startsWith('## '));
  if (which === 'intro') {
    const intro = lines
      .slice(lines.findIndex((l) => l.startsWith('# ')) + 1, first)
      .join('\n')
      .replace(/\n---\s*$/, '');
    const list = GROUPS.map(
      (g) =>
        `## ${g.name}\n\n` +
        g.docs
          .filter((d) => d.slug)
          .map((d) => `- [${d.title}](/docs/${d.slug}): ${d.blurb}`)
          .join('\n'),
    ).join('\n\n');
    return `${intro}\n\n${list}\n`;
  }
  const start = lines.findIndex((l) => l.startsWith(`## ${which}. `));
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .replace(/\n---\s*$/, '')
    .replace(/^(#{3,6}) /gm, (_, h: string) => `${h.slice(1)} `);
}

export const REPO = 'https://github.com/Stella112/zlute';
const BLOB = `${REPO}/blob/main`;

export const dynamic = 'force-static';

export function generateStaticParams() {
  return ALL.map((d) => ({ slug: d.slug ? [d.slug] : [] }));
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

/**
 * Repository paths become links to the file on GitHub. Mainnet txids stay plain text, ready to copy:
 * Lute links to no block explorer (opening one tells a third party who is looking at which payment).
 */
function linkify(html: string, _mainnet: boolean): string {
  return html.replace(/(?<![\w/.-])((?:evidence|docs|infrastructure|apps|services|tools|packages)\/[\w./-]+[\w/])/g, (m) => `<a href="${BLOB}/${m}">${m}</a>`);
}

/** The evidence register is one wide table in the repo; on the site each row is a card with an anchor (#e-011). */
function evidence(md: string) {
  const lines = md.split('\n');
  const head = lines.findIndex((l) => l.startsWith('| # |'));
  const cols = cells(lines[head]!);
  const intro = marked.parse(lines.slice(0, head).join('\n'), {
    async: false,
  }) as string;
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
  const doc = DOCS[key]!;
  const raw = readFileSync(join(process.cwd(), '..', '..', 'docs', doc.file), 'utf8');
  if (key === 'evidence') return evidence(raw);
  const md = (
    doc.part
      ? `# ${doc.title}

${part(raw, doc.part)}`
      : raw
  )
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
  const i = ALL.findIndex((d) => d.slug === key);
  const prev = ALL[i - 1];
  const next = ALL[i + 1];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/welcome" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg logo-tile text-sm font-display text-[1.05em] ">L</span>
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
          <nav className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm md:mb-6 md:flex-col md:gap-0">
            {GROUPS.map((g) => (
              <div key={g.name} className="md:mb-4">
                <p className="mb-1 hidden text-[11px] font-medium uppercase tracking-[0.18em] text-muted md:block">{g.name}</p>
                <div className="flex flex-wrap gap-x-4 md:flex-col md:gap-1">
                  {g.docs.map((d) => (
                    <Link key={d.slug} href={d.slug ? `/docs/${d.slug}` : '/docs'} className={d.slug === key ? 'font-medium' : 'text-muted hover:text-text'}>
                      {d.title}
                    </Link>
                  ))}
                </div>
              </div>
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
        <div className="min-w-0">
          <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />
          <nav className="mt-12 flex justify-between gap-4 border-t border-line pt-6 text-sm">
            {prev ? (
              <Link href={prev.slug ? `/docs/${prev.slug}` : '/docs'} className="text-muted hover:text-text">
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={`/docs/${next.slug}`} className="text-muted hover:text-text">
                {next.title} →
              </Link>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}
