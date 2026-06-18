import { Types as CoreTypes } from 'handoff-core';
import { lowerCase } from 'lodash';
import groupBy from 'lodash/groupBy';
import upperFirst from 'lodash/upperFirst';
import * as React from 'react';
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
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig, getTokensForRuntime } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

type EffectParametersObject = CoreTypes.IEffectObject['effects'][number];

const isShadowEffectType = (effect: 'INNER_SHADOW' | 'DROP_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR'): boolean =>
  ['DROP_SHADOW', 'INNER_SHADOW'].includes(effect);

const applyEffectToCssProperties = (effect: EffectParametersObject, cssProperties: React.CSSProperties) => {
  if (isShadowEffectType(effect.type)) {
    cssProperties.boxShadow = cssProperties.boxShadow ? `${cssProperties.boxShadow}, ${effect.value}` : effect.value;
  }
};

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'effects', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function EffectsPage() {
  const [{ props }, tokens] = await Promise.all([
    fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'effects', '/foundations'),
    getTokensForRuntime(),
  ]);
  const config   = getClientRuntimeConfig();
  const design   = tokens.localStyles;
  const { content, menu, metadata, current, scss, css, styleDictionary, types } = props;

  const dtcg     = await fetchDtcgTokenStrings('shadow');
  const manifest = await fetchDtcgManifest();

  const effectGroups = Object.fromEntries(
    Object.entries(groupBy(design?.effect ?? [], 'group')).map(([groupKey, effects]) =>
      [groupKey, effects.map((e) => ({ ...e }))] as const
    )
  );

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/effects"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        <DownloadTokens
          componentId="effects"
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
        <div>
          {Object.keys(effectGroups).map((group) => (
            <div key={group} id={`${lowerCase(group)}-effects`}>
              <h3 className="u-mb-4">{upperFirst(group)} Effects</h3>
              <div className="@container">
                <div className="mb-6 grid grid-cols-1 gap-6 @md:grid-cols-2">
                  {effectGroups[group].map((effect) => {
                    const cssProperties: React.CSSProperties = { backgroundColor: '#FFF' };
                    effect.effects.forEach((e: EffectParametersObject) => applyEffectToCssProperties(e, cssProperties));
                    return (
                      <div key={`effect-${effect.group}-${effect.name}`}>
                        <span className="group relative mb-2 block h-32 w-full rounded-lg" style={cssProperties}></span>
                        <p className="mb-1 text-sm font-medium">{effect.name}</p>
                        <small className="font-mono text-xs font-light text-gray-400">{effect.reference}</small>
                        <small className="block font-mono text-xs font-light text-gray-400">
                          {effect.effects.map((e, i) => (
                            <span key={i}>{e.value}{i < effect.effects.length - 1 ? ', ' : ''}</span>
                          ))}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </div>
              <hr />
            </div>
          ))}
          {dtcg && (
            <TokenOutputTabs
              css={dtcg.css}
              scss={dtcg.scss}
              tailwind={dtcg.tailwind}
              dtcg={dtcg.dtcg}
              name="effects"
            />
          )}
        </div>
        <AnchorNav
          groups={[
            Object.assign({}, ...[...Object.keys(effectGroups).map((group) => ({ [`${lowerCase(group)}-effects`]: `${upperFirst(group)} Effects` }))]),
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
