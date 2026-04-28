import { Download } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { DisplayLogo } from '../../../components/Foundations/DisplayLogo';
import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import HeadersType from '../../../components/Typography/Headers';
import { buttonVariants } from '../../../components/ui/button';
import { fetchDocPageMarkdown, getClientRuntimeConfig, getTokens } from '../../../components/util';

export async function generateMetadata() {
  const { props } = fetchDocPageMarkdown('docs/foundations/', 'logo', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function LogoPage() {
  const { props } = fetchDocPageMarkdown('docs/foundations/', 'logo', '/foundations');
  const config = getClientRuntimeConfig();
  const assets = getTokens().assets;
  const { content, menu, metadata, current } = props;

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
        <div className="mt-3 flex flex-row gap-3">
          <Link
            className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' font-normal [&_svg]:size-3!'}
            href={config?.assets_zip_links?.logos ?? '/logos.zip'}
          >
            Download Logos <Download strokeWidth={1.5} />
          </Link>
        </div>
      </div>
      <div>
        <HeadersType.H2>Logo Variations</HeadersType.H2>
        <p className="mb-8">There is one main {config?.app?.client} logo that supports two variations.</p>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-6">
        {assets?.logos?.map((logo) => (
          <DisplayLogo logo={logo} content={config?.app?.client} key={logo.path} />
        ))}
      </div>
      <hr />
      <hr />
      <div className="prose">
        <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
          {content}
        </ReactMarkdown>
      </div>
    </Layout>
  );
}
