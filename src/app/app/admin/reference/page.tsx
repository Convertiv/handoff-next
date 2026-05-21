import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getClientRuntimeConfig } from '../../../components/util';
import { getDataProvider } from '../../../lib/data';
import { listReferenceMaterials } from '../../../lib/db/queries';
import { usePostgres } from '../../../lib/db/dialect';
import ReferenceClient from './ReferenceClient';

export const metadata: Metadata = {
  title: 'Reference materials',
  description: 'Generated LLM context from catalog and tokens',
};

export default async function AdminReferencePage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/admin/reference');
  }
  if (session.user.role !== 'admin') {
    return <ReferenceClient config={config} menu={menu} message="You need administrator access to view this page." />;
  }

  let referenceEmpty = false;
  if (usePostgres()) {
    try {
      const rows = await listReferenceMaterials();
      referenceEmpty = !rows.some((r) => (r.content?.trim().length ?? 0) > 50);
    } catch {
      referenceEmpty = true;
    }
  }

  return <ReferenceClient config={config} menu={menu} referenceEmpty={referenceEmpty} />;
}
