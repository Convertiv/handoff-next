import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../components/util';
import PlaygroundClient from './PlaygroundClient';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'playground', '/playground');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function PlaygroundPage({ searchParams }: { searchParams?: Promise<{ pattern?: string }> }) {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'playground', '/playground');
  const config = getClientRuntimeConfig();
  const sp = searchParams ? await searchParams : undefined;
  const initialPatternId = typeof sp?.pattern === 'string' && sp.pattern.length > 0 ? sp.pattern : undefined;
  return (
    <PlaygroundClient
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      initialPatternId={initialPatternId}
    />
  );
}
