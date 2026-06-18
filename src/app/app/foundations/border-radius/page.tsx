import { DownloadTokens } from '../../../components/DownloadTokens';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

interface RadiusToken {
  key: string;
  name: string;
  value: string;
  px: number;
  description: string;
}

function parseRadiusTokens(dtcgJson: string): RadiusToken[] {
  try {
    const obj = JSON.parse(dtcgJson) as Record<string, { $type?: string; $value: string; $description?: string }>;
    return Object.entries(obj)
      .map(([key, token]) => {
        const value = token.$value ?? '0px';
        const raw = parseFloat(value);
        const px = value === '9999px' ? 9999 : Math.round(isNaN(raw) ? 0 : raw);
        return { key, name: `border-radius-${key}`, value, px, description: token.$description ?? '' };
      });
  } catch {
    return [];
  }
}

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'border-radius', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function BorderRadiusPage() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'border-radius', '/foundations');
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  const dtcg     = await fetchDtcgTokenStrings('border-radius');
  const manifest = await fetchDtcgManifest();
  const tokens   = dtcg ? parseRadiusTokens(dtcg.dtcg) : [];

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/border-radius"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        {dtcg && (
          <DownloadTokens
            componentId="border-radius"
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
            <section id="radius-scale" className="scroll-mt-24 pb-12">
              <h2 className="mb-2 text-2xl font-semibold">Radius Scale</h2>
              <p className="mb-8 text-gray-500 dark:text-gray-400">
                Seven steps from sharp corners to a full pill shape. Apply these tokens to inputs,
                cards, buttons, and overlays to keep component shapes consistent.
              </p>

              <div className="flex flex-wrap items-end gap-6">
                {tokens.map((token) => (
                  <div key={token.key} className="flex flex-col items-center gap-2">
                    <div
                      className="h-16 w-16 bg-blue-500"
                      style={{ borderRadius: token.value === '9999px' ? '9999px' : token.value }}
                    />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{token.key}</span>
                    <span className="font-mono text-[10px] text-gray-400">{token.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tokens.length === 0 && (
            <div className="mb-10 rounded-lg border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
              No border-radius tokens found. Run{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5">npm run tokens:build</code> in the workspace and push to the registry.
            </div>
          )}

          {tokens.length > 0 && (
            <section id="usage" className="scroll-mt-24 pb-12">
              <h2 className="mb-4 text-2xl font-semibold">Usage</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-400">
                      <th className="pb-2 pr-4 font-medium">Token</th>
                      <th className="pb-2 pr-4 font-medium">Value</th>
                      <th className="pb-2 pr-4 font-medium">px</th>
                      <th className="pb-2 font-medium">Usage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((token) => (
                      <tr key={token.key} className="border-b text-gray-500 dark:text-gray-400">
                        <td className="py-2 pr-4">
                          <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">--{token.name}</code>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">{token.value}</td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {token.value === '9999px' ? '9999px' : `${token.px}px`}
                        </td>
                        <td className="py-2 text-xs text-gray-400">{token.description}</td>
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
              name="border-radius"
            />
          )}

          <PrevNextNav
            previous={{ title: 'Grid', href: '/foundations/grid' }}
            next={{ title: 'Motion', href: '/foundations/motion' }}
          />
        </div>

        <AnchorNav
          groups={[
            { 'radius-scale': 'Radius Scale' },
            { usage: 'Usage' },
          ]}
        />
      </div>
    </Layout>
  );
}
