import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { usePostgres } from '@/lib/db/dialect';
import { getDb } from '@/lib/db/index';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!usePostgres()) {
    return NextResponse.json({ error: 'Postgres required' }, { status: 400 });
  }

  let body: { name?: string; image?: string };
  try {
    body = (await request.json()) as { name?: string; image?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: Partial<{ name: string; image: string }> = {};
  if (typeof body.name === 'string') update.name = body.name.trim().slice(0, 100) || null as unknown as string;
  if (typeof body.image === 'string') update.image = body.image.trim().slice(0, 500) || null as unknown as string;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const db = getDb();
  await db.update(users).set(update).where(eq(users.id, session.user.id));

  return NextResponse.json({ ok: true });
}
