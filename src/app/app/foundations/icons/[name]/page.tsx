import { fetchDocPageMarkdownAsync, getClientRuntimeConfig, getTokens } from '../../../../components/util';
import SingleIconClient from './SingleIconClient';

export const dynamicParams = false;

export async function generateStaticParams() {
  const tokens = getTokens();
  const icons = (tokens.assets?.icons ?? []).map((icon) => ({ name: icon.name }));
  return icons.length > 0 ? icons : [{ name: '_placeholder' }];
}

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/foundations/', 'icons', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function SingleIconPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { props } = await fetchDocPageMarkdownAsync('docs/foundations/', 'icons', '/foundations');
  const config = getClientRuntimeConfig();
  const assets = getTokens().assets;
  return (
    <SingleIconClient
      name={name}
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      assets={assets}
    />
  );
}
