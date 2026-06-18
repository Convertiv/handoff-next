import fs from 'fs';
import path from 'path';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

interface SpacingToken {
  key: string;
  name: string;
  value: string;
  px: number;
}

function loadSpacingTokens(): SpacingToken[] {
  try {
    const filePath = path.resolve(process.cwd(), 'design-system', 'tokens', 'primitive', 'spacing.tokens.json');
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, Record<string, { $value: string }>>;
    const spacing = raw['spacing'] ?? {};
    return Object.entries(spacing).map(([key, token]) => {
      const value = token['$value'] ?? '0rem';
      const px    = Math.round(parseFloat(value) * 16);
      return { key, name: `spacing-${key}`, value, px };
    }).sort((a, b) => a.px - b.px);
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
  const config   = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  const dtcg     = await fetchDtcgTokenStrings('spacing');
  const manifest = await fetchDtcgManifest();
  const tokens   = loadSpacingTokens();

  const maxPx = Math.max(...tokens.map((t) => t.px), 1);

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/spacing"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        {manifest && <ProvenanceBadge manifest={manifest} />}
      </InlineEditHeader>

      <div className="lg:gap-10 lg:py-8 xl:grid xl:grid-cols-[1fr_280px]">
        <div>
          <div id="spacing-scale" className="scroll-mt-24 pb-10">
            <h2 className="mb-4 text-2xl font-semibold">Spacing Scale</h2>
            <p className="mb-8 text-gray-600">
              Base unit is <code className="rounded bg-gray-100 px-1 py-0.5 text-sm">1.25rem</code> (20px). Steps are multiples of that base, with a finer <code className="rounded bg-gray-100 px-1 py-0.5 text-sm">0.625rem</code> half-step for tight layouts.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    <th className="pb-3 pr-6 font-medium">Token</th>
                    <th className="pb-3 pr-6 font-medium">Value</th>
                    <th className="pb-3 pr-6 font-medium">px</th>
                    <th className="pb-3 w-full font-medium">Visual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tokens.map((token) => (
                    <tr key={token.key} className="group hover:bg-gray-50/60">
                      <td className="py-3 pr-6 font-mono text-xs text-gray-700">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5">--{token.name}</span>
                      </td>
                      <td className="py-3 pr-6 font-mono text-xs text-gray-500">{token.value}</td>
                      <td className="py-3 pr-6 font-mono text-xs text-gray-400">{token.px}px</td>
                      <td className="py-3">
                        {token.px === 0 ? (
                          <span className="text-xs text-gray-300">—</span>
                        ) : (
                          <div
                            className="h-4 rounded-sm bg-blue-500"
                            style={{ width: `${Math.round((token.px / maxPx) * 100)}%`, maxWidth: '100%' }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {dtcg && (
            <TokenOutputTabs
              css={dtcg.css}
              scss={dtcg.scss}
              tailwind={dtcg.tailwind}
              dtcg={dtcg.dtcg}
              name="spacing"
            />
          )}
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
