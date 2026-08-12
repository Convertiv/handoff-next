import { collectEditableText, mergeBlockArgs, type PatternComponentEntry } from '@/lib/guest-editable';
import type { AuditFinding } from '@/lib/build-audits';
import { isServerAiConfigured, openAiChatJson } from './ai-client';

/**
 * The `voice` audit — the one E.10 deliberately left empty.
 *
 * `build-audits.ts` declares `voice` as a category and produces nothing, with the reason written down: *"checking
 * copy against a brand voice is a judgement an LLM makes against the brand-voice document, not something a regex
 * can assert. Shipping a fake version of it would be worse than an empty section that says so."* This is that
 * judgement, made by the model that can make it.
 *
 * **It returns `AuditFinding[]`, so the UI cost is zero.** The build view already renders that shape, already
 * groups by category, and `FindingsList` already makes each row jump to its field. Filling an existing hole beats
 * inventing a parallel one.
 *
 * **On demand, not on every render.** Every other check here is deterministic and free; this one costs money and
 * about a second. A reviewer asks for it — see the route — rather than paying for it on page load, and a build
 * that nobody reviews costs nothing.
 *
 * **Nothing is invented, same as the rest of the guardrail work.** The model is asked to quote the copy it is
 * objecting to, and `parseVoiceFindings` discards any finding whose path is not a field that actually exists on
 * the page. A hallucinated field name produces silence, not a phantom row pointing at nothing.
 */

/** The brand-voice document, as the design workspace stores it — free-text fields, all optional. */
export type BrandVoice = Record<string, string>;

/** One field of copy on the page, with where it lives. */
interface CopyItem {
  /**
   * Unique across the page, as `<blockIndex>.<path>`.
   *
   * ⚠️ **A path alone is not unique** — two blocks both having `title` is the normal case, not an edge case, and
   * keying on path meant a finding about block 0's title silently resolved to block 1's. Caught by running the
   * real prompt over a real two-block page. This is the id the model is asked to quote back.
   */
  ref: string;
  blockIndex: number;
  componentId: string;
  path: string;
  label: string;
  value: string;
}

/**
 * Paths that hold a reference rather than copy.
 *
 * A URL is not prose: sending it wastes tokens and invites a confident finding about a link that reads perfectly
 * well as a link. Same judgement as `isReferenceField` in `content-length-plan.ts`, applied at collection.
 */
const REFERENCE_PATH = /(^|[._])(url|href|src|image|icon|video|file|path)([._]|$)/i;

/** Every authored string on the page, with its block and path — the same collector the guardrails use. */
export function collectPageCopy(blocks: PatternComponentEntry[], overrides: unknown[]): CopyItem[] {
  const out: CopyItem[] = [];
  blocks.forEach((entry, blockIndex) => {
    const args = mergeBlockArgs(entry, overrides[blockIndex]);
    for (const field of collectEditableText(args)) {
      const path = field.path.join('.');
      if (REFERENCE_PATH.test(path)) continue;
      out.push({
        ref: `${blockIndex}.${path}`,
        blockIndex,
        componentId: entry.id,
        path,
        label: field.label,
        value: field.value,
      });
    }
  });
  return out;
}

/** The brand-voice fields worth sending, in a stable order, skipping the empty ones. */
const VOICE_FIELDS = [
  'voiceTone',
  'copyDirection',
  'copyLength',
  'preferredPhrases',
  'avoidedPhrases',
  'companyDescription',
] as const;

export function buildVoicePrompt(copy: CopyItem[], voice: BrandVoice): { system: string; user: string } {
  const guide = VOICE_FIELDS.filter((k) => voice[k]?.trim())
    .map((k) => `## ${k}\n${voice[k].trim()}`)
    .join('\n\n');

  const system = [
    'You review website copy against a brand voice guide.',
    'Report only concrete, actionable problems: a phrase the guide forbids, a tone that contradicts it, copy far',
    'outside the stated length, or a call to action that breaks the stated pattern.',
    'Do NOT report matters of taste, spelling, or anything the guide does not actually address.',
    'It is correct and expected to return an empty list when the copy is fine.',
    'Respond with JSON: {"findings":[{"ref":"<exact ref given>","message":"<one sentence, naming the problem and quoting the offending words>"}]}',
  ].join(' ');

  const fields = copy
    .map((c) => `- ref: ${c.ref}\n  field: ${c.label}\n  copy: ${JSON.stringify(c.value)}`)
    .join('\n');

  const user = `# Brand voice guide\n\n${guide || '(none provided)'}\n\n# Copy on the page\n\n${fields}\n\nReturn only findings whose \`ref\` appears above, exactly as written.`;
  return { system, user };
}

/**
 * The model's JSON → findings, keeping only what maps to a real field.
 *
 * **This is the part that must not trust the model.** A hallucinated `path` would render a row that jumps nowhere,
 * and a missing `message` would render an empty bullet — both read as the feature being broken rather than the
 * model being wrong. Anything unrecognised is dropped silently, which is the same "nothing is invented" rule the
 * deterministic checks follow.
 */
export function parseVoiceFindings(raw: string, copy: CopyItem[]): AuditFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return [];

  const byRef = new Map(copy.map((c) => [c.ref, c]));
  const seen = new Set<string>();
  const out: AuditFinding[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { ref, message } = item as { ref?: unknown; message?: unknown };
    if (typeof ref !== 'string' || typeof message !== 'string') continue;
    const trimmed = message.trim();
    if (!trimmed) continue;

    const field = byRef.get(ref);
    // A ref the page does not have: the model invented it, so it says nothing.
    if (!field) continue;
    // One finding per field — a model asked for problems will happily list the same one twice.
    if (seen.has(ref)) continue;
    seen.add(ref);

    out.push({
      category: 'voice',
      code: 'voice-mismatch',
      path: field.path,
      label: field.label,
      blockIndex: field.blockIndex,
      componentId: field.componentId,
      message: trimmed.slice(0, 400),
    });
  }
  return out;
}

/**
 * Run the check. Returns `[]` rather than throwing when there is nothing to do — no AI configured, no brand voice,
 * or no copy — so a caller never has to distinguish "clean" from "not run" by catching.
 */
export async function auditVoice(input: {
  blocks: PatternComponentEntry[];
  overrides: unknown[];
  voice: BrandVoice;
  actorUserId?: string | null;
}): Promise<{ findings: AuditFinding[]; ran: boolean; reason?: string }> {
  if (!isServerAiConfigured()) return { findings: [], ran: false, reason: 'Server AI is not configured.' };

  const hasVoice = VOICE_FIELDS.some((k) => input.voice?.[k]?.trim());
  if (!hasVoice) {
    return { findings: [], ran: false, reason: 'No brand voice has been written yet — there is nothing to check against.' };
  }

  const copy = collectPageCopy(input.blocks, input.overrides);
  if (!copy.length) return { findings: [], ran: false, reason: 'This page has no copy to check.' };

  const { system, user } = buildVoicePrompt(copy, input.voice);
  const raw = await openAiChatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { actorUserId: input.actorUserId ?? null, route: 'voice-audit', eventType: 'voice_audit', maxTokens: 2048 }
  );

  return { findings: parseVoiceFindings(raw, copy), ran: true };
}
