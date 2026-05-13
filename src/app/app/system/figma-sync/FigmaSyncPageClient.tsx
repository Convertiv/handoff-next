'use client';

import Layout from '../../../components/Layout/Main';
import { MarkdownComponents, remarkCodeMeta } from '../../../components/Markdown/MarkdownComponents';
import HeadersType from '../../../components/Typography/Headers';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { FigmaFetchControls } from '../FigmaFetchControls';
import { FigmaSyncPanel } from '../FigmaSyncPanel';

export default function FigmaSyncPageClient({ content, menu, metadata, current, config }) {
  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <div className="mt-3 flex flex-row flex-wrap items-start justify-between gap-3">
          <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
          <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-2">
            <FigmaFetchControls />
          </div>
        </div>
      </div>

      <div>
        <div className="prose mb-10">
          <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
            {content}
          </ReactMarkdown>
        </div>
        <FigmaSyncPanel />
      </div>
    </Layout>
  );
}
