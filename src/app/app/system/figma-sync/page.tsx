import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import FigmaSyncPageClient from './FigmaSyncPageClient';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'system/figma-sync', '/system');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function FigmaSyncPage() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'system/figma-sync', '/system');
  const config = getClientRuntimeConfig();
  return (
    <FigmaSyncPageClient
      content={props.content}
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
    />
  );
}
