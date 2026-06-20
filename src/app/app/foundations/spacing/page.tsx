import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { DownloadTokens } from '../../../components/DownloadTokens';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

interface SpacingToken {
  key: string;
  name: string;
  value: string;
  px: number;
  description: string;
}

/** Recursively flatten a nested DTCG object into a flat list of leaf tokens. */
function flattenDtcgLeaves(
  obj: Record<string, unknown>,
  prefix = '',
): SpacingToken[] {
  return Object.entries(obj).flatMap(([key, token]) => {
    if (!token || typeof token !== 'object') return [];
    const t = token as Record<string, unknown>;
    const fullKey = prefix ? `${prefix}-${key}` : key;
    if ('$value' in t) {
      const value = typeof t.$value === 'string' ? t.$value : '0rem';
      const px = Math.round(parseFloat(value) * 16);
      return [{ key: fullKey, name: `spacing-${fullKey}`, value, px, description: (t.$description as string) ?? '' }];
    }
    // Non-leaf group: recurse, stripping the outer key into the prefix
    return flattenDtcgLeaves(t as Record<string, unknown>, fullKey);
  });
}

function parseSpacingTokens(dtcgJson: string): SpacingToken[] {
  try {
    const obj = JSON.parse(dtcgJson) as Record<string, unknown>;
    // Style Dictionary resolved DTCG wraps leaves in a top-level 'spacing' group.
    // Unwrap it so the display keys are '0', '1', … rather than 'spacing-0', etc.
    const root =
      obj['spacing'] &&
      typeof obj['spacing'] === 'object' &&
      !('$value' in (obj['spacing'] as object))
        ? (obj['spacing'] as Record<string, unknown>)
        : obj;
    return flattenDtcgLeaves(root).sort((a, b) => a.px - b.px);
  } catch {
    return [];
  }
}

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'spacing', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function SpacingPage() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'spacing', '/foundations');
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  const dtcg     = await fetchDtcgTokenStrings('spacing');
  const manifest = await fetchDtcgManifest();
  const tokens   = dtcg ? parseSpacingTokens(dtcg.dtcg) : [];

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/spacing"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        {dtcg && (
          <DownloadTokens
            componentId="spacing"
            scss={dtcg.scss}
            css={dtcg.css}
            styleDictionary={null}
            types={null}
            tailwind={dtcg.tailwind}
            dtcg={dtcg.dtcg}
          />
        )}
        {manifest && <ProvenanceBadge manifest={manifest} />}
      </InlineEditHeader>

      <div className="lg:gap-10 lg:py-8 xl:grid xl:grid-cols-[1fr_280px]">
        <div>
          {tokens.length > 0 && (
            <div id="spacing-scale" className="scroll-mt-24 pb-10">
              <h2 className="mb-2 text-2xl font-semibold">Spacing Scale</h2>
              <p className="mb-8 text-gray-500 dark:text-gray-400">
                Each step in the scale is a multiple of the base unit{' '}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm dark:bg-gray-800">1.25rem</code>{' '}
                (20px). Use these tokens consistently to maintain rhythm across layouts and components.
              </p>

              <div className="flex flex-col gap-3">
                {tokens.map((token) => (
                  <div key={token.key} className="group flex items-center gap-4">
                    <div className="w-[220px] shrink-0">
                      {token.px === 0 ? (
                        <span className="inline-block h-5 w-px bg-gray-300 dark:bg-gray-600" />
                      ) : (
                        <div
                          className="h-5 rounded-sm bg-blue-500 transition-colors group-hover:bg-blue-600"
                          style={{ width: token.px }}
                        />
                      )}
                    </div>
                    <code className="w-40 shrink-0 text-xs text-gray-700 dark:text-gray-300">
                      --{token.name}
                    </code>
                    <span className="w-24 shrink-0 font-mono text-xs text-gray-500">{token.value}</span>
                    <span className="w-14 shrink-0 font-mono text-xs text-gray-400">{token.px}px</span>
                    {token.description && (
                      <span className="text-xs text-gray-400">{token.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tokens.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
              No spacing tokens found. Run <code className="mx-1 rounded bg-gray-100 px-1.5 py-0.5">npm run tokens:build</code> in the workspace and push to the registry.
            </div>
          )}

          {dtcg && (
            <TokenOutputTabs
              css={dtcg.css}
              scss={dtcg.scss}
              tailwind={dtcg.tailwind}
              dtcg={dtcg.dtcg}
              name="spacing"
            />
          )}

          <PrevNextNav
            previous={{ title: 'Typography', href: '/foundations/typography' }}
            next={{ title: 'Effects', href: '/foundations/effects' }}
          />
        </div>

        <AnchorNav groups={[{ 'spacing-scale': 'Spacing Scale' }]} />

        <div className="prose">
          <ReactMarkdown
            components={MarkdownComponents}
            remarkPlugins={[remarkGfm, remarkCodeMeta]}
            rehypePlugins={[rehypeRaw]}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </Layout>
  );
}
