import { getDb } from './index';
import { handoffEventLog } from './schema';

export type EventLogInsertInput = {
  category: string;
  eventType: string;
  status?: string;
  actorUserId?: string | null;
  route?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  durationMs?: number | null;
  error?: string | null;
  provider?: string | null;
  model?: string | null;
  estimatedInputTokens?: number | null;
  estimatedOutputTokens?: number | null;
  estimatedCostUsd?: number | null;
  requestPreview?: string | null;
  metadata?: Record<string, unknown>;
};

export async function insertEventLog(input: EventLogInsertInput): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .insert(handoffEventLog)
    .values({
      category: input.category,
      eventType: input.eventType,
      status: input.status ?? 'success',
      actorUserId: input.actorUserId ?? null,
      route: input.route ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      durationMs: input.durationMs ?? null,
      error: input.error ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      estimatedInputTokens: input.estimatedInputTokens ?? null,
      estimatedOutputTokens: input.estimatedOutputTokens ?? null,
      estimatedCostUsd: input.estimatedCostUsd != null ? String(input.estimatedCostUsd) : null,
      requestPreview: input.requestPreview ?? null,
      metadata: input.metadata ?? {},
    })
    .returning({ id: handoffEventLog.id });
  return row?.id ?? null;
}
