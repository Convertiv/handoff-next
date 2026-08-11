import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { handoffComponents } from '@/lib/db/schema';
import { isPostgres } from '@/lib/db/dialect';
import { normalizePreviewValues, type NormalizedChange } from '@/lib/normalize-preview-values';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Repair preview values already stored output-shaped — the backfill half of Phase F `F.-1`.
 *
 * `sync-queries.ts` now normalises on ingest, but that only helps a component the next time it is pushed. This
 * applies the same function to what is already in the table, so the existing damage is fixed without waiting for
 * 76 components to be re-synced.
 *
 * **`dryRun` defaults to `true`.** This rewrites registry data; a call made by accident, or with the wrong body,
 * should report what it *would* do rather than do it. Pass `{"dryRun": false}` to actually write. Measured on
 * 8x8 before shipping: 221 substitutions across 33 components, taking unfeedable fields from **86 to 23** — the
 * 23 being declared arrays holding an element, which the normaliser deliberately refuses to guess at.
 *
 * Safe to re-run: the normaliser is idempotent, and a component it cannot repair is left untouched every time.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isPostgres()) {
    return NextResponse.json({ error: 'No database configured; there is nothing to normalize.' }, { status: 400 });
  }

  let body: { dryRun?: unknown; component?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Empty body is fine — defaults apply, and the default is not to write.
  }
  // Explicit `false` only. Anything else — absent, null, a truthy string — stays a dry run.
  const dryRun = body.dryRun !== false;
  const only = typeof body.component === 'string' ? body.component.trim() : '';

  const db = getDb();
  const rows = await db
    .select({
      id: handoffComponents.id,
      properties: handoffComponents.properties,
      previews: handoffComponents.previews,
      data: handoffComponents.data,
    })
    .from(handoffComponents);

  const changed: { componentId: string; changes: NormalizedChange[] }[] = [];
  let scanned = 0;
  let written = 0;

  for (const row of rows) {
    if (only && row.id !== only) continue;
    scanned += 1;

    const { previews, changes } = normalizePreviewValues(row.properties, row.previews);
    if (!changes.length) continue;

    /**
     * `data.previews` is normalised alongside the column, because that is what `getComponent` returns when a row
     * carries a payload — repairing one and not the other would leave the editor and the docs page disagreeing
     * about the same field.
     */
    let nextData = row.data;
    if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
      const payload = row.data as Record<string, unknown>;
      if (payload.previews) {
        const inner = normalizePreviewValues(row.properties, payload.previews);
        if (inner.changes.length) nextData = { ...payload, previews: inner.previews };
      }
    }

    changed.push({ componentId: row.id, changes });
    if (!dryRun) {
      await db
        .update(handoffComponents)
        .set({ previews: previews as object, data: nextData as object, updatedAt: new Date() })
        .where(eq(handoffComponents.id, row.id));
      written += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    scanned,
    componentsAffected: changed.length,
    valuesNormalized: changed.reduce((n, c) => n + c.changes.length, 0),
    written,
    /** What the normaliser could not repair is *not* listed here — run `contract-render-audit` for that. */
    note: dryRun
      ? 'Dry run — nothing was written. Send {"dryRun": false} to apply.'
      : 'Applied. Re-run /api/admin/contract-render-audit to see what remains (declared arrays holding an element cannot be repaired automatically).',
    components: changed.map((c) => ({
      componentId: c.componentId,
      count: c.changes.length,
      fields: c.changes.map((x) => `${x.previewKey}.${x.path} (${x.declaredType})`),
    })),
  });
}
