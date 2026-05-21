import { BRAND_VOICE_SETTINGS } from '@/app/design/settings/settings-constants';

export type BrandVoiceMap = Record<string, string>;

const BRAND_LABELS: Record<string, string> = Object.fromEntries(
  BRAND_VOICE_SETTINGS.map((s) => [s.id, s.label])
);

export function formatBrandVoiceForPrompt(brandVoice: BrandVoiceMap): string {
  const parts: string[] = [];
  for (const [id, value] of Object.entries(brandVoice)) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const label = BRAND_LABELS[id] ?? id;
    parts.push(`### ${label}\n${trimmed}`);
  }
  return parts.join('\n\n');
}

export function isWorkspaceEmpty(opts: {
  designMd: string;
  brandVoice: BrandVoiceMap;
  customFoundationImageUrl: string;
  componentReferences: Record<string, { imageUrl?: string }>;
}): boolean {
  const hasBrand = Object.values(opts.brandVoice).some((v) => v?.trim());
  const hasRefs = Object.values(opts.componentReferences).some((r) => r?.imageUrl?.trim());
  return (
    !opts.designMd.trim() &&
    !hasBrand &&
    !opts.customFoundationImageUrl.trim() &&
    !hasRefs
  );
}
