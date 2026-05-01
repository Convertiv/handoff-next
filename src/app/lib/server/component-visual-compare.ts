import 'server-only';

import type { ChatMessage, ImageContent } from '@/lib/server/ai-client';
import { openAiChatJson } from '@/lib/server/ai-client';
import { imageUrlToVisionPart } from '@/lib/server/component-generation-images';

function pngBufferToImagePart(buf: Buffer): ImageContent {
  const b64 = buf.toString('base64');
  return {
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${b64}`, detail: 'high' },
  };
}

export type VisualCompareResult = {
  score: number;
  differences: string[];
  a11yNotes: string[];
  a11yPassed: boolean;
};

export async function compareDesignToPreviewScreenshot(opts: {
  designImageUrl: string;
  previewPng: Buffer;
  actorUserId?: string | null;
  a11yStandard: string;
}): Promise<VisualCompareResult> {
  const designPart = await imageUrlToVisionPart(opts.designImageUrl);
  const previewPart = pngBufferToImagePart(opts.previewPng);

  const a11yBlock =
    opts.a11yStandard === 'none'
      ? 'Accessibility: not required for pass/fail; still note any obvious issues.'
      : opts.a11yStandard === 'wcag-aaa'
        ? 'Accessibility: evaluate against WCAG 2.1 AAA where inferable from pixels (contrast, text size, focus visibility).'
        : 'Accessibility: evaluate against WCAG 2.1 AA where inferable from pixels (contrast, text size, touch targets).';

  const system = `You compare a **target design** image with a **built component preview** screenshot (PNG).
Return JSON only with this exact shape:
{
  "score": <number 0-1 where 1 is perfect visual match>,
  "differences": [<string>, ...] (specific visual deltas: layout, spacing, typography, color, missing elements),
  "a11yNotes": [<string>, ...] (issues visible from screenshots only),
  "a11yPassed": <boolean> (true if no likely WCAG failures visible for the chosen standard)
}
${a11yBlock}
Be strict on layout and typography; ignore lorem vs real copy differences if structure matches.`;

  const userContent: ChatMessage['content'] = [
    { type: 'text', text: 'Image 1: target design. Image 2: built preview.' },
  ];
  if (designPart) userContent.push(designPart);
  else userContent.push({ type: 'text', text: '(Design image could not be loaded — score conservatively.)' });
  userContent.push(previewPart);

  const raw = await openAiChatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    {
      actorUserId: opts.actorUserId,
      route: 'component-visual-compare',
      eventType: 'ai.component_visual_compare',
      model: process.env.HANDOFF_VISION_MODEL?.trim() || 'gpt-4o',
      maxTokens: 2048,
    }
  );

  try {
    let slice = raw.trim();
    const fence = slice.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) slice = fence[1]!.trim();

    const parsed = JSON.parse(slice) as Partial<VisualCompareResult>;
    let score = 0;
    if (typeof parsed.score === 'number' && Number.isFinite(parsed.score)) {
      score = Math.min(1, Math.max(0, parsed.score));
    } else if (typeof parsed.score === 'string') {
      const n = Number(parsed.score);
      if (Number.isFinite(n)) score = Math.min(1, Math.max(0, n));
    }
    const differences = Array.isArray(parsed.differences) ? parsed.differences.map(String) : [];
    const a11yNotes = Array.isArray(parsed.a11yNotes) ? parsed.a11yNotes.map(String) : [];
    const a11yPassed = Boolean(parsed.a11yPassed);
    return { score, differences, a11yNotes, a11yPassed };
  } catch {
    return { score: 0, differences: ['Could not parse vision model response.'], a11yNotes: [], a11yPassed: false };
  }
}
