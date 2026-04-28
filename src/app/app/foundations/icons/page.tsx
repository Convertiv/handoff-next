import { fetchDocPageMarkdown, getClientRuntimeConfig, getTokens } from '../../../components/util';
import IconsPageClient from './IconsPageClient';

export async function generateMetadata() {
  const { props } = fetchDocPageMarkdown('docs/foundations/', 'icons', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function IconsPage() {
  const { props } = fetchDocPageMarkdown('docs/foundations/', 'icons', '/foundations');
  const config = getClientRuntimeConfig();
  const assets = getTokens().assets;
  return (
    <IconsPageClient
      content={props.content}
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      assets={assets}
    />
  );
}
