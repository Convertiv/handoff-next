import Layout from '../../../components/Layout/Main';
import { fetchDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import AssetDetailClient from './AssetDetailClient';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: `Asset — ${id}`, description: 'Asset detail' };
}

export default async function AssetDetailPage({ params }: Props) {
  const { id } = await params;
  const { props } = await fetchDocPageMarkdownAsync('docs/', 'foundations', '/foundations');
  const config = getClientRuntimeConfig();
  const { menu } = props;

  const metadata = {
    title: 'Asset Detail',
    metaTitle: 'Asset Detail',
    metaDescription: 'Asset detail view',
  };

  const current = {
    path: '/assets',
    title: 'Assets',
    subSections: [],
  };

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <AssetDetailClient id={id} />
    </Layout>
  );
}
