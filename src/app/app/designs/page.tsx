import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getClientRuntimeConfig } from '../../components/util';
import { getDataProvider } from '../../lib/data';
import { auth } from '../../lib/auth';
import { isDynamic } from '../../lib/mode';
import SavedDesignsClient from './SavedDesignsClient';

const PAGE_METADATA: Metadata = {
  title: 'Saved designs',
  description: 'Designs saved from the Design workbench for review and handoff.',
  metaTitle: 'Saved designs',
  metaDescription: 'Designs saved from the Design workbench for review and handoff.',
};

export async function generateMetadata(): Promise<Metadata> {
  return PAGE_METADATA;
}

export default async function DesignsPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  if (!isDynamic()) {
    return <SavedDesignsClient config={config} menu={menu} metadata={PAGE_METADATA} message="Saved designs are only available in dynamic mode with a database." />;
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/designs');
  }

  return <SavedDesignsClient config={config} menu={menu} metadata={PAGE_METADATA} />;
}
