import 'server-only';

import { insertDesignArtifact } from '@/lib/db/queries';
import { startDevPipeline } from '@/lib/server/dev-pipeline';

/**
 * Start a design from a brief — the top of the spec-first chain.
 *
 * The existing create flow generates an image from the prompt, and everything downstream then works
 * backwards from that image: the specification is written by reading the composite, and the assets the
 * spec "declares" are regenerated afterwards from a description of imagery the composite already
 * contains. Those assets can never match, because the asset generator has never seen the design.
 *
 * This runs the chain the way the product describes it:
 *
 *   brief → specification → assets → composite
 *
 * The artifact is created with **no image**. That is the point, not an omission: the image is produced
 * by the last stage, as a rendering of the specification, so revising the spec re-renders rather than
 * re-rolls, and the photograph in the comp is the same file a developer downloads.
 *
 * Returns immediately with the artifact and pipeline ids. The stages are individually long (asset
 * generation measured 114s, the composite 100s) and run one per invocation on the design-jobs cron —
 * awaiting them in a request would guarantee a timeout.
 */

export interface BriefDesignResult {
  ok: boolean;
  artifactId?: string;
  pipelineId?: string;
  stages?: string[];
  error?: string;
}

export async function startDesignFromBrief(args: {
  brief: string;
  userId: string;
  title?: string;
  /** Component ids to compose against, matching the existing generation flow's `componentGuides`. */
  componentGuides?: unknown;
  visibility?: string;
}): Promise<BriefDesignResult> {
  const brief = args.brief.trim();
  if (!brief) return { ok: false, error: 'Describe what you want designed.' };
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return { ok: false, error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' };
  }

  const title = (args.title ?? '').trim() || titleFromBrief(brief);

  const artifactId = await insertDesignArtifact({
    title,
    description: brief,
    userId: args.userId,
    // No image yet — the composite stage produces it. An empty string is the column's own default, so
    // this is a legitimate state rather than a half-written row.
    imageUrl: '',
    componentGuides: args.componentGuides ?? [],
    // Recorded in the shape the rest of the pipeline reads, so `briefFromArtifact` and the copy
    // extraction find it exactly as they would for a prompt-generated design.
    conversationHistory: [{ role: 'user', prompt: brief, timestamp: new Date().toISOString() }],
    specStatus: 'pending',
    assetsStatus: 'none',
    status: 'draft',
    visibility: args.visibility,
  });

  if (!artifactId) return { ok: false, error: 'Could not create the design.' };

  const started = await startDevPipeline({ artifactId, intent: 'spec-first' });
  if (!started.ok) {
    // The artifact exists and holds the brief, so this is recoverable by re-running the pipeline —
    // say so rather than implying the whole request was lost.
    return { ok: false, artifactId, error: `${started.error} The brief was saved — re-run the pipeline on this design.` };
  }

  return { ok: true, artifactId, pipelineId: started.pipelineId, stages: started.stages };
}

/**
 * A readable title from the brief's opening words.
 *
 * Better than "Draft — 7/29/2026": a spec-first design is identified by its brief long before it has an
 * image to recognise it by, and an untitled row is unfindable in the library.
 */
function titleFromBrief(brief: string): string {
  const firstLine = brief.split('\n').find((l) => l.trim())?.trim() ?? brief.trim();
  const words = firstLine.split(/\s+/).slice(0, 8).join(' ');
  const clipped = words.length < firstLine.length ? `${words}…` : words;
  return clipped.slice(0, 120) || 'Untitled design';
}
