import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  handoffComponentVersions,
  handoffComponents,
  handoffTokenChanges,
  handoffPageChanges,
} from '@/lib/db/schema-pg';
import { isServerAiConfigured, openAiChatJson } from './ai-client';

export type ChangeEntityType = 'component' | 'token' | 'page';

export interface ChangeWhyResult {
  /** The "why" text — human message if present, else the AI draft. */
  summary: string | null;
  /** Where the summary came from. */
  source: 'message' | 'ai' | 'none';
  aiEnabled: boolean;
}

const MAX_DETAIL_ITEMS = 12;

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function valueToText(v: unknown): string {
  if (v == null) return '∅';
  if (typeof v === 'string') return truncate(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return truncate(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

/** Compact, factual description of a change for the model to summarize. */
function describeComponent(row: typeof handoffComponentVersions.$inferSelect, title: string): string {
  const cs = (row.changeSummary ?? {}) as Record<string, unknown>;
  const parts: string[] = [`Component "${title}" version ${row.versionNumber} (trigger: ${row.trigger}).`];
  if (cs.firstVersion) parts.push('First version (initial push).');
  const fields = Array.isArray(cs.fieldsChanged) ? (cs.fieldsChanged as string[]) : [];
  if (fields.length) parts.push(`Metadata fields changed: ${fields.join(', ')}.`);
  const add = (cs.sourceAdded as string[]) ?? [];
  const mod = (cs.sourceModified as string[]) ?? [];
  const rem = (cs.sourceRemoved as string[]) ?? [];
  if (add.length || mod.length || rem.length) {
    parts.push(
      `Source files — added: [${add.slice(0, MAX_DETAIL_ITEMS).join(', ')}]; modified: [${mod
        .slice(0, MAX_DETAIL_ITEMS)
        .join(', ')}]; removed: [${rem.slice(0, MAX_DETAIL_ITEMS).join(', ')}].`
    );
  }
  if (cs.artifactsChanged) parts.push('Build artifacts were rebuilt.');
  return parts.join(' ');
}

function describeToken(row: typeof handoffTokenChanges.$inferSelect): string {
  const d = (row.changeDetails ?? {}) as {
    added?: Record<string, unknown>;
    removed?: Record<string, unknown>;
    modified?: Record<string, { before: unknown; after: unknown }>;
  };
  const parts: string[] = [`Token push (trigger: ${row.trigger}).`];
  const mod = Object.entries(d.modified ?? {}).slice(0, MAX_DETAIL_ITEMS);
  if (mod.length) {
    parts.push(
      `Modified: ${mod.map(([k, v]) => `${k} ${valueToText(v.before)} → ${valueToText(v.after)}`).join('; ')}.`
    );
  }
  const added = Object.entries(d.added ?? {}).slice(0, MAX_DETAIL_ITEMS);
  if (added.length) parts.push(`Added: ${added.map(([k, v]) => `${k}=${valueToText(v)}`).join('; ')}.`);
  const removed = Object.keys(d.removed ?? {}).slice(0, MAX_DETAIL_ITEMS);
  if (removed.length) parts.push(`Removed: ${removed.join(', ')}.`);
  if (!mod.length && !added.length && !removed.length) {
    parts.push(`+${row.addedCount} added, ~${row.modifiedCount} modified, -${row.removedCount} removed.`);
  }
  return parts.join(' ');
}

function describePage(row: typeof handoffPageChanges.$inferSelect): string {
  const parts: string[] = [`Page "${row.slug}" ${row.action} (trigger: ${row.trigger}).`];
  if (row.titleBefore || row.titleAfter) {
    parts.push(`Title: "${row.titleBefore ?? '∅'}" → "${row.titleAfter ?? '∅'}".`);
  }
  if (row.markdownLengthBefore != null || row.markdownLengthAfter != null) {
    parts.push(`Body length: ${row.markdownLengthBefore ?? 0} → ${row.markdownLengthAfter ?? 0} chars.`);
  }
  return parts.join(' ');
}

/** Load a change row's existing message/ai_summary + a diff description. */
async function loadChange(
  entityType: ChangeEntityType,
  id: number
): Promise<{ message: string | null; aiSummary: string | null; diffText: string } | null> {
  const db = getDb();
  if (entityType === 'component') {
    const [row] = await db.select().from(handoffComponentVersions).where(eq(handoffComponentVersions.id, id)).limit(1);
    if (!row) return null;
    const snap = (row.snapshot ?? {}) as { title?: string };
    let title = snap.title ?? row.componentId;
    if (!snap.title) {
      const [c] = await db.select({ title: handoffComponents.title }).from(handoffComponents).where(eq(handoffComponents.id, row.componentId)).limit(1);
      title = c?.title ?? row.componentId;
    }
    return { message: row.message ?? null, aiSummary: row.aiSummary ?? null, diffText: describeComponent(row, title) };
  }
  if (entityType === 'token') {
    const [row] = await db.select().from(handoffTokenChanges).where(eq(handoffTokenChanges.id, id)).limit(1);
    if (!row) return null;
    return { message: row.message ?? null, aiSummary: row.aiSummary ?? null, diffText: describeToken(row) };
  }
  const [row] = await db.select().from(handoffPageChanges).where(eq(handoffPageChanges.id, id)).limit(1);
  if (!row) return null;
  return { message: row.message ?? null, aiSummary: row.aiSummary ?? null, diffText: describePage(row) };
}

async function storeAiSummary(entityType: ChangeEntityType, id: number, summary: string): Promise<void> {
  const db = getDb();
  if (entityType === 'component') {
    await db.update(handoffComponentVersions).set({ aiSummary: summary }).where(eq(handoffComponentVersions.id, id));
  } else if (entityType === 'token') {
    await db.update(handoffTokenChanges).set({ aiSummary: summary }).where(eq(handoffTokenChanges.id, id));
  } else {
    await db.update(handoffPageChanges).set({ aiSummary: summary }).where(eq(handoffPageChanges.id, id));
  }
}

const SYSTEM_PROMPT =
  'You write a single concise sentence for a design-system changelog explaining WHAT changed and, ' +
  'only where the diff makes it clear, the LIKELY intent. Be specific and factual — cite the actual ' +
  'fields/tokens/values from the diff. Do NOT invent motivations the diff does not support. No preamble. ' +
  'Respond as JSON: {"summary": "<one sentence>"}.';

/**
 * Resolve the "why" for a change. Returns the human message if one was authored;
 * otherwise generates (and caches) an AI draft from the diff. Caching means the
 * model is called at most once per change, lazily, only when someone views it.
 */
export async function resolveChangeWhy(params: {
  entityType: ChangeEntityType;
  id: number;
  actorUserId?: string | null;
  /** When false, never call the model — just return an existing message/draft. */
  generate?: boolean;
}): Promise<ChangeWhyResult> {
  const aiEnabled = isServerAiConfigured();
  const change = await loadChange(params.entityType, params.id);
  if (!change) return { summary: null, source: 'none', aiEnabled };

  if (change.message && change.message.trim()) {
    return { summary: change.message.trim(), source: 'message', aiEnabled };
  }
  if (change.aiSummary && change.aiSummary.trim()) {
    return { summary: change.aiSummary.trim(), source: 'ai', aiEnabled };
  }
  if (!aiEnabled || params.generate === false) {
    return { summary: null, source: 'none', aiEnabled };
  }

  try {
    const raw = await openAiChatJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: change.diffText },
      ],
      { actorUserId: params.actorUserId ?? null, route: '/api/handoff/changes/why', eventType: 'change_why', maxTokens: 200 }
    );
    const parsed = JSON.parse(raw) as { summary?: unknown };
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!summary) return { summary: null, source: 'none', aiEnabled };
    await storeAiSummary(params.entityType, params.id, summary);
    return { summary, source: 'ai', aiEnabled };
  } catch {
    // AI failure is non-fatal — the change is still legible without a "why".
    return { summary: null, source: 'none', aiEnabled };
  }
}
