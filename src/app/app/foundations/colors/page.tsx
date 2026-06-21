import upperFirst from 'lodash/upperFirst';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { ColorsDisplay } from '../../../components/Foundations/ColorsDisplay';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import { DownloadTokens } from '../../../components/DownloadTokens';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { fetchDtcgBrands, fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'colors', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function ColorsPage() {
  const [{ props }, dtcg, manifest, brands] = await Promise.all([
    fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'colors', '/foundations'),
    fetchDtcgTokenStrings('color'),
    fetchDtcgManifest(),
    fetchDtcgBrands(),
  ]);
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current, scss, css, styleDictionary, types } = props;

  const brandNames = (manifest?.brands ?? []).filter((b) => b !== 'shared');

  // Pre-compute anchor groups from the first brand for the static sidebar nav.
  // The sidebar won't update when the user switches brands (client-side), which is acceptable.
  const firstBrand = brandNames[0];
  const firstBrandGroups = firstBrand && brands ? brands[firstBrand] : null;
  const anchorGroupEntries = firstBrandGroups
    ? Object.keys(firstBrandGroups).map((g) => ({ [`${g}-colors`]: `${upperFirst(g.replace(/-/g, ' '))} Colors` }))
    : [];

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
          {brands && brandNames.length > 0 ? (
            <ColorsDisplay brands={brands} brandNames={brandNames} />
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              No color tokens have been pushed to this registry yet.
            </p>
          )}

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
        <AnchorNav groups={anchorGroupEntries.length > 0 ? [Object.assign({}, ...anchorGroupEntries)] : []} />
        <div className="prose">
          <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </Layout>
  );
}
