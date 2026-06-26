/**
 * Golden prompt set (Phase E1). Registry-agnostic prompts; expectations are
 * *kinds* of markers checked against the live registry ground truth (not
 * hardcoded values), so the set stays valid as a registry's tokens change.
 *
 * Extend freely — the roadmap targets ~20. This is a strong seed across the
 * four categories the tool surface must serve.
 */
import type { GoldenPrompt } from './score';

export const GOLDEN_PROMPTS: GoldenPrompt[] = [
  // ── Token lookup ──────────────────────────────────────────────────────────
  { id: 'colors-primary', category: 'token', prompt: 'What are the primary brand colors and their hex values in this design system?', expect: ['brandColor'] },
  { id: 'colors-error', category: 'token', prompt: 'What color should I use for error / destructive states?', expect: ['brandColor'] },
  { id: 'spacing-scale', category: 'token', prompt: 'What spacing tokens are available? I need to set padding on a section.', expect: ['spacingVar'] },
  { id: 'radius-scale', category: 'token', prompt: 'What border-radius values does this design system define?', expect: ['tokenName'] },
  { id: 'type-base', category: 'token', prompt: 'What is the base body font and the heading type scale?', expect: ['tokenName'] },

  // ── Component generation ────────────────────────────────────────────────────
  { id: 'build-button', category: 'component', prompt: 'Build a primary button using this design system. Output the markup and any styles.', expect: ['brandColor', 'componentId'] },
  { id: 'build-hero', category: 'component', prompt: 'Build a hero section with a headline, subheading, and a primary CTA, using the design system.', expect: ['brandColor', 'spacingVar'] },
  { id: 'build-card', category: 'component', prompt: 'Create a card component for a blog post (image, title, excerpt, link) using the design system.', expect: ['componentId', 'tokenName'] },
  { id: 'list-nav', category: 'component', prompt: 'What components are available for navigation?', expect: ['componentId'] },
  { id: 'list-components', category: 'component', prompt: 'List the components available in this design system.', expect: ['componentId'] },

  // ── Icon / logo lookup ──────────────────────────────────────────────────────
  { id: 'icon-search', category: 'icon', prompt: 'I need a search (magnifying glass) icon. What is available in this design system?', expect: ['iconName'] },
  { id: 'icon-category', category: 'icon', prompt: 'What interface icons does the design system provide?', expect: ['iconName'] },

  // ── Brand framing ───────────────────────────────────────────────────────────
  { id: 'brand-tone', category: 'brand', prompt: "What is this brand's voice and tone for copy?", expect: ['brandPrinciple'] },
  { id: 'brand-cta', category: 'brand', prompt: 'Write an H1 headline and CTA label for a "request a demo" landing page, matching the brand voice.', expect: ['brandPrinciple'] },
  { id: 'brand-error-copy', category: 'brand', prompt: 'Write a short error message for a failed form submission, in the brand voice.', expect: ['brandPrinciple'] },
];
