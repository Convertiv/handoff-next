import { NextResponse, type NextRequest } from 'next/server';
import { getDataProvider } from '@/lib/data';
import { componentThumbnailSvg } from '@/lib/component-thumbnail';

/**
 * Schematic thumbnail for a component.
 *
 * Exists because the catalog's own `image` field is a workspace-mode path (`/images/components/
 * generated/*.png`) that does not resolve in registry mode — and the UI's `onError` handler quietly
 * hid the failure, so every picker has been silently thumbnail-less.
 *
 * **This route is the swap boundary.** Callers reference the URL; replacing the generated diagram with
 * real captured screenshots changes what is served here and touches nothing else.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const componentId = (id ?? '').trim();
  if (!componentId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const component = await getDataProvider().getComponent(componentId);
  if (!component) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = componentThumbnailSvg((component as any)?.properties ?? {});

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Deterministic from the component's contract, so it only changes when the component does. Short
      // shared cache with a long stale window: a push shows up quickly without a thundering herd.
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
