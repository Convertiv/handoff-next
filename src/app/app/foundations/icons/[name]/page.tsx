import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig, getTokens } from '../../../../components/util';
import { getDataProvider } from '@/lib/data';
import SingleIconClient from './SingleIconClient';

export async function generateStaticParams() {
  // Use the data provider so both workspace and registry modes are supported.
  // URL param is icon.id (machine name) which is also what the catalog lookup
  // uses — using icon.name (display name) caused a mismatch and "icon not found".
  const catalog = await getDataProvider().getIconCatalog();
  return catalog.map((icon) => ({ name: icon.id }));
}

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'icons', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function SingleIconPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'icons', '/foundations');
  const config = getClientRuntimeConfig();
  // getTokens() returns a safe empty default when the filesystem export is absent
  // (registry mode), so assets?.icons will simply be undefined — the legacy
  // fallback path in SingleIconClient handles that gracefully.
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
