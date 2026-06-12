import type { Metadata as NextMetadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getClientRuntimeConfig } from '@/components/util';
import { getDataProvider } from '@/lib/data';
import { auth } from '@/lib/auth';
import { getAssetWithUsages } from '@/lib/db/queries';
import AssetDetailClient from './AssetDetailClient';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<NextMetadata> {
  const { id } = await params;
  const asset = await getAssetWithUsages(id);
  return {
    title: asset?.title ?? 'Asset detail',
    description: asset?.description ?? undefined,
  };
}

export default async function AssetDetailPage({ params }: Props) {
  const { id } = await params;
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/design/assets/${id}`);
  }

  const asset = await getAssetWithUsages(id);
  if (!asset) notFound();

  return <AssetDetailClient config={config} menu={menu} asset={asset} />;
}
