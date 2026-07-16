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
import { fetchDtcgBrands, fetchDtcgManifest, fetchDtcgSource, fetchDtcgTokenStrings, fetchLocalStylesColors } from '../../../components/util/dtcg';
import { asDtcgSource, axisValues, buildResolvedBrandsCache, BRAND_AXIS, schemeValues } from '../../../lib/dtcg-axes';
import { normalizeDtcgMatrix } from '../../../lib/dtcg-normalizer';
import type { DtcgBrandTokens } from '../../../lib/data/types';
import type { Types as CoreTypes } from 'handoff-core';

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
  const [{ props }, dtcg, manifest, brands, localColors, rawSource] = await Promise.all([
    fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'colors', '/foundations'),
    fetchDtcgTokenStrings('color'),
    fetchDtcgManifest(),
    fetchDtcgBrands(),
    fetchLocalStylesColors(),
    fetchDtcgSource(),
  ]);
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current, scss, css, styleDictionary, types } = props;

  // Multi-axis path (P1.6d): when a reference source tree exists, resolve a brand ×
  // scheme matrix of color objects so the display can offer a scheme toggle. Falls
  // through to the single-axis brands path below when there's no source (or it
  // yields no colors), so existing CSS-brand registries are unaffected.
  const source = asDtcgSource(rawSource);
  let colorMatrix: Record<string, Record<string, CoreTypes.IColorObject[]>> | undefined;
  let matrixBrandNames: string[] | undefined;
  let schemeNames: string[] | undefined;
  if (source) {
    const normalized = normalizeDtcgMatrix(buildResolvedBrandsCache(source));
    const built: Record<string, Record<string, CoreTypes.IColorObject[]>> = {};
    for (const [brand, schemes] of Object.entries(normalized)) {
      built[brand] = {};
      for (const [scheme, norm] of Object.entries(schemes)) built[brand][scheme] = norm.color;
    }
    const hasColors = Object.values(built).some((s) => Object.values(s).some((arr) => arr.length > 0));
    if (hasColors) {
      colorMatrix = built;
      const brandVals = axisValues(source, BRAND_AXIS);
      matrixBrandNames = brandVals.length ? brandVals.filter((b) => built[b]) : Object.keys(built);
      schemeNames = schemeValues(source);
    }
  }
  const useMatrix = !!colorMatrix && (matrixBrandNames?.length ?? 0) > 0;

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
  const displayBrandNames = useMatrix ? matrixBrandNames! : hasDtcgBrands ? dtcgBrandNames : displayBrands ? ['default'] : [];

  // Pre-compute anchor groups from the first brand for the static sidebar nav.
  const firstBrand = displayBrandNames[0];
  const anchorGroupNames: string[] = useMatrix
    ? Array.from(
        new Set(
          Object.values(colorMatrix![firstBrand] ?? {})
            .flat()
            .map((c) => c.group)
        )
      )
    : (() => {
        const firstBrandGroups = firstBrand && displayBrands ? displayBrands[firstBrand] : null;
        return firstBrandGroups ? Object.keys(firstBrandGroups) : [];
      })();
  const anchorGroupEntries = anchorGroupNames.map((g) => ({ [`${g}-colors`]: `${upperFirst(g.replace(/-/g, ' '))} Colors` }));

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
          {(useMatrix || displayBrands) && displayBrandNames.length > 0 ? (
            <ColorsDisplay
              brands={displayBrands ?? {}}
              brandNames={displayBrandNames}
              colorMatrix={colorMatrix}
              schemeNames={schemeNames}
            />
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
