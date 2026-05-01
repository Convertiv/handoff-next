import { insertEventLog, type EventLogInsertInput } from '../db/event-log-store';

type AiPricing = {
  inputPer1M?: number;
  outputPer1M?: number;
  imagePerImage?: number;
};

const AI_PRICING_USD: Record<string, AiPricing> = {
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4o': { inputPer1M: 5, outputPer1M: 15 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-image-2': { imagePerImage: 0.04 },
};

const CHARS_PER_TOKEN_ESTIMATE = 4;
const REQUEST_PREVIEW_MAX_CHARS = 1000;
const ERROR_MAX_CHARS = 8000;

function truncate(value: string | undefined | null, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  const len = text.trim().length;
  if (len <= 0) return 0;
  return Math.max(1, Math.ceil(len / CHARS_PER_TOKEN_ESTIMATE));
}

function estimateAiCostUsd({
  model,
  inputTokens,
  outputTokens,
  imageCount,
}: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
}): number {
  const pricing = AI_PRICING_USD[model];
  if (!pricing) return 0;
  if (pricing.imagePerImage != null) {
    return Number((imageCount * pricing.imagePerImage).toFixed(6));
  }
  const inputCost = pricing.inputPer1M ? (inputTokens / 1_000_000) * pricing.inputPer1M : 0;
  const outputCost = pricing.outputPer1M ? (outputTokens / 1_000_000) * pricing.outputPer1M : 0;
  return Number((inputCost + outputCost).toFixed(6));
}

function isMissingRelationError(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '42P01' || err?.cause?.code === '42P01';
}

export async function logEvent(input: EventLogInsertInput): Promise<void> {
  try {
    await insertEventLog({
      ...input,
      status: input.status ?? 'success',
      error: truncate(input.error, ERROR_MAX_CHARS),
      requestPreview: truncate(input.requestPreview, REQUEST_PREVIEW_MAX_CHARS),
    });
  } catch (e) {
    // Logging must never break user flows.
    if (isMissingRelationError(e)) {
      console.warn(
        '[event-log] table handoff_event_log is missing. Run `npm run db:migrate` against this DATABASE_URL (migration 0009_event_log_if_missing creates it if needed).'
      );
      return;
    }
    console.error('[event-log] insert failed', e);
  }
}

export async function logAiEvent({
  eventType,
  actorUserId,
  route,
  model,
  durationMs,
  status,
  error,
  requestPrompt,
  responsePreview,
  usageInputTokens,
  usageOutputTokens,
  imageCount = 0,
  metadata,
}: {
  eventType: string;
  actorUserId?: string | null;
  route?: string | null;
  model: string;
  durationMs?: number;
  status: 'success' | 'error';
  error?: string | null;
  requestPrompt?: string | null;
  responsePreview?: string | null;
  usageInputTokens?: number | null;
  usageOutputTokens?: number | null;
  imageCount?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const estimatedInputTokens = usageInputTokens ?? estimateTokens(requestPrompt);
  const estimatedOutputTokens = usageOutputTokens ?? estimateTokens(responsePreview);
  const estimatedCostUsd = estimateAiCostUsd({
    model,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
    imageCount,
  });

  await logEvent({
    category: 'ai',
    eventType,
    status,
    actorUserId: actorUserId ?? null,
    route: route ?? null,
    provider: 'openai',
    model,
    durationMs: typeof durationMs === 'number' ? Math.max(0, Math.round(durationMs)) : null,
    error: error ?? null,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    requestPreview: requestPrompt ?? null,
    metadata: {
      ...(metadata ?? {}),
      imageCount,
    },
  });
}
