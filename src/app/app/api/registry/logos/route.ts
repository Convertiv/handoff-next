import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { getDb } from '@/lib/db';
import { handoffRegistryLogos } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SINGLETON_ID = 'default';

export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    const [row] = await db.select().from(handoffRegistryLogos).where(eq(handoffRegistryLogos.id, SINGLETON_ID)).limit(1);
    return NextResponse.json({ logoSet: row?.logoSet ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error', logoSet: null }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: { logoSet?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.logoSet || typeof body.logoSet !== 'object' || Array.isArray(body.logoSet)) {
    return NextResponse.json({ error: 'Expected { logoSet: object }' }, { status: 400 });
  }

  try {
    const db = getDb();
    await db
      .insert(handoffRegistryLogos)
      .values({ id: SINGLETON_ID, logoSet: body.logoSet, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: handoffRegistryLogos.id,
        set: { logoSet: body.logoSet, updatedAt: new Date() },
      });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
