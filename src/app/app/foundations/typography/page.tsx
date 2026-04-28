import { FontFamily } from '@handoff/types/font';
import sortedUniq from 'lodash/sortedUniq';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { DownloadTokens } from '../../../components/DownloadTokens';
import TypographyExamples from '../../../components/Foundations/TypographyExample';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import { anchorSlugify } from '../../../components/Navigation/anchor-slugify';
import HeadersType from '../../../components/Typography/Headers';
import { fetchFoundationDocPageMarkdown, getClientRuntimeConfig, getTokens } from '../../../components/util';

export async function generateMetadata() {
  const { props } = fetchFoundationDocPageMarkdown('docs/foundations/', 'typography', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function TypographyPage() {
  const { props } = fetchFoundationDocPageMarkdown('docs/foundations/', 'typography', '/foundations');
  const config = getClientRuntimeConfig();
  const design = getTokens().localStyles;
  const { content, menu, metadata, current, scss, css, styleDictionary, types } = props;

  const typography = design.typography.slice().sort((a, b) => {
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
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
        <DownloadTokens componentId="colors" scss={scss} css={css} styleDictionary={styleDictionary} types={types} />
      </div>
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
