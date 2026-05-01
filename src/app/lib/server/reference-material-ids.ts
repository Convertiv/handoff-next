/** Stable primary keys for `handoff_reference_material`. */
export const REFERENCE_MATERIAL_IDS = ['catalog', 'property-patterns', 'tokens', 'icons'] as const;

export type ReferenceMaterialId = (typeof REFERENCE_MATERIAL_IDS)[number];

export function isReferenceMaterialId(id: string): id is ReferenceMaterialId {
  return (REFERENCE_MATERIAL_IDS as readonly string[]).includes(id);
}
