import 'server-only';

import { upsertReferenceMaterial } from '@/lib/db/queries';
import { generateAllReferenceMaterials, generateReferenceMaterial } from '@/lib/server/reference-material-generator';
import type { ReferenceMaterialId } from '@/lib/server/reference-material-ids';
import { REFERENCE_MATERIAL_IDS } from '@/lib/server/reference-material-ids';

export async function regenerateAllReferenceMaterialsPersisted(opts: {
  actorUserId?: string | null;
  skipLlm?: boolean;
} = {}): Promise<void> {
  const all = await generateAllReferenceMaterials(opts);
  for (const id of REFERENCE_MATERIAL_IDS) {
    const row = all[id];
    await upsertReferenceMaterial(id, row.content, row.metadata);
  }
}

export async function regenerateReferenceMaterialPersisted(
  id: ReferenceMaterialId,
  opts: { actorUserId?: string | null; skipLlm?: boolean } = {}
): Promise<void> {
  const row = await generateReferenceMaterial(id, opts);
  await upsertReferenceMaterial(id, row.content, row.metadata);
}
