import { NextResponse, type NextRequest } from 'next/server';
import { authOrCloudToken } from '@/lib/sync-auth';
import { getDataProvider } from '@/lib/data';
import { serializeFoundationsFromTokens, serializeFoundationsFromDtcgData } from '@/lib/server/design-prompt-builder';
import { renderFoundationsImage, shouldRasterizeFoundations } from '@/lib/server/foundation-image';
import type { DesignWorkbenchFoundationContext } from '@/app/design/workbench-types';

// Allow up to the full function budget so we can observe a real hang in dev/preview.
export const maxDuration = 300;

/**
 * Debug-only endpoint: resolves the same foundation context the design workbench
 * uses, rasterizes it, and returns the PNG (or JSON diagnostics with `?json=1`).
 * Use to isolate foundation rasterization from the SSE/worker/OpenAI pipeline.
 *
 *   GET /api/handoff/ai/debug-foundation-raster        → PNG (viewable in browser)
 *   GET /api/handoff/ai/debug-foundation-raster?json=1 → { ok, ms, bytes, counts, error }
 */
export async function GET(request: NextRequest) {
  const ctx = await authOrCloudToken(request);
  if (ctx instanceof NextResponse) return ctx;

  const wantJson = new URL(request.url).searchParams.get('json') === '1';

  // ── Resolve foundation context (mirrors src/app/app/design/page.tsx) ──────
  let foundations: DesignWorkbenchFoundationContext = { colors: [], typography: [], effects: [], spacing: [] };
  let resolveError: string | null = null;
  try {
    const provider = getDataProvider();
    const tokens = await provider.getTokens();
    foundations = serializeFoundationsFromTokens(tokens as unknown);

    const isEmpty =
      foundations.colors.length === 0 && foundations.typography.length === 0 && foundations.spacing.length === 0;
    if (isEmpty) {
      const [brands, spacingStr, typographyStr] = await Promise.all([
        provider.getDtcgBrands().catch(() => null),
        provider.getDtcgTokenStrings('spacing').catch(() => null),
        provider.getDtcgTokenStrings('typography').catch(() => null),
      ]);
      const parseDtcg = (s: { dtcg: string } | null) => {
        if (!s?.dtcg) return null;
        try { return JSON.parse(s.dtcg); } catch { return null; }
      };
      foundations = serializeFoundationsFromDtcgData({
        brands: brands as Record<string, Record<string, Record<string, unknown>>> | null,
        spacingDtcg: parseDtcg(spacingStr),
        typographyDtcg: parseDtcg(typographyStr),
      });
    }
  } catch (e) {
    resolveError = e instanceof Error ? e.message : String(e);
  }

  const counts = {
    colors: foundations.colors.length,
    typography: foundations.typography.length,
    spacing: foundations.spacing?.length ?? 0,
    effects: foundations.effects?.length ?? 0,
    willRasterize: shouldRasterizeFoundations(foundations),
    fontFamilies: Array.from(
      new Set(
        foundations.typography
          .map((t) => (t.line.split('·')[0] ?? '').trim())
          .filter((f) => f && f.toLowerCase() !== 'sans-serif')
      )
    ),
  };

  if (resolveError) {
    return NextResponse.json({ ok: false, stage: 'resolve', error: resolveError, counts }, { status: 500 });
  }

  // ── Rasterize with timing ─────────────────────────────────────────────────
  const startedAt = Date.now();
  let png: Buffer | null = null;
  let renderError: string | null = null;
  try {
    png = await renderFoundationsImage(foundations);
  } catch (e) {
    renderError = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  }
  const ms = Date.now() - startedAt;

  if (wantJson || renderError || !png) {
    return NextResponse.json(
      {
        ok: Boolean(png) && !renderError,
        stage: 'rasterize',
        ms,
        bytes: png?.byteLength ?? 0,
        nullResult: !png,
        error: renderError,
        counts,
      },
      { status: renderError ? 500 : 200 }
    );
  }

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'X-Raster-Ms': String(ms),
      'X-Raster-Bytes': String(png.byteLength),
    },
  });
}
