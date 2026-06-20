import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { getDb } from '@/lib/db';
import { handoffRegistryIcons } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SINGLETON_ID = 'default';

export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    const [row] = await db.select().from(handoffRegistryIcons).where(eq(handoffRegistryIcons.id, SINGLETON_ID)).limit(1);
    return NextResponse.json({ catalog: row?.catalog ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error', catalog: [] }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: { catalog?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.catalog)) {
    return NextResponse.json({ error: 'Expected { catalog: IconCatalogEntry[] }' }, { status: 400 });
  }

  try {
    const db = getDb();
    await db
      .insert(handoffRegistryIcons)
      .values({ id: SINGLETON_ID, catalog: body.catalog, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: handoffRegistryIcons.id,
        set: { catalog: body.catalog, updatedAt: new Date() },
      });
    return NextResponse.json({ ok: true, count: (body.catalog as unknown[]).length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
