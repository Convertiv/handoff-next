import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../components/util';
import DesignClient from './DesignClient';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'design', '/design');
  return { title: props.metadata.metaTitle ?? 'Design', description: props.metadata.metaDescription };
}

export default async function DesignPage() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'design', '/design');
  const config = getClientRuntimeConfig();
  return (
    <DesignClient
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
    />
  );
}
