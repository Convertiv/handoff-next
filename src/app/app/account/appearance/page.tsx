import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { usePostgres } from '../../../lib/db/dialect';
import {
  getRegistryAppearance,
  getRegistryLogoSet,
  getRegistryDtcg,
  listRegistryFonts,
} from '../../../lib/db/registry-queries';
import { extractColorTokensFromDtcg, CSS_VAR_DESCRIPTORS } from '../../../lib/server/appearance';
import AppearanceClient from './AppearanceClient';

export const metadata: Metadata = {
  title: 'Appearance',
  description: 'Customize the look of your Handoff site',
};

export const dynamic = 'force-dynamic';

export default async function AppearancePage() {
  if (!usePostgres()) return null;

  const session = await auth();
  if (!session?.user) redirect('/login?callbackUrl=/account/appearance');
  if (session.user.role !== 'admin') {
    return <p className="text-sm text-muted-foreground">You need administrator access to view this page.</p>;
  }

  const [appearance, logoSet, dtcg, fonts] = await Promise.all([
    getRegistryAppearance(),
    getRegistryLogoSet(),
    getRegistryDtcg(),
    listRegistryFonts(),
  ]);

  const colorTokens = dtcg ? extractColorTokensFromDtcg(dtcg.dtcg as Record<string, unknown>) : [];
  const fontFamilies = Array.from(
    new Map(fonts.map((f) => [f.familyKey, { key: f.familyKey, name: f.family }])).values(),
  );

  return (
    <AppearanceClient
      initialSettings={appearance?.settings ?? {}}
      logoVariants={logoSet?.variants ?? []}
      logoSetName={logoSet?.name ?? null}
      colorTokens={colorTokens}
      fontFamilies={fontFamilies}
      cssVarDescriptors={CSS_VAR_DESCRIPTORS}
    />
  );
}
