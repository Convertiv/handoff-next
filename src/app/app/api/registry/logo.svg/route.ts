import { NextResponse } from 'next/server';
import { getRegistryAppearance, getRegistryLogoSet } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/registry/logo.svg — serves the appearance-selected logo SVG.
 * Falls back to a 302 redirect to /logo.svg if no custom logo is configured.
 */
export async function GET(): Promise<Response> {
  try {
    const appearance = await getRegistryAppearance();
    const settings = appearance?.settings ?? {};

    if (settings.customLogoSvg) {
      return new NextResponse(settings.customLogoSvg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=60, must-revalidate',
        },
      });
    }

    if (settings.logoVariantId) {
      const logoSet = await getRegistryLogoSet();
      const variant = logoSet?.variants.find((v) => v.id === settings.logoVariantId);
      if (variant?.svg) {
        return new NextResponse(variant.svg, {
          headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=60, must-revalidate',
          },
        });
      }
    }
  } catch {
    // Fall through to static fallback
  }

  return NextResponse.redirect(
    new URL('/logo.svg', process.env.HANDOFF_APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000'),
    302,
  );
}
