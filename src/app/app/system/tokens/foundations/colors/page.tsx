import { fetchDocPageMarkdown, getClientRuntimeConfig, getTokensForRuntime } from '../../../../../components/util';
import TokenFoundationColorsClient from './TokenFoundationColorsClient';

export async function generateMetadata() {
  const { props } = fetchDocPageMarkdown('docs/', 'system/tokens/foundations/colors', '/system');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function TokenFoundationColorsPage() {
  const config = getClientRuntimeConfig();
  const { props } = fetchDocPageMarkdown('docs/', 'system/tokens/foundations/colors', '/system');
  const design = (await getTokensForRuntime()).localStyles;
  return (
    <TokenFoundationColorsClient
      content={props.content}
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      design={design}
    />
  );
}
