import type { Metadata } from 'next';
import { resolveShareLink } from '@/lib/db/grant-queries';
import { getDbPatternById, getDesignArtifactById } from '@/lib/db/queries';

/**
 * PUBLIC share viewer (Phase B). The unguessable token in the URL is the
 * capability — there is NO auth. This is the human-friendly counterpart to the
 * JSON endpoint at /api/handoff/share/[token]; it resolves the same token and
 * renders the SAME safe subset of fields (see that route for the contract).
 *
 * Standalone by design: no Header/nav, no owner/user ids, no source images or
 * conversation history — only the presentational, shareable fields.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ token: string }> };

const BASE = process.env.NEXT_PUBLIC_HANDOFF_APP_BASE_PATH ?? '';

/** Prefix the app base path only for root-relative URLs; leave data:/blob:/http(s)/protocol-relative as-is. */
function withBase(url: string): string {
  if (!url) return url;
  if (/^(data:|blob:|https?:|\/\/)/i.test(url)) return url;
  if (url.startsWith('/')) return `${BASE}${url}`;
  return url;
}

// ---- Safe subsets (mirror app/api/handoff/share/[token]/route.ts exactly) ----

type SafeArtifact = {
  id: string;
  title: string;
  description: string;
  status: string;
  imageUrl: string;
  assets: unknown;
  assetsStatus: unknown;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
};

type SafePattern = {
  id: string;
  title: string;
  description: string | null;
  group: string | null;
  tags: unknown;
  components: unknown;
  data: unknown;
  thumbnail: string | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
};

type AssetItem = { label: string; imageUrl: string; prompt?: string };

function asAssetItems(value: unknown): AssetItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      label: typeof a.label === 'string' ? a.label : '',
      imageUrl: typeof a.imageUrl === 'string' ? a.imageUrl : '',
      prompt: typeof a.prompt === 'string' ? a.prompt : undefined,
    }));
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === 'string');
}

function componentCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

export const metadata: Metadata = {
  title: 'Shared via Handoff',
  description: 'A resource shared from Handoff.',
  robots: { index: false, follow: false },
};

export default async function PublicSharePage({ params }: PageProps) {
  const { token } = await params;
  const link = await resolveShareLink((token ?? '').trim());
  if (!link) return <Unavailable />;

  if (link.resourceType === 'design_artifact') {
    const row = await getDesignArtifactById(link.resourceId);
    if (!row) return <Unavailable />;
    const artifact: SafeArtifact = {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      imageUrl: row.imageUrl,
      assets: row.assets,
      assetsStatus: row.assetsStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    return (
      <Shell>
        <ArtifactView artifact={artifact} />
      </Shell>
    );
  }

  if (link.resourceType === 'pattern') {
    const row = await getDbPatternById(link.resourceId);
    if (!row) return <Unavailable />;
    const pattern: SafePattern = {
      id: row.id,
      title: row.title,
      description: row.description,
      group: row.group,
      tags: row.tags,
      components: row.components,
      data: row.data,
      thumbnail: row.thumbnail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    return (
      <Shell>
        <PatternView pattern={pattern} />
      </Shell>
    );
  }

  // Unknown/unsupported resource type — treat as unavailable rather than 404
  // so the viewer still gets the friendly message.
  return <Unavailable />;
}

// -------------------------------- Views --------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">{children}</main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-4xl px-4 pb-10">
      <div className="mt-6 flex items-center justify-center gap-2 border-t pt-6 text-xs text-muted-foreground">
        <span>Shared via</span>
        <span className="font-semibold tracking-tight text-foreground">Handoff</span>
      </div>
    </footer>
  );
}

function ArtifactView({ artifact }: { artifact: SafeArtifact }) {
  const assets = asAssetItems(artifact.assets);
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{artifact.title || 'Shared design'}</h1>
        {artifact.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{artifact.description}</p>
        ) : null}
      </header>

      <div className="overflow-hidden rounded-xl border bg-muted/20">
        {artifact.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={withBase(artifact.imageUrl)}
            alt={artifact.title || 'Design'}
            className="mx-auto max-h-[min(85vh,1200px)] w-full object-contain"
          />
        ) : (
          <p className="p-10 text-center text-sm text-muted-foreground">No preview image.</p>
        )}
      </div>

      {assets.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assets</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {assets.map((a, i) => (
              <figure key={`${a.label}-${i}`} className="overflow-hidden rounded-lg border bg-card">
                {a.label ? <figcaption className="border-b px-3 py-2 text-xs font-medium">{a.label}</figcaption> : null}
                <div className="bg-muted/30 p-2">
                  {a.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={withBase(a.imageUrl)} alt={a.label || 'Asset'} className="mx-auto max-h-64 w-full object-contain" />
                  ) : (
                    <p className="p-6 text-center text-xs text-muted-foreground">No image.</p>
                  )}
                </div>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PatternView({ pattern }: { pattern: SafePattern }) {
  const tags = asTags(pattern.tags);
  const count = componentCount(pattern.components);
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        {pattern.group ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{pattern.group}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{pattern.title || 'Shared pattern'}</h1>
        {pattern.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{pattern.description}</p>
        ) : null}
      </header>

      {pattern.thumbnail ? (
        <div className="overflow-hidden rounded-xl border bg-muted/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={withBase(pattern.thumbnail)}
            alt={pattern.title || 'Pattern'}
            className="mx-auto max-h-[min(70vh,900px)] w-full object-contain"
          />
        </div>
      ) : null}

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Components / blocks</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{count}</dd>
          </div>
          {pattern.group ? (
            <div>
              <dt className="text-xs text-muted-foreground">Group</dt>
              <dd className="mt-0.5 text-sm font-medium">{pattern.group}</dd>
            </div>
          ) : null}
        </dl>

        {tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {tags.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="inline-flex items-center rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-lg font-semibold">This link is no longer available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The share link may have expired, been turned off, or never existed.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>Shared via</span>
          <span className="font-semibold tracking-tight text-foreground">Handoff</span>
        </div>
      </div>
    </div>
  );
}
