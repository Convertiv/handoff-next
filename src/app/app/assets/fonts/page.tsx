import * as fs from 'fs-extra';
import uniq from 'lodash/uniq';
import { FileArchive } from 'lucide-react';
import path from 'path';
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import Footer from '../../../components/Footer';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import Header from '../../../components/old/Header';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig, getTokens } from '../../../components/util';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/assets/', 'fonts', '/assets');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function FontsPage() {
  const { props } = await fetchDocPageMarkdownAsync('docs/assets/', 'fonts', '/assets');
  const config = getClientRuntimeConfig();
  const design = getTokens().localStyles;
  const { content, menu, metadata } = props;

  const fontsDir = path.resolve(process.env.HANDOFF_MODULE_PATH ?? '', '.handoff', `${process.env.HANDOFF_PROJECT_ID}`, 'public', 'fonts');
  let customFonts: string[] = [];
  if (fs.existsSync(fontsDir)) {
    customFonts = fs.readdirSync(fontsDir).filter((f) => f.endsWith('.zip')).map((f) => f.replace('.zip', ''));
  }

  const fontFamilies: string[] = uniq(design.typography.map((type) => type.values.fontFamily));
  const fontLinks: string[] = fontFamilies.map((fontFamily) => {
    const machineName = fontFamily.replace(/\s/g, '');
    const custom = customFonts.find((font) => font === machineName);
    if (custom) return `/fonts/${machineName}.zip`;
    return `https://fonts.google.com/specimen/${fontFamily}`;
  });

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
          {fontFamilies.map((fontFamily, i) => (
            <React.Fragment key={fontFamily}>
              <div className="o-row u-justify-between">
                <div className="o-col-5@md"><h4>{fontFamily}</h4></div>
                <div className="o-col-6@md">
                  <div className="c-card">
                    <FileArchive />
                    <h4>{fontFamily}</h4>
                    <p>Font files for installing on a local machine.</p>
                    <p><a href={fontLinks[i]}>Download Font</a></p>
                  </div>
                </div>
              </div>
              <hr />
            </React.Fragment>
          ))}
          <div className="prose">
            <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      </section>
      <Footer config={config} />
    </div>
  );
}
