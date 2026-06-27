import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from './index';
import { handoffComponentPreviews, handoffComponents } from './schema';
import { getComponentVersionCount } from './component-version-queries';
import {
  slugifyPreviewKey,
  validatePreviewValues,
  type PreviewValueError,
} from '@handoff/transformers/preview/component/preview-validation';

export interface ComponentPreviewRecord {
  id: string;
  componentId: string;
  previewKey: string;
  componentVersion: number | null;
  title: string;
  values: Record<string, unknown>;
  slots: Record<string, unknown> | null;
  semantic: string | null;
  rationale: string | null;
  source: string;
  syncState: string;
  authorId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CreateComponentPreviewInput {
  componentId: string;
  title: string;
  values: Record<string, unknown>;
  previewKey?: string;
  semantic?: string | null;
  rationale?: string | null;
  source?: 'manual' | 'llm';
  authorId?: string | null;
}

export interface UpdateComponentPreviewInput {
  title?: string;
  values?: Record<string, unknown>;
  semantic?: string | null;
  rationale?: string | null;
}

/** Raised when a preview's values don't conform to the component contract. */
export class PreviewValidationFailed extends Error {
  constructor(public readonly errors: PreviewValueError[]) {
    super(`Preview values failed validation: ${errors.map((e) => `${e.key}: ${e.message}`).join('; ')}`);
    this.name = 'PreviewValidationFailed';
  }
}

function rowToRecord(r: typeof handoffComponentPreviews.$inferSelect): ComponentPreviewRecord {
  return {
    id: r.id,
    componentId: r.componentId,
    previewKey: r.previewKey,
    componentVersion: r.componentVersion ?? null,
    title: r.title,
    values: (r.values as Record<string, unknown>) ?? {},
    slots: (r.slots as Record<string, unknown> | null) ?? null,
    semantic: r.semantic ?? null,
    rationale: r.rationale ?? null,
    source: r.source,
    syncState: r.syncState,
    authorId: r.authorId ?? null,
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

/** Load the component's contract (properties) + its code-authored preview keys. */
async function loadContract(
  componentId: string
): Promise<{ properties: Record<string, unknown>; codePreviewKeys: Set<string> } | null> {
  const db = getDb();
  const [row] = await db
    .select({ properties: handoffComponents.properties, previews: handoffComponents.previews })
    .from(handoffComponents)
    .where(eq(handoffComponents.id, componentId));
  if (!row) return null;
  const properties = (row.properties as Record<string, unknown>) ?? {};
  const previews = (row.previews as Record<string, unknown>) ?? {};
  return { properties, codePreviewKeys: new Set(Object.keys(previews)) };
}

export async function listComponentPreviews(componentId: string): Promise<ComponentPreviewRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(handoffComponentPreviews)
    .where(eq(handoffComponentPreviews.componentId, componentId))
    .orderBy(asc(handoffComponentPreviews.createdAt));
  return rows.map(rowToRecord);
}

export async function getComponentPreview(id: string): Promise<ComponentPreviewRecord | null> {
  const db = getDb();
  const [row] = await db.select().from(handoffComponentPreviews).where(eq(handoffComponentPreviews.id, id));
  return row ? rowToRecord(row) : null;
}

/**
 * Create a registry-authored preview. Validates values against the live
 * contract (throws PreviewValidationFailed), derives a unique previewKey that
 * does not collide with code previews or existing registry previews (§13 #1),
 * and stamps the current component version (§15 anchoring).
 */
export async function createComponentPreview(input: CreateComponentPreviewInput): Promise<ComponentPreviewRecord> {
  const contract = await loadContract(input.componentId);
  if (!contract) throw new Error(`Component not found: ${input.componentId}`);

  const errors = validatePreviewValues(input.values, contract.properties as Record<string, never>);
  if (errors.length) throw new PreviewValidationFailed(errors);

  const existing = await listComponentPreviews(input.componentId);
  const taken = new Set<string>([...contract.codePreviewKeys, ...existing.map((p) => p.previewKey)]);
  const previewKey = uniqueKey(input.previewKey?.trim() || slugifyPreviewKey(input.title) || 'preview', taken);

  const version = await getComponentVersionCount(input.componentId);

  const db = getDb();
  const [row] = await db
    .insert(handoffComponentPreviews)
    .values({
      componentId: input.componentId,
      previewKey,
      componentVersion: version > 0 ? version : null,
      title: input.title,
      values: input.values,
      semantic: input.semantic ?? null,
      rationale: input.rationale ?? null,
      source: input.source ?? 'manual',
      syncState: 'in-sync',
      authorId: input.authorId ?? null,
    })
    .returning();
  return rowToRecord(row);
}

export async function updateComponentPreview(
  id: string,
  patch: UpdateComponentPreviewInput
): Promise<ComponentPreviewRecord | null> {
  const current = await getComponentPreview(id);
  if (!current) return null;

  if (patch.values !== undefined) {
    const contract = await loadContract(current.componentId);
    const errors = validatePreviewValues(patch.values, (contract?.properties ?? {}) as Record<string, never>);
    if (errors.length) throw new PreviewValidationFailed(errors);
  }

  const db = getDb();
  const [row] = await db
    .update(handoffComponentPreviews)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.values !== undefined ? { values: patch.values, syncState: 'in-sync' } : {}),
      ...(patch.semantic !== undefined ? { semantic: patch.semantic } : {}),
      ...(patch.rationale !== undefined ? { rationale: patch.rationale } : {}),
      updatedAt: new Date(),
    })
    .where(eq(handoffComponentPreviews.id, id))
    .returning();
  return row ? rowToRecord(row) : null;
}

export async function deleteComponentPreview(id: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(handoffComponentPreviews)
    .where(eq(handoffComponentPreviews.id, id))
    .returning({ id: handoffComponentPreviews.id });
  return deleted.length > 0;
}

/**
 * Re-validate every registry preview for a component against the (possibly new)
 * contract — the push reconciliation step (§15). Conforming previews → in-sync;
 * non-conforming → drifted (preserved, surfaced for reconciliation, never
 * deleted). Returns the count flagged drifted.
 */
export async function revalidateComponentPreviews(componentId: string): Promise<{ inSync: number; drifted: number }> {
  const contract = await loadContract(componentId);
  if (!contract) return { inSync: 0, drifted: 0 };
  const previews = await listComponentPreviews(componentId);
  const db = getDb();
  let inSync = 0;
  let drifted = 0;
  for (const p of previews) {
    const ok = validatePreviewValues(p.values, contract.properties as Record<string, never>).length === 0;
    const next = ok ? 'in-sync' : 'drifted';
    if (next === 'drifted') drifted++;
    else inSync++;
    if (next !== p.syncState) {
      await db
        .update(handoffComponentPreviews)
        .set({ syncState: next })
        .where(eq(handoffComponentPreviews.id, p.id));
    }
  }
  return { inSync, drifted };
}

function uniqueKey(base: string, taken: Set<string>): string {
  let key = base || 'preview';
  if (!taken.has(key)) return key;
  let n = 2;
  while (taken.has(`${key}-${n}`)) n += 1;
  return `${key}-${n}`;
}
