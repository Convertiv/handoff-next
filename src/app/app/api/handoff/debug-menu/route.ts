import { NextResponse } from 'next/server';
import { getDataProvider } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Temporary debug: exposes the menu tree returned by getDataProvider().getMenu(). Remove after diagnosis. */
export async function GET(): Promise<Response> {
  try {
    const menu = await getDataProvider().getMenu();
    return NextResponse.json({
      count: menu.length,
      sections: menu.map((s) => ({
        title: s.title,
        path: s.path,
        subSectionCount: (s.subSections ?? []).length,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
