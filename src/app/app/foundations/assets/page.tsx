import Layout from '../../../components/Layout/Main';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import AssetsClient from '../../assets/AssetsClient';

export async function generateMetadata() {
  return { title: 'Asset Library', description: 'Browse and manage design assets' };
}

export default async function FoundationAssetsPage() {
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'foundations', '/foundations');
  const config = getClientRuntimeConfig();
  const { menu } = props;

  const metadata = {
    title: 'Asset Library',
    metaTitle: 'Asset Library',
    metaDescription: 'Browse and manage design assets',
  };

  const current = {
    path: '/foundations/assets',
    title: 'Assets',
    subSections: [],
  };

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <AssetsClient />
    </Layout>
  );
}
