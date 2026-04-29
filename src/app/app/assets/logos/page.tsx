import { FileArchive } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import Footer from '../../../components/Footer';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import Header from '../../../components/old/Header';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/assets/', 'logos', '/assets');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function AssetsLogosPage() {
  const { props } = await fetchDocPageMarkdownAsync('docs/assets/', 'logos', '/assets');
  const config = getClientRuntimeConfig();
  const { content, menu, metadata } = props;

  return (
    <div className="c-page">
      <Header menu={menu} config={config} />
      <section className="c-content">
        <div className="o-container-fluid">
          <div className="c-hero">
            <div>
              <h1>{metadata.title}</h1>
              <p>{metadata.description}</p>
            </div>
          </div>
          <div className="o-row u-justify-between">
            <div className="o-col-5@md"><h4>{config?.app?.client} Logo</h4></div>
            <div className="o-col-6@md">
              <div className="c-card">
                <FileArchive />
                <h4>{config?.app?.client} Logo</h4>
                <p>Vector files of approved {config?.app?.client} logos.</p>
                <p><a href={config?.assets_zip_links?.logos ?? '/logos.zip'}>Download Logos</a></p>
              </div>
            </div>
          </div>
          <div className="prose">
            <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
              {content}
            </ReactMarkdown>
          </div>
          <hr />
        </div>
      </section>
      <Footer config={config} />
    </div>
  );
}
