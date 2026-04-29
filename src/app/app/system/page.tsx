import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../components/util';
import SystemPageClient from './SystemPageClient';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'system', '/system');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function SystemPage() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'system', '/system');
  const config = getClientRuntimeConfig();
  return (
    <SystemPageClient
      content={props.content}
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
    />
  );
}
