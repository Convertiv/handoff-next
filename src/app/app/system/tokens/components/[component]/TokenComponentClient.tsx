'use client';

import Layout from '../../../../../components/Layout/Main';
import { DownloadTokens } from '../../../../../components/DownloadTokens';
import HeadersType from '../../../../../components/Typography/Headers';

export default function TokenComponentClient({ id, component, menu, config, current, metadata, scss, css, styleDictionary, types }) {
  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title} Tokens</HeadersType.H1>
        <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
        <DownloadTokens componentId={id} scss={scss} css={css} styleDictionary={styleDictionary} types={types} />
      </div>
    </Layout>
  );
}
