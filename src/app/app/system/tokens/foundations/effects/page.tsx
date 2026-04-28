import { fetchDocPageMarkdown, getClientRuntimeConfig, getTokensForRuntime } from '../../../../../components/util';
import TokenFoundationEffectsClient from './TokenFoundationEffectsClient';

export async function generateMetadata() {
  const { props } = fetchDocPageMarkdown('docs/', 'system/tokens/foundations/effects', '/system');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function TokenFoundationEffectsPage() {
  const config = getClientRuntimeConfig();
  const { props } = fetchDocPageMarkdown('docs/', 'system/tokens/foundations/effects', '/system');
  const design = (await getTokensForRuntime()).localStyles;
  return (
    <TokenFoundationEffectsClient
      content={props.content}
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      design={design}
    />
  );
}
