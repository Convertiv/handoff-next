import { NextResponse, type NextRequest } from 'next/server';
import { getDataProvider } from '@/lib/data';
import { auditField, summarizeAudits, type FieldAudit } from '@/lib/field-lens';
import { editorOf, shapeNote } from '@/lib/mcp/scaffold-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * How much of this registry's field bridge is wrong.
 *
 * Every component × every preview × every declared field: compare what the field descriptor claims
 * against what the preview value actually is. Read-only — it changes nothing and exists to replace
 * "we think the bridge is right" with a number. See `docs/FIELD-BRIDGE.md`.
 *
 * Meaningful for React registries only. A Handlebars component's template context is plain
 * serializable JSON, so the declared shape *is* the shape and there is nothing to locate; the response
 * reports the format split so a run against a Handlebars registry is not mistaken for a clean bill.
 *
 * Auth: `HANDOFF_SYNC_SECRET` as bearer, matching `/api/admin/migrate`. Not secret data, but it walks
 * the whole catalog and should not be free to trigger.
 *
 *   curl -s "https://<registry>/api/admin/field-bridge-audit" -H "Authorization: Bearer $HANDOFF_SYNC_SECRET"
 *
 * Query params: `?verdict=breaks-write` to filter, `?limit=50` (default 100) to cap findings,
 * `?component=hero-background` for one component.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const secret = process.env.HANDOFF_SYNC_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'HANDOFF_SYNC_SECRET is not set on this deployment.' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if ((auth.startsWith('Bearer ') ? auth.slice(7).trim() : '') !== secret) {
    return NextResponse.json({ error: 'Unauthorized — bearer token must match HANDOFF_SYNC_SECRET' }, { status: 401 });
  }

  const url = new URL(request.url);
  const only = url.searchParams.get('component')?.trim() || '';
  const verdictFilter = url.searchParams.get('verdict')?.trim() || '';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 1000);

  const provider = getDataProvider();
  const list = await provider.getComponents();
  const audits: FieldAudit[] = [];
  const formats: Record<string, number> = {};
  const skipped: string[] = [];

  for (const row of list) {
    const id = String((row as { id?: unknown }).id ?? '');
    if (!id || (only && id !== only)) continue;

    const comp = await provider.getComponent(id);
    if (!comp) continue;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const format = String((comp as any)?.type ?? 'unknown');
    formats[format] = (formats[format] ?? 0) + 1;

    const props = ((comp as any)?.properties ?? {}) as Record<string, unknown>;
    const previews = ((comp as any)?.previews ?? {}) as Record<string, any>;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const previewKeys = Object.keys(previews);
    if (!Object.keys(props).length) {
      skipped.push(`${id}: declares no properties`);
      continue;
    }
    if (!previewKeys.length) {
      // Every field is unverifiable, which is itself the finding.
      for (const [field, meta] of Object.entries(props)) {
        audits.push(
          auditField({
            componentId: id,
            preview: '(none)',
            field,
            editorType: editorOf(meta),
            declaredShape: shapeNote(meta),
            value: undefined,
            hasPreviewValue: false,
          })
        );
      }
      continue;
    }

    for (const key of previewKeys) {
      const values: Record<string, unknown> = previews[key]?.values ?? previews[key] ?? {};
      for (const [field, meta] of Object.entries(props)) {
        audits.push(
          auditField({
            componentId: id,
            preview: key,
            field,
            editorType: editorOf(meta),
            declaredShape: shapeNote(meta),
            value: values[field],
            hasPreviewValue: field in values && values[field] !== undefined,
          })
        );
      }
    }
  }

  const report = summarizeAudits(audits);
  const findings = verdictFilter ? report.findings.filter((f) => f.verdict === verdictFilter) : report.findings;

  /** Which fields break most often, so a fix can be aimed rather than sprayed. */
  const byField: Record<string, number> = {};
  for (const f of report.findings) {
    if (f.verdict === 'breaks-write') byField[f.field] = (byField[f.field] ?? 0) + 1;
  }

  return NextResponse.json({
    summary: {
      components: report.components,
      previewsChecked: new Set(audits.map((a) => `${a.componentId}::${a.preview}`)).size,
      fieldChecks: report.fields,
      breaksWrite: report.breaksWrite,
      misleadsAuthor: report.misleadsAuthor,
      noPreview: report.noPreview,
      ok: report.ok,
    },
    // A Handlebars-heavy split means a low number here is expected, not reassuring.
    formats,
    worstFields: Object.entries(byField)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([field, count]) => ({ field, breaksWrite: count })),
    findings: findings.slice(0, limit),
    truncated: findings.length > limit ? findings.length - limit : 0,
    skipped,
  });
}
