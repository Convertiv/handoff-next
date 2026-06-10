import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '@/components/util';
import Layout from '@handoff/app/components/Layout/Main';
import HeadersType from '@/components/Typography/Headers';
import { ChangelogClient } from './ChangelogClient';
import type { Metadata as DocMetadata } from '@/components/util';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return {
    title: 'Changelog',
    description: 'History of component, token, and page changes across the design system.',
  };
}

export default async function ChangelogPage() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'system', '/system');
  const config = getClientRuntimeConfig();

  return (
    <Layout config={config} menu={props.menu} current={props.current} metadata={props.metadata as DocMetadata}>
      <div className="space-y-6">
        <HeadersType.H1>Changelog</HeadersType.H1>
        <ChangelogClient />
      </div>
    </Layout>
  );
}
