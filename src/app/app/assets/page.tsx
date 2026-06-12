import Layout from '../../components/Layout/Main';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../components/util';
import AssetsClient from './AssetsClient';

export async function generateMetadata() {
  return { title: 'Asset Library', description: 'Browse and manage design assets' };
}

export default async function AssetsPage() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'foundations', '/foundations');
  const config = getClientRuntimeConfig();
  const { menu } = props;

  const metadata = {
    title: 'Asset Library',
    metaTitle: 'Asset Library',
    metaDescription: 'Browse and manage design assets',
  };

  const current = {
    path: '/assets',
    title: 'Assets',
    subSections: [],
  };

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <AssetsClient />
    </Layout>
  );
}
