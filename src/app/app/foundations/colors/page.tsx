import groupBy from 'lodash/groupBy';
import upperFirst from 'lodash/upperFirst';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import ColorGrid from '../../../components/Foundations/ColorGrid';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import { DownloadTokens } from '../../../components/DownloadTokens';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig, getTokensForRuntime } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'colors', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function ColorsPage() {
  const [{ props }, tokens] = await Promise.all([
    fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'colors', '/foundations'),
    getTokensForRuntime(),
  ]);
  const config   = getClientRuntimeConfig();
  const design   = tokens.localStyles;
  const { content, menu, metadata, current, scss, css, styleDictionary, types } = props;

  const dtcg     = await fetchDtcgTokenStrings('color');
  const manifest = await fetchDtcgManifest();

  const colorGroups = Object.fromEntries(
    Object.entries(groupBy(design.color, 'group'))
      .map(([groupKey, colors]) => [groupKey, colors.map((c) => ({ ...c }))] as const)
      .sort((a, b) => {
        const l = (config?.app?.color_sort ?? []).indexOf(a[0]) >>> 0;
        const r = (config?.app?.color_sort ?? []).indexOf(b[0]) >>> 0;
        return l !== r ? l - r : a[0].localeCompare(b[0]);
      })
  );

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/colors"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        <DownloadTokens
          componentId="colors"
          scss={scss}
          css={css}
          styleDictionary={styleDictionary}
          types={types}
          tailwind={dtcg?.tailwind}
          dtcg={dtcg?.dtcg}
        />
        {manifest && <ProvenanceBadge manifest={manifest} />}
      </InlineEditHeader>

      <div className="lg:gap-10 lg:py-8 xl:grid xl:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-0">
          {Object.keys(colorGroups).map((group) => (
            <ColorGrid
              title={upperFirst(group)}
              group={group}
              description="Colors that are used most frequently across all pages and components."
              colors={colorGroups[group]}
              key={group}
            />
          ))}

          {dtcg && (
            <TokenOutputTabs
              css={dtcg.css}
              scss={dtcg.scss}
              tailwind={dtcg.tailwind}
              dtcg={dtcg.dtcg}
              name="colors"
            />
          )}

          <PrevNextNav previous={null} next={{ title: 'Typography', href: '/foundations/typography' }} />
        </div>
        <AnchorNav
          groups={[
            Object.assign({}, ...[...Object.keys(colorGroups).map((group) => ({ [`${group}-colors`]: `${upperFirst(group)} Colors` }))]),
          ]}
        />
        <div className="prose">
          <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </Layout>
  );
}
