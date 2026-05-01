import type { Metadata as NextMetadata } from 'next';
import { redirect } from 'next/navigation';
import { getClientRuntimeConfig, type Metadata } from '../../../components/util';
import { getDataProvider } from '../../../lib/data';
import { auth } from '../../../lib/auth';
import SavedDesignDetailClient from './SavedDesignDetailClient';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<NextMetadata> {
  const { id } = await params;
  return {
    title: `Design — ${id.slice(0, 8)}…`,
    description: 'Saved design from the Design workbench.',
  };
}

export default async function SavedDesignDetailPage({ params }: PageProps) {
  const { id } = await params;
  const artifactId = (id ?? '').trim();
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();
  const baseMeta: Metadata = {
    title: 'Saved design',
    description: 'View a saved design artifact.',
    metaTitle: 'Saved design',
    metaDescription: 'View a saved design artifact.',
  };

  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/designs/${encodeURIComponent(artifactId)}`);
  }

  if (!artifactId) {
    redirect('/designs');
  }

  return <SavedDesignDetailClient config={config} menu={menu} metadata={baseMeta} artifactId={artifactId} />;
}
