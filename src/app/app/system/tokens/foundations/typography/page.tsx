import { fetchDocPageMarkdown, getClientRuntimeConfig, getTokens } from '../../../../../components/util';
import TokenFoundationTypographyClient from './TokenFoundationTypographyClient';

export async function generateMetadata() {
  const { props } = fetchDocPageMarkdown('docs/', 'system/tokens/foundations/typography', '/system');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function TokenFoundationTypographyPage() {
  const config = getClientRuntimeConfig();
  const { props } = fetchDocPageMarkdown('docs/', 'system/tokens/foundations/typography', '/system');
  const design = getTokens().localStyles;
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
