import { fetchDocPageMarkdownAsync, getClientRuntimeConfig, getTokens } from '../../../../components/util';
import { getDataProvider } from '@/lib/data';
import SingleIconClient from './SingleIconClient';

export async function generateStaticParams() {
  const tokens = getTokens();
  const icons = (tokens.assets?.icons ?? []).map((icon) => ({ name: icon.name }));
  return icons;
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

  const catalog = await getDataProvider().getIconCatalog();
  const catalogEntry = catalog.find((e) => e.id === name) ?? null;

  return (
    <SingleIconClient
      name={name}
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      assets={assets}
      catalogEntry={catalogEntry}
    />
  );
}
