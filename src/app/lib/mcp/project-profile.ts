import 'server-only';

export const STACK_PROFILES = ['bootstrap-handlebars', 'react-tailwind', 'react-scss', 'tailwind-handlebars'] as const;
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

/**
 * Per-profile translation guidance. Previously only `react-tailwind` was special-cased and every
 * other profile — including `react-scss` and `tailwind-handlebars` — fell through to the Handlebars
 * rules, i.e. React projects were being told to write Handlebars templates.
 */
const TRANSLATION_RULES: Record<StackProfile, string[]> = {
  'bootstrap-handlebars': ['Use Handlebars templates, Bootstrap 5 utilities, and SCSS with var(--color-*) tokens.'],
  'react-tailwind': ['Use React TSX and Tailwind utilities; map tokens to CSS variables or theme config.'],
  'react-scss': ['Use React TSX with SCSS modules; reference tokens via var(--color-*) rather than hard-coded values.'],
  'tailwind-handlebars': ['Use Handlebars templates with Tailwind utilities; map tokens to CSS variables.'],
};

/**
 * ⚠️ `FALLBACK_STACK_PROFILE` is a last resort, not a sensible default.
 *
 * Any registry that sets neither an explicit profile nor `HANDOFF_DEFAULT_STACK_PROFILE` will claim
 * this stack — which is how the 8x8 registry (React + Tailwind) came to report
 * `bootstrap-handlebars` and hand out Handlebars translation rules. Code generation and
 * `handoff_get_stack_guide` both read this, so a wrong value makes every generated component wrong
 * for reasons unrelated to the generator.
 *
 * **Set `HANDOFF_DEFAULT_STACK_PROFILE` per deployment.** A mismatch is logged once per process
 * below so it is discoverable rather than silent.
 */
const FALLBACK_STACK_PROFILE: StackProfile = 'bootstrap-handlebars';

let warnedMissingProfile = false;

export function resolveStackProfile(input?: string | null): StackProfile {
  const envDefault = process.env.HANDOFF_DEFAULT_STACK_PROFILE?.trim();
  const raw = input?.trim() || envDefault;
  if (raw && (STACK_PROFILES as readonly string[]).includes(raw)) return raw as StackProfile;

  if (raw && !warnedMissingProfile) {
    warnedMissingProfile = true;
    console.warn(
      `[project-profile] unknown stack profile "${raw}" — falling back to "${FALLBACK_STACK_PROFILE}". Valid: ${STACK_PROFILES.join(', ')}`
    );
  } else if (!raw && !warnedMissingProfile) {
    warnedMissingProfile = true;
    console.warn(
      `[project-profile] HANDOFF_DEFAULT_STACK_PROFILE is not set — falling back to "${FALLBACK_STACK_PROFILE}". ` +
        `Set it per deployment or generated code will target the wrong stack. Valid: ${STACK_PROFILES.join(', ')}`
    );
  }
  return FALLBACK_STACK_PROFILE;
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
    translationRules: TRANSLATION_RULES[stackProfile],
  };
}
