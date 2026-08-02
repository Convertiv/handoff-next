import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { handoffEventLog } from '@/lib/db/schema';
import { describeTurn, flagsFor, type TurnFacts } from '@/lib/turn-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recent playground chat turns — what each one did, and whether anything is wrong with it.
 *
 * Exists because the iteration loop was the bottleneck. Four attempts at one behaviour in an evening,
 * three of which made it worse, because the only visible output was the assistant's prose — and prose is
 * exactly what goes wrong. A page was narrated in detail that had never been proposed, and nothing in
 * the reply showed that `propose_page` had been called, rejected by a retry, and abandoned.
 *
 * One run against this endpoint answers that. It also accumulates, so a regression shows up as a rising
 * count of `noProposal` or `strandedImages` rather than as somebody noticing.
 *
 * Auth matches `/api/admin/field-bridge-audit`: an admin session, or `HANDOFF_SYNC_SECRET` as bearer.
 *
 *   ?limit=20        how many turns (default 20)
 *   ?failing=1       only turns with a flag set
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  const isAdmin = session?.user?.id ? session.user.role === 'admin' : false;

  if (!isAdmin) {
    const secret = process.env.HANDOFF_SYNC_SECRET?.trim();
    const header = request.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!secret || token !== secret) {
      return NextResponse.json(
        { error: session?.user?.id ? 'Forbidden — admin only.' : 'Unauthorized.' },
        { status: session?.user?.id ? 403 : 401 }
      );
    }
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 200);
  const failingOnly = url.searchParams.get('failing') === '1';

  const rows = await getDb()
    .select({ id: handoffEventLog.id, createdAt: handoffEventLog.createdAt, metadata: handoffEventLog.metadata })
    .from(handoffEventLog)
    .where(eq(handoffEventLog.eventType, 'ai.playground_turn'))
    .orderBy(desc(handoffEventLog.id))
    .limit(limit);

  const turns = rows.map((row) => {
    const facts = (row.metadata ?? {}) as unknown as TurnFacts;
    const flags = flagsFor(facts);
    return {
      id: row.id,
      at: row.createdAt,
      prompt: facts.prompt,
      summary: describeTurn(facts),
      flags,
      failing: Object.values(flags).some(Boolean),
      facts,
    };
  });

  const shown = failingOnly ? turns.filter((t) => t.failing) : turns;

  /** Rates rather than raw counts, so a regression is visible without comparing two dumps by eye. */
  const total = turns.length || 1;
  const rate = (n: number) => `${Math.round((n / total) * 100)}%`;

  return NextResponse.json({
    summary: {
      turns: turns.length,
      failing: turns.filter((t) => t.failing).length,
      noProposal: rate(turns.filter((t) => t.flags.noProposal).length),
      strandedImages: rate(turns.filter((t) => t.flags.strandedImages).length),
      exhausted: rate(turns.filter((t) => t.flags.exhausted).length),
      contested: rate(turns.filter((t) => t.flags.contested).length),
    },
    turns: shown,
  });
}
