import { FontFamily } from '@handoff/types/font';
import sortedUniq from 'lodash/sortedUniq';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { DownloadTokens } from '../../../components/DownloadTokens';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import TypographyExamples from '../../../components/Foundations/TypographyExample';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import { anchorSlugify } from '../../../components/Navigation/anchor-slugify';
import HeadersType from '../../../components/Typography/Headers';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig, getTokensForRuntime } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'typography', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function TypographyPage() {
  const [{ props }, tokens] = await Promise.all([
    fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'typography', '/foundations'),
    getTokensForRuntime(),
  ]);
  const config   = getClientRuntimeConfig();
  const design   = tokens.localStyles;
  const { content, menu, metadata, current, scss, css, styleDictionary, types } = props;

  const dtcg     = await fetchDtcgTokenStrings('typography');
  const manifest = await fetchDtcgManifest();

  const typography = (design?.typography ?? []).slice().sort((a, b) => {
    const l = (config?.app?.type_sort ?? []).indexOf(a.name) >>> 0;
    const r = (config?.app?.type_sort ?? []).indexOf(b.name) >>> 0;
    return l !== r ? l - r : a.name.localeCompare(b.name);
  });

  const families: FontFamily = typography.reduce((result, current) => ({
    ...result,
    [current.values.fontFamily]: result[current.values.fontFamily]
      ? sortedUniq([...result[current.values.fontFamily], current.values.fontWeight].sort((a, b) => a - b))
      : [current.values.fontWeight],
  }), {} as FontFamily);

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/typography"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        <DownloadTokens
          componentId="typography"
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
          <div id="typefaces" className="scroll-mt-24 pb-10">
            <HeadersType.H2 className="mb-4 text-2xl font-semibold">Typefaces</HeadersType.H2>
            <p className="mb-8">Our typeface defines the foundation of our typography system. It ensures readability, consistency, and flexibility across all applications.</p>
            {Object.keys(families).map((key) => (
              <div className="rounded-lg bg-gray-50 p-10" key={key} id={`typeface-${anchorSlugify(key)}`}>
                <p className="mb-1 text-sm">Typeface</p>
                <div style={{ fontFamily: key }}>
                  <p className="mb-3 text-3xl leading-relaxed text-gray-900 dark:text-gray-100">{key}</p>
                  <p className="mb-2 break-all text-xs tracking-[0.3em] text-gray-400">ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz</p>
                  <p className="break-all text-xs tracking-[0.3em] text-gray-400">1234567890&apos;?&quot;!&quot;(%)[#]@/&amp;\-+÷×=®©$€£¥¢:;,.*</p>
                </div>
              </div>
            ))}
          </div>
          <div id="typography-scale" className="scroll-mt-24 pb-10">
            <HeadersType.H2 className="mb-4 text-2xl font-semibold">Typography Scale</HeadersType.H2>
            <p className="mb-8">This is our typography hierarchy, defining the full range of headings, paragraphs, labels and other text used across the system.</p>
            <TypographyExamples types={typography} />
          </div>

          {dtcg && (
            <TokenOutputTabs
              css={dtcg.css}
              scss={dtcg.scss}
              tailwind={dtcg.tailwind}
              dtcg={dtcg.dtcg}
              name="typography"
            />
          )}
          <PrevNextNav
            previous={{ title: 'Colors', href: '/foundations/colors' }}
            next={{ title: 'Spacing', href: '/foundations/spacing' }}
          />
        </div>
        <AnchorNav groups={[{ typefaces: 'Typefaces' }, { 'typography-scale': 'Typography Scale' }]} />
        <div className="prose">
          <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </Layout>
  );
}
