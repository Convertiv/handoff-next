import { Download, X } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { DisplayLogo } from '../../../components/Foundations/DisplayLogo';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import { buttonVariants } from '../../../components/ui/button';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig, getTokens } from '../../../components/util';
import type { LogoVariant, LogoSet } from '../../../lib/data/types';

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'logo', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

/** Inlines an SVG string as a data: URI for anchor download. */
function svgDownloadHref(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Single logo variant card (new LogoSet path). */
function LogoVariantCard({ variant }: { variant: LogoVariant }) {
  const bg = variant.background ?? (variant.variant === 'reversed' ? '#1a1a1a' : '#ffffff');

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
      {/* SVG preview */}
      <div
        className="flex items-center justify-center p-10"
        style={{ backgroundColor: bg, minHeight: '180px' }}
        dangerouslySetInnerHTML={{ __html: variant.svg }}
      />

      {/* Card footer */}
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{variant.name}</span>
            <div className="flex flex-wrap gap-1">
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {variant.variant}
              </span>
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {variant.form}
              </span>
            </div>
          </div>
          <a
            href={svgDownloadHref(variant.svg)}
            download={`${variant.id}.svg`}
            className={
              buttonVariants({ variant: 'outline', size: 'sm' }) +
              ' shrink-0 font-normal [&_svg]:size-3!'
            }
            title="Download SVG"
          >
            <Download strokeWidth={1.5} />
            SVG
          </a>
        </div>
        {variant.usage && (
          <p className="text-sm leading-normal text-gray-500 dark:text-gray-400">{variant.usage}</p>
        )}
      </div>
    </div>
  );
}

/** Usage rules section rendered from LogoSet metadata. */
function LogoUsageRules({ logoSet }: { logoSet: LogoSet }) {
  const hasRules =
    logoSet.clearspace || logoSet.minWidth || (logoSet.doNot && logoSet.doNot.length > 0);

  if (!hasRules) return null;

  return (
    <div className="mb-8 rounded-2xl border border-gray-200 p-6 dark:border-gray-700">
      <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">Usage Rules</h2>
      <div className="grid gap-6 sm:grid-cols-2">
        {(logoSet.clearspace || logoSet.minWidth) && (
          <div className="flex flex-col gap-3">
            {logoSet.clearspace && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  Clear Space
                </p>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{logoSet.clearspace}</p>
              </div>
            )}
            {logoSet.minWidth && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  Minimum Width
                </p>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{logoSet.minWidth}</p>
              </div>
            )}
          </div>
        )}
        {logoSet.doNot && logoSet.doNot.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Do Not
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {logoSet.doNot.map((rule, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" strokeWidth={2} />
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default async function LogoPage() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'logo', '/foundations');
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  // Resolve logo data: DB-backed LogoSet takes priority, legacy assets.logos is fallback.
  const { getDataProvider } = await import('../../../lib/data');
  const logoSet = await getDataProvider().getLogoSet();
  const legacyAssets = !logoSet ? getTokens().assets : null;

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/logo"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        <div className="mt-3 flex flex-row gap-3">
          <Link
            className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
            href={config?.assets_zip_links?.logos ?? '/logos.zip'}
          >
            Download Logos <Download strokeWidth={1.5} />
          </Link>
        </div>
      </InlineEditHeader>

      {/* ── New LogoSet rendering ────────────────────────────────────────── */}
      {logoSet ? (
        <div className="flex flex-col gap-8">
          {logoSet.description && (
            <p className="text-gray-600 dark:text-gray-300">{logoSet.description}</p>
          )}

          <div>
            <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">Logo Variants</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {logoSet.variants.map((variant) => (
                <LogoVariantCard key={variant.id} variant={variant} />
              ))}
            </div>
          </div>

          <LogoUsageRules logoSet={logoSet} />

          <hr />

          <div className="prose dark:prose-invert">
            <ReactMarkdown
              components={MarkdownComponents}
              remarkPlugins={[remarkGfm, remarkCodeMeta]}
              rehypePlugins={[rehypeRaw]}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        /* ── Legacy assets.logos fallback ─────────────────────────────── */
        <>
          <div>
            <h2 className="mb-2 scroll-m-20 text-2xl font-semibold tracking-tight">Logo Variations</h2>
            <p className="mb-8">
              There is one main {config?.app?.client} logo that supports two variations.
            </p>
          </div>
          <div className="mb-8 grid grid-cols-2 gap-6">
            {legacyAssets?.logos?.map((logo) => (
              <DisplayLogo logo={logo} content={config?.app?.client} key={logo.path} />
            ))}
          </div>
          <hr />
          <hr />
          <div className="prose dark:prose-invert">
            <ReactMarkdown
              components={MarkdownComponents}
              remarkPlugins={[remarkGfm, remarkCodeMeta]}
              rehypePlugins={[rehypeRaw]}
            >
              {content}
            </ReactMarkdown>
          </div>
        </>
      )}
    </Layout>
  );
}
