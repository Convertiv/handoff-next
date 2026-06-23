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
import { fetchDtcgBrands, fetchDtcgManifest, fetchDtcgTokenStrings, fetchLocalStylesColors } from '../../../components/util/dtcg';
import type { DtcgBrandTokens } from '../../../lib/data/types';

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'colors', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

/**
 * Convert Figma localStyles color objects (from tokens.json) into the
 * DtcgBrandTokens shape that ColorsDisplay expects. Used when a project
 * hasn't set up DTCG brand token files but has Figma color styles.
 */
function localStylesToDtcgBrands(
  colors: Array<{ name: string; machineName: string; value: string; group: string }>
): DtcgBrandTokens {
  const groups: Record<string, Record<string, { $type: string; $value: string }>> = {};
  for (const c of colors) {
    const group = (c.group || 'colors').toLowerCase();
    const key = c.machineName || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!groups[group]) groups[group] = {};
    groups[group][key] = { $type: 'color', $value: c.value };
  }
  return { default: groups };
}

export default async function ColorsPage() {
  const [{ props }, dtcg, manifest, brands, localColors] = await Promise.all([
    fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'colors', '/foundations'),
    fetchDtcgTokenStrings('color'),
    fetchDtcgManifest(),
    fetchDtcgBrands(),
    fetchLocalStylesColors(),
  ]);
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current, scss, css, styleDictionary, types } = props;

  // DTCG brands are the preferred source. Fall back to localStyles colors (from the
  // Figma tokens.json snapshot) when no brand token files have been pushed — this
  // lets projects without a design-system/tokens/brands/ directory still see colors.
  const dtcgBrandNames = (manifest?.brands ?? []).filter((b) => b !== 'shared');
  const hasDtcgBrands = dtcgBrandNames.length > 0 && !!brands;
  const displayBrands = hasDtcgBrands
    ? brands!
    : localColors && localColors.length > 0
      ? localStylesToDtcgBrands(localColors)
      : null;
  const displayBrandNames = hasDtcgBrands ? dtcgBrandNames : displayBrands ? ['default'] : [];

  // Pre-compute anchor groups from the first brand for the static sidebar nav.
  const firstBrand = displayBrandNames[0];
  const firstBrandGroups = firstBrand && displayBrands ? displayBrands[firstBrand] : null;
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
          {displayBrands && displayBrandNames.length > 0 ? (
            <ColorsDisplay brands={displayBrands} brandNames={displayBrandNames} />
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
