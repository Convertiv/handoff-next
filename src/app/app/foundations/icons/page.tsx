import { Download } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import IconCatalogGrid from '../../../components/Foundations/IconCatalogGrid';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { buttonVariants } from '../../../components/ui/button';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { getDataProvider } from '../../../lib/data';

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'icons', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function IconsPage() {
  const [{ props }, iconCatalog] = await Promise.all([
    fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'icons', '/foundations'),
    getDataProvider().getIconCatalog().catch(() => []),
  ]);
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/icons"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
          href={config?.assets_zip_links?.icons ?? '/icons.zip'}
        >
          Download Icons <Download strokeWidth={1.5} />
        </Link>
      </InlineEditHeader>

      <div className="lg:py-8">
        {content && (
          <div className="prose mb-8">
            <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
              {content}
            </ReactMarkdown>
          </div>
        )}
        <IconCatalogGrid catalog={iconCatalog} />
        <PrevNextNav previous={null} next={{ title: 'Logo', href: '/foundations/logo' }} />
      </div>
    </Layout>
  );
}
