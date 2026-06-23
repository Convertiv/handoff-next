import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { auth } = await import('@/lib/auth');
  const {
    getRegistryAppearance,
    getRegistryLogoSet,
    getRegistryDtcg,
    listRegistryFonts,
  } = await import('@/lib/db/registry-queries');
  const { extractColorTokensFromDtcg, CSS_VAR_DESCRIPTORS, hslComponentsToHex } = await import('@/lib/server/appearance');

  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [appearance, logoSet, dtcg, fonts] = await Promise.all([
      getRegistryAppearance(),
      getRegistryLogoSet(),
      getRegistryDtcg(),
      listRegistryFonts(),
    ]);

    const colorTokens = dtcg ? extractColorTokensFromDtcg(dtcg.dtcg as Record<string, unknown>) : [];

    const fontFamilies = Array.from(new Map(fonts.map((f) => [f.familyKey, { key: f.familyKey, name: f.family }])).values());

    // Convert stored HSL component strings back to hex for the color pickers
    const settingsWithHex = { ...(appearance?.settings ?? {}) };

    return NextResponse.json({
      settings: settingsWithHex,
      logoVariants: logoSet?.variants ?? [],
      logoSetName: logoSet?.name ?? null,
      colorTokens,
      fontFamilies,
      cssVarDescriptors: CSS_VAR_DESCRIPTORS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === 'Forbidden') return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const { auth } = await import('@/lib/auth');
  const { upsertRegistryAppearance } = await import('@/lib/db/registry-queries');
  const { buildAppearanceCss } = await import('@/lib/server/appearance');

  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const settings = {
      logoVariantId: body.logoVariantId ?? undefined,
      customLogoSvg: body.customLogoSvg ?? undefined,
      colorOverrides: body.colorOverrides ?? {},
      fontSans: body.fontSans ?? undefined,
      fontMono: body.fontMono ?? undefined,
    };

    const css = buildAppearanceCss(settings);
    await upsertRegistryAppearance(settings, css, session.user.id ?? null);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === 'Forbidden') return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
