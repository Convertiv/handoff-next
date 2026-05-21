import 'server-only';

export const STACK_PROFILES = ['bootstrap-handlebars', 'react-tailwind', 'react-scss'] as const;
export type StackProfile = (typeof STACK_PROFILES)[number];

export type HandoffProjectProfile = {
  name: string;
  stackProfile: StackProfile;
  figmaFileKey?: string | null;
  paths: {
    components: string[];
    patterns: string[];
    pages: string[];
  };
  translationRules?: string[];
};

export function resolveStackProfile(input?: string | null): StackProfile {
  const envDefault = process.env.HANDOFF_DEFAULT_STACK_PROFILE?.trim();
  const raw = input?.trim() || envDefault || 'bootstrap-handlebars';
  if ((STACK_PROFILES as readonly string[]).includes(raw)) return raw as StackProfile;
  return 'bootstrap-handlebars';
}

export function buildProjectContext(opts?: {
  projectName?: string | null;
  stackProfile?: string | null;
}): HandoffProjectProfile {
  const stackProfile = resolveStackProfile(opts?.stackProfile);
  return {
    name: opts?.projectName?.trim() || process.env.HANDOFF_PROJECT_NAME?.trim() || 'default',
    stackProfile,
    figmaFileKey: process.env.HANDOFF_FIGMA_PROJECT_ID?.trim() || null,
    paths: {
      components: ['./components'],
      patterns: [],
      pages: ['./pages'],
    },
    translationRules:
      stackProfile === 'react-tailwind'
        ? ['Use React TSX and Tailwind utilities; map tokens to CSS variables or theme config.']
        : ['Use Handlebars templates, Bootstrap 5 utilities, and SCSS with var(--color-*) tokens.'],
  };
}
