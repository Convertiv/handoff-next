import { fetchDocPageMarkdownAsync, getClientRuntimeConfig, getTokensForRuntime } from '../../../../../components/util';
import TokenFoundationTypographyClient from './TokenFoundationTypographyClient';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'system/tokens/foundations/typography', '/system');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function TokenFoundationTypographyPage() {
  const config = getClientRuntimeConfig();
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'system/tokens/foundations/typography', '/system');
  const design = (await getTokensForRuntime()).localStyles;
  return (
    <TokenFoundationTypographyClient
      content={props.content}
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      design={design}
    />
  );
}
