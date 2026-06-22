import { NextResponse, type NextRequest } from 'next/server';
import { authOrCloudToken } from '@/lib/sync-auth';
import { getDataProvider } from '@/lib/data';
import { serializeFoundationsFromTokens, serializeFoundationsFromDtcgData } from '@/lib/server/design-prompt-builder';
import { renderFoundationsImage, shouldRasterizeFoundations } from '@/lib/server/foundation-image';
import { openAiImageEdit } from '@/lib/server/ai-client';
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

  // ── Optional: inline OpenAI generation probe (?generate=1) ────────────────
  // Runs the full rasterize → openAiImageEdit path synchronously, bypassing the
  // job row / SSE poll / detached-worker machinery. Isolates whether the OpenAI
  // call itself works from whether the orchestration delivers its result.
  const wantGenerate = new URL(request.url).searchParams.get('generate') === '1';
  if (wantGenerate) {
    const userId = ctx instanceof NextResponse ? undefined : ctx.userId;
    const images = png
      ? [{ filename: 'design-system-foundations.png', contentType: 'image/png' as const, data: png }]
      : [{
          filename: 'canvas.png',
          contentType: 'image/png' as const,
          data: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAADklEQVQI12P4z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
            'base64'
          ),
        }];
    const genStart = Date.now();
    try {
      const imageUrl = await openAiImageEdit({
        prompt: 'Generate a simple, polished hero section for a web page using the attached design system foundations for styling only. Headline, short subtext, one primary button.',
        images,
        model: 'gpt-image-2',
        size: '2048x1152',
        quality: 'low',
        actorUserId: userId,
        route: 'debug:foundation-raster',
        eventType: 'ai.generate_design',
      });
      return NextResponse.json({
        ok: true,
        stage: 'generate',
        rasterMs: ms,
        generateMs: Date.now() - genStart,
        imageUrlPrefix: imageUrl.slice(0, 64),
        imageUrlLength: imageUrl.length,
        counts,
      });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          stage: 'generate',
          rasterMs: ms,
          generateMs: Date.now() - genStart,
          error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
          counts,
        },
        { status: 500 }
      );
    }
  }

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
