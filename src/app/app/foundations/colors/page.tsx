import groupBy from 'lodash/groupBy';
import upperFirst from 'lodash/upperFirst';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import ColorGrid from '../../../components/Foundations/ColorGrid';
import { DownloadTokens } from '../../../components/DownloadTokens';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import HeadersType from '../../../components/Typography/Headers';
import { fetchFoundationDocPageMarkdown, getClientRuntimeConfig, getTokens } from '../../../components/util';

export async function generateMetadata() {
  const { props } = fetchFoundationDocPageMarkdown('docs/foundations/', 'colors', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function ColorsPage() {
  const { props } = fetchFoundationDocPageMarkdown('docs/foundations/', 'colors', '/foundations');
  const config = getClientRuntimeConfig();
  const design = getTokens().localStyles;
  const { content, menu, metadata, current, scss, css, styleDictionary, types } = props;

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
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
        <DownloadTokens componentId="colors" scss={scss} css={css} styleDictionary={styleDictionary} types={types} />
      </div>
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
