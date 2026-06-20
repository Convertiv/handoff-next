import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig, getTokens } from '../../../../components/util';
import { getDataProvider } from '@/lib/data';
import SingleIconClient from './SingleIconClient';

export async function generateStaticParams() {
  // URL-encode the icon id so Iconify-format ids like 'lucide:user-round' become
  // the safe path segment 'lucide%3Auser-round'. The page decodes params.name
  // before the catalog lookup, so the round-trip is transparent.
  const catalog = await getDataProvider().getIconCatalog();
  return catalog.map((icon) => ({ name: encodeURIComponent(icon.id) }));
}

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'icons', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function SingleIconPage({ params }: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await params;
  // Params may arrive URL-encoded (e.g. 'lucide%3Auser-round') — decode so the
  // catalog lookup works against the canonical Iconify-format id.
  const name = decodeURIComponent(rawName);
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
