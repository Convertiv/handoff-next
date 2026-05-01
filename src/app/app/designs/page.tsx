import type { Metadata as NextMetadata } from 'next';
import { redirect } from 'next/navigation';
import { getClientRuntimeConfig, type Metadata } from '../../components/util';
import { getDataProvider } from '../../lib/data';
import { auth } from '../../lib/auth';
import SavedDesignsClient from './SavedDesignsClient';

const PAGE_METADATA: Metadata = {
  title: 'Saved designs',
  description: 'Designs saved from the Design workbench for review and handoff.',
  metaTitle: 'Saved designs',
  metaDescription: 'Designs saved from the Design workbench for review and handoff.',
};

export async function generateMetadata(): Promise<NextMetadata> {
  return {
    title: PAGE_METADATA.metaTitle,
    description: PAGE_METADATA.metaDescription,
  };
}

export default async function DesignsPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/designs');
  }

  return <SavedDesignsClient config={config} menu={menu} metadata={PAGE_METADATA} />;
}
