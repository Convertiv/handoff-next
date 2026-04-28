import { fetchDocPageMarkdown, getClientRuntimeConfig } from '../../components/util';
import PlaygroundClient from './PlaygroundClient';

export async function generateMetadata() {
  const { props } = fetchDocPageMarkdown('docs/', 'playground', '/playground');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function PlaygroundPage() {
  const { props } = fetchDocPageMarkdown('docs/', 'playground', '/playground');
  const config = getClientRuntimeConfig();
  return (
    <PlaygroundClient
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
    />
  );
}
