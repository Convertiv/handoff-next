import type { Metadata as NextMetadata } from 'next';
import { getClientRuntimeConfig, type Metadata } from '@/components/util';
import { auth } from '@/lib/auth';
import { getDataProvider } from '@/lib/data';
import { serializeFoundationsFromTokens } from '@/lib/server/design-prompt-builder';
import type { DesignWorkbenchFoundationContext } from '../workbench-types';
import DesignSettingsClient from './SettingsClient';

const PAGE_METADATA: Metadata = {
  title: 'Design settings',
  description: 'Configure default context for the Design workbench.',
  metaTitle: 'Design settings',
  metaDescription: 'Configure default context for the Design workbench.',
};

export async function generateMetadata(): Promise<NextMetadata> {
  return {
    title: PAGE_METADATA.metaTitle,
    description: PAGE_METADATA.metaDescription,
  };
}

export default async function DesignSettingsPage() {
  const config = getClientRuntimeConfig();
  const provider = getDataProvider();
  const menu = await provider.getMenu();
  let foundations: DesignWorkbenchFoundationContext = { colors: [], typography: [], effects: [], spacing: [] };

  try {
    foundations = serializeFoundationsFromTokens(await provider.getTokens());
  } catch {
    foundations = { colors: [], typography: [], effects: [], spacing: [] };
  }

  const session = await auth();
  const canEdit = session?.user?.role === 'admin';

  return (
    <DesignSettingsClient config={config} menu={menu} metadata={PAGE_METADATA} foundations={foundations} canEdit={canEdit} />
  );
}
