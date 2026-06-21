import type React from 'react';
import { DownloadTokens } from '../../../components/DownloadTokens';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

interface FocusTokens {
  ringWidth: string;
  ringOffset: string;
  ringColor: string;
  ringColorDark: string;
  ringColorError: string;
  ringRadius: string;
}

function parseFocusTokens(dtcgJson: string): FocusTokens | null {
  try {
    const obj = JSON.parse(dtcgJson) as Record<string, { $type?: string; $value: string; $description?: string }>;
    return {
      ringWidth:      String(obj['ring-width']?.$value      ?? '2px'),
      ringOffset:     String(obj['ring-offset']?.$value     ?? '2px'),
      ringColor:      String(obj['ring-color']?.$value      ?? '#0066CC'),
      ringColorDark:  String(obj['ring-color-dark']?.$value ?? '#4D9FE0'),
      ringColorError: String(obj['ring-color-error']?.$value ?? '#CC0000'),
      ringRadius:     String(obj['ring-radius']?.$value     ?? '4px'),
    };
  } catch {
    return null;
  }
}

function ringStyle(color: string, width: string, offset: string, radius: string): React.CSSProperties {
  return {
    outline: `${width} solid ${color}`,
    outlineOffset: offset,
    borderRadius: radius,
  };
}

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'focus', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function FocusPage() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'focus', '/foundations');
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  const dtcg   = await fetchDtcgTokenStrings('focus');
  const manifest = await fetchDtcgManifest();
  const focus  = dtcg ? parseFocusTokens(dtcg.dtcg) : null;

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/focus"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        {dtcg && (
          <DownloadTokens
            componentId="focus"
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
          {!focus && (
            <div className="mb-10 rounded-lg border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
              No focus tokens found. Run{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5">npm run tokens:build</code> in the workspace and push to the registry.
            </div>
          )}

          {/* ── Live examples ─────────────────────────────────────────── */}
          {focus && (
            <section id="examples" className="scroll-mt-24 pb-12">
              <h2 className="mb-1 text-2xl font-semibold">Focus Ring</h2>
              <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
                A {focus.ringWidth} ring with {focus.ringOffset} offset. These examples are rendered with the actual token values.
              </p>

              <div className="flex flex-wrap gap-10">
                {/* Default */}
                <div className="flex flex-col items-start gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Default</span>
                  <button
                    className="rounded px-4 py-2 text-sm font-medium text-white"
                    style={{
                      backgroundColor: focus.ringColor,
                      ...ringStyle(focus.ringColor, focus.ringWidth, focus.ringOffset, focus.ringRadius),
                    }}
                  >
                    Button
                  </button>
                  <input
                    readOnly
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
                    style={ringStyle(focus.ringColor, focus.ringWidth, focus.ringOffset, focus.ringRadius)}
                    defaultValue="Text input"
                  />
                  <a
                    href="#"
                    className="text-sm underline"
                    style={ringStyle(focus.ringColor, focus.ringWidth, focus.ringOffset, '2px')}
                    onClick={(e) => e.preventDefault()}
                  >
                    Link
                  </a>
                </div>

                {/* Error */}
                <div className="flex flex-col items-start gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Error state</span>
                  <button
                    className="rounded border border-red-500 bg-white px-4 py-2 text-sm font-medium text-red-600 dark:bg-gray-900"
                    style={ringStyle(focus.ringColorError, focus.ringWidth, focus.ringOffset, focus.ringRadius)}
                  >
                    Error button
                  </button>
                  <input
                    readOnly
                    className="rounded border border-red-400 px-3 py-1.5 text-sm dark:border-red-700 dark:bg-gray-800"
                    style={ringStyle(focus.ringColorError, focus.ringWidth, focus.ringOffset, focus.ringRadius)}
                    defaultValue="Error input"
                  />
                </div>

                {/* Dark background */}
                <div className="flex flex-col items-start gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Dark surface</span>
                  <div className="rounded-lg bg-gray-900 p-4">
                    <button
                      className="rounded px-4 py-2 text-sm font-medium text-white"
                      style={{
                        backgroundColor: '#1a2744',
                        ...ringStyle(focus.ringColorDark, focus.ringWidth, focus.ringOffset, focus.ringRadius),
                      }}
                    >
                      Dark button
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── Token table ───────────────────────────────────────────── */}
          {focus && (
            <section id="tokens" className="scroll-mt-24 pb-12">
              <h2 className="mb-4 text-2xl font-semibold">Tokens</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-400">
                      <th className="pb-2 pr-4 font-medium">Token</th>
                      <th className="pb-2 pr-4 font-medium">Value</th>
                      <th className="pb-2 font-medium">Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { key: 'ring-width',       value: focus.ringWidth,      purpose: 'Stroke width of the focus ring' },
                      { key: 'ring-offset',       value: focus.ringOffset,     purpose: 'Gap between element boundary and ring' },
                      { key: 'ring-radius',       value: focus.ringRadius,     purpose: 'Border radius of the focus ring' },
                      { key: 'ring-color',        value: focus.ringColor,      purpose: 'Default focus ring — light surfaces', swatch: true },
                      { key: 'ring-color-dark',   value: focus.ringColorDark,  purpose: 'Focus ring on dark/inverted surfaces', swatch: true },
                      { key: 'ring-color-error',  value: focus.ringColorError, purpose: 'Focus ring in error states', swatch: true },
                    ].map(({ key, value, purpose, swatch }) => (
                      <tr key={key} className="border-b text-gray-500 dark:text-gray-400">
                        <td className="py-2 pr-4">
                          <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">--focus-{key}</code>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            {swatch && (
                              <span
                                className="inline-block h-3.5 w-3.5 rounded-full border border-gray-200 dark:border-gray-600"
                                style={{ backgroundColor: value }}
                              />
                            )}
                            <span className="font-mono text-xs">{value}</span>
                          </div>
                        </td>
                        <td className="py-2 text-xs text-gray-400">{purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {dtcg && (
            <TokenOutputTabs
              css={dtcg.css}
              scss={dtcg.scss}
              tailwind={dtcg.tailwind}
              dtcg={dtcg.dtcg}
              name="focus"
            />
          )}

          <PrevNextNav
            previous={{ title: 'Motion', href: '/foundations/motion' }}
            next={{ title: 'Elevation', href: '/foundations/elevation' }}
          />
        </div>

        <AnchorNav
          groups={[
            { examples: 'Focus Ring' },
            { tokens: 'Tokens' },
          ]}
        />
      </div>
    </Layout>
  );
}
