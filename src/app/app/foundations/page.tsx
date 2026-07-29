import { Columns, Hexagon, Lightning, Palette, Ruler, Shapes, Square, Stack, Sun, TextT } from '@phosphor-icons/react/dist/ssr';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import CardsWithIcons from '../../components/cards/CardsWithIcons';
import Layout from '../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../components/Markdown/MarkdownComponents';
import HeadersType from '../../components/Typography/Headers';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../components/util';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'foundations', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function FoundationsPage() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'foundations', '/foundations');
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex max-w-3xl flex-col gap-3 pb-10">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <p className="text-lg font-light leading-relaxed">{metadata.description}</p>
      </div>
      <div className="prose">
        <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
          {content}
        </ReactMarkdown>
      </div>
      <div>
        <CardsWithIcons
          items={[
            { title: 'Logo', description: `${config?.app?.client} logo used for all digital and offline materials.`, icon: Hexagon, link: '/foundations/logo', cta: 'Explore Logos' },
            { title: 'Colors', description: 'Color palette, semantic tokens, and usage guidelines across light and dark surfaces.', icon: Palette, link: '/foundations/colors', cta: 'Explore Colors' },
            { title: 'Typography', description: 'Typographic scale, font families, sizes, weights, and line heights.', icon: TextT, link: '/foundations/typography', cta: 'Explore Typography' },
            { title: 'Spacing', description: 'Consistent spacing scale for margins, paddings, and layout gaps.', icon: Ruler, link: '/foundations/spacing', cta: 'Explore Spacing' },
            { title: 'Grid', description: 'Page layout system with columns, gutters, breakpoints, and device sizes.', icon: Columns, link: '/foundations/grid', cta: 'Explore Grid' },
            { title: 'Effects', description: 'Shadows, blurs, and other visual effects used across components.', icon: Sun, link: '/foundations/effects', cta: 'View Effects' },
            { title: 'Icons', description: 'Downloadable icon library for use in digital products and materials.', icon: Shapes, link: '/foundations/icons', cta: 'View Library' },
            { title: 'Border Radius', description: 'Corner radius scale from sharp to fully rounded, applied to buttons, cards, and inputs.', icon: Square, link: '/foundations/border-radius', cta: 'View Scale' },
            { title: 'Motion', description: 'Duration and easing tokens for consistent, intentional animation across the system.', icon: Lightning, link: '/foundations/motion', cta: 'View Motion' },
            { title: 'Elevation', description: 'Z-index scale for layering overlays, modals, dropdowns, and sticky elements.', icon: Stack, link: '/foundations/elevation', cta: 'View Elevation' },
          ]}
        />
      </div>
    </Layout>
  );
}
