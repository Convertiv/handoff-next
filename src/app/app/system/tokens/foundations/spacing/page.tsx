import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../../../components/util';
import { fetchDtcgTokenStrings } from '../../../../../components/util/dtcg';
import TokenFoundationSpacingClient from './TokenFoundationSpacingClient';

export async function generateMetadata() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'system/tokens/foundations/spacing', '/system');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function TokenFoundationSpacingPage() {
  const config = getClientRuntimeConfig();
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'system/tokens/foundations/spacing', '/system');
  const dtcg = await fetchDtcgTokenStrings('spacing');
  return (
    <TokenFoundationSpacingClient
      content={props.content}
      menu={props.menu}
      metadata={props.metadata}
      current={props.current}
      config={config}
      dtcgJson={dtcg?.dtcg ?? null}
    />
  );
}
