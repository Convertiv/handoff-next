import { DownloadTokens } from '../../../components/DownloadTokens';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

interface ElevationToken {
  key: string;
  name: string;
  value: number;
  description: string;
}

function parseElevationTokens(dtcgJson: string): ElevationToken[] {
  try {
    const obj = JSON.parse(dtcgJson) as Record<string, { $type?: string; $value: number; $description?: string }>;
    return Object.entries(obj)
      .map(([key, token]) => ({
        key,
        name: `elevation-${key}`,
        value: typeof token.$value === 'number' ? token.$value : 0,
        description: token.$description ?? '',
      }))
      .sort((a, b) => a.value - b.value);
  } catch {
    return [];
  }
}

const LAYER_COLORS = [
  'bg-white dark:bg-gray-900',
  'bg-blue-50 dark:bg-blue-950',
  'bg-blue-100 dark:bg-blue-900',
  'bg-blue-200 dark:bg-blue-800',
  'bg-blue-300 dark:bg-blue-700',
  'bg-blue-400 dark:bg-blue-600',
  'bg-blue-500 dark:bg-blue-500',
  'bg-blue-600 dark:bg-blue-400',
];

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'elevation', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function ElevationPage() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'elevation', '/foundations');
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  const dtcg     = await fetchDtcgTokenStrings('elevation');
  const manifest = await fetchDtcgManifest();
  const tokens   = dtcg ? parseElevationTokens(dtcg.dtcg) : [];

  const maxValue = Math.max(...tokens.map((t) => t.value), 1);

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/elevation"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        {dtcg && (
          <DownloadTokens
            componentId="elevation"
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
          {tokens.length === 0 && (
            <div className="mb-10 rounded-lg border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
              No elevation tokens found. Run{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5">npm run tokens:build</code> in the workspace and push to the registry.
            </div>
          )}

          {/* ── Stacking visualization ────────────────────────────────── */}
          {tokens.length > 0 && (
            <section id="stacking" className="scroll-mt-24 pb-12">
              <h2 className="mb-1 text-2xl font-semibold">Stacking Order</h2>
              <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
                Eight layers from document flow to always-on-top. Higher z-index always renders above lower values.
              </p>

              <div className="overflow-x-auto rounded-xl border border-gray-100 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-900">
                {/* Staggered stack visualization */}
                <div className="relative" style={{ height: `${tokens.length * 36 + 40}px`, minWidth: '460px' }}>
                  {tokens.map((tok, i) => {
                    const fromBottom = tokens.length - 1 - i;
                    const colorClass = LAYER_COLORS[i % LAYER_COLORS.length];
                    return (
                      <div
                        key={tok.key}
                        className={`absolute flex items-center gap-3 rounded-lg border border-white/20 px-4 py-2 shadow-sm ${colorClass}`}
                        style={{
                          bottom: `${fromBottom * 8}px`,
                          left: `${fromBottom * 10}px`,
                          right: `${fromBottom * 10}px`,
                        }}
                      >
                        <span className="shrink-0 font-mono text-xs font-semibold text-gray-600 dark:text-gray-300">
                          {tok.value}
                        </span>
                        <span className="text-xs text-gray-600 dark:text-gray-300">
                          {tok.key.replace('z-', '')}
                        </span>
                        <span className="ml-auto text-xs text-gray-400">{tok.description}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ── Scale bars ───────────────────────────────────────────── */}
          {tokens.length > 0 && (
            <section id="scale" className="scroll-mt-24 pb-12">
              <h2 className="mb-4 text-2xl font-semibold">Z-Index Scale</h2>
              <div className="flex flex-col gap-2">
                {tokens.map((tok) => (
                  <div key={tok.key} className="flex items-center gap-4">
                    <div className="w-48 shrink-0">
                      <div
                        className="h-6 rounded-sm bg-blue-500"
                        style={{ width: `${Math.max((tok.value / maxValue) * 100, tok.value === 0 ? 2 : 4)}%` }}
                      />
                    </div>
                    <code className="w-44 shrink-0 text-xs text-gray-600 dark:text-gray-400">--{tok.name}</code>
                    <span className="w-14 shrink-0 font-mono text-xs text-gray-500">{tok.value}</span>
                    <span className="text-xs text-gray-400">{tok.description}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Token table ───────────────────────────────────────────── */}
          {tokens.length > 0 && (
            <section id="tokens" className="scroll-mt-24 pb-12">
              <h2 className="mb-4 text-2xl font-semibold">Tokens</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-400">
                      <th className="pb-2 pr-4 font-medium">Token</th>
                      <th className="pb-2 pr-4 font-medium">z-index</th>
                      <th className="pb-2 font-medium">Use case</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((tok) => (
                      <tr key={tok.key} className="border-b text-gray-500 dark:text-gray-400">
                        <td className="py-2 pr-4">
                          <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">--{tok.name}</code>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">{tok.value}</td>
                        <td className="py-2 text-xs text-gray-400">{tok.description}</td>
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
              name="elevation"
            />
          )}

          <PrevNextNav
            previous={{ title: 'Focus States', href: '/foundations/focus' }}
            next={null}
          />
        </div>

        <AnchorNav
          groups={[
            { stacking: 'Stacking Order' },
            { scale: 'Z-Index Scale' },
            { tokens: 'Tokens' },
          ]}
        />
      </div>
    </Layout>
  );
}
