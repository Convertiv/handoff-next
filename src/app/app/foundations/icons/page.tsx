import { Download } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import IconCatalogGrid from '../../../components/Foundations/IconCatalogGrid';
import Footer from '../../../components/Footer';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import HeadersType from '../../../components/Typography/Headers';
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
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <p className="max-w-[800px] text-lg font-light text-gray-500 dark:text-gray-300">{metadata.description}</p>
        <div className="mt-3 flex flex-row gap-3">
          <Link
            className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
            href={config?.assets_zip_links?.icons ?? '/icons.zip'}
          >
            Download Icons <Download strokeWidth={1.5} />
          </Link>
        </div>
      </div>
      <hr className="mb-10" />
      {content && (
        <div className="prose mb-8">
          <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
            {content}
          </ReactMarkdown>
        </div>
      )}
      <IconCatalogGrid catalog={iconCatalog} />
      <Footer config={config} />
    </Layout>
  );
}
