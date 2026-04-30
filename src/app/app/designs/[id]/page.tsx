import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getClientRuntimeConfig } from '../../../components/util';
import { getDataProvider } from '../../../lib/data';
import { auth } from '../../../lib/auth';
import { isDynamic } from '../../../lib/mode';
import SavedDesignDetailClient from './SavedDesignDetailClient';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Design — ${id.slice(0, 8)}…`,
    description: 'Saved design from the Design workbench.',
    metaTitle: 'Saved design',
    metaDescription: 'View a saved design artifact.',
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

  if (!isDynamic()) {
    return (
      <SavedDesignDetailClient
        config={config}
        menu={menu}
        metadata={baseMeta}
        artifactId={artifactId}
        message="This view is only available in dynamic mode with a database."
      />
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/designs/${encodeURIComponent(artifactId)}`);
  }

  if (!artifactId) {
    redirect('/designs');
  }

  return <SavedDesignDetailClient config={config} menu={menu} metadata={baseMeta} artifactId={artifactId} />;
}
