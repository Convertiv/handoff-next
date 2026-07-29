/** One observed design value resolved (or not) against a registry token. */
export interface TokenMatch {
  /** The literal value read off the design, e.g. "#EBEAE1", "32px", "PP Telegraf 48/56". */
  observed: string;
  /** Where it appears, e.g. "section background", "headline", "gap between CTAs". */
  usage: string;
  /** Registry token name when matched, else null (off-system). */
  token: string | null;
  /** How to reference it in code — `var(--…)` / sass var / DTCG path. Null when unmatched. */
  reference: string | null;
  /** `exact` = same value · `close` = near a token, likely should snap to it · `none` = off-system. */
  matchLevel: 'exact' | 'close' | 'none';
  /** Required when matchLevel is not `exact`: why, and what the developer should do. */
  note?: string;
}

/** One brand-voice check against a piece of copy in the design. */
export interface VoiceFinding {
  text: string;
  /** heading | subhead | cta | body | label */
  role: string;
  verdict: 'pass' | 'warn' | 'fail';
  /** Which guideline was applied: `banned-phrase` | `length` | `tone` | `preferred-phrase`. */
  rule: string;
  detail: string;
  /** Concrete rewrite when the verdict is warn/fail. */
  suggestion?: string;
}

/** Structured component specification generated from a design artifact. */
export interface ComponentSpec {
  version: 1;
  generatedAt: string;

  overview: {
    name: string;
    description: string;
    /** atom | molecule | organism | template | pattern | other */
    type: string;
    /** e.g. "Inputs", "Navigation", "Feedback" */
    designSystemGroup: string;
    summary: string;
  };

  variants: {
    /** Matches extracted asset key, e.g. "state_hover" */
    key: string;
    name: string;
    description: string;
    isDefault?: boolean;
  }[];

  props: {
    name: string;
    /** string | boolean | enum | number | ReactNode | function */
    type: string;
    required: boolean;
    defaultValue?: string;
    /** For enum types */
    options?: string[];
    description: string;
  }[];

  behavior: {
    interactions: { trigger: string; action: string }[];
    transitions: string[];
    edgeCases: string[];
  };

  accessibility: {
    ariaRole: string;
    requiredAriaAttributes: string[];
    keyboardNav: { key: string; action: string }[];
    screenReaderNotes: string;
    /** A | AA | AAA | none */
    wcagTarget: string;
  };

  content: {
    textInventory: {
      text: string;
      /** heading | label | button | body | placeholder | error | badge | helper | link */
      role: string;
      /** "primary CTA", "form field label", "error message" */
      location: string;
      /** Is this typically a prop value or hardcoded? */
      editable: boolean;
    }[];
    /** UI copy strings extracted from the conversation prompt history */
    copyFromPrompt: string[];
    rules: { field: string; maxLength?: number; notes: string }[];
  };

  /**
   * What already exists that could build this instead of writing something new.
   *
   * The point of the whole system is to steer toward composition over invention: the workbench
   * generates net-new, the playground composes what's already there, and this section is the
   * bridge between them. `implementation.existingComponentMatches` answers "which component IS
   * this" with full prop mappings, but only when component guides were attached up front. This
   * answers the broader and more common question — "what could I build this FROM" — against the
   * full component and pattern catalog, with no setup required.
   */
  reuse?: {
    /** Existing components that could serve as parts of this design. */
    candidates: {
      componentId: string;
      title: string;
      /** What part of the design it would cover, e.g. "the CTA pair", "the eyebrow badge". */
      role: string;
      /** 0.0–1.0 */
      confidence: number;
      note: string;
    }[];
    /** Existing playground patterns that already solve this whole layout. */
    patterns: { patternId: string; title: string; note: string }[];
    /** 0.0–1.0 — share of the design expressible with existing components/patterns. */
    compositionScore: number;
    /** The headline call: compose from what exists, or genuinely build new — and why. */
    recommendation: string;
  };

  /**
   * How the design's visual values map onto the registry's real tokens. This is the
   * "does this design actually use our design system" answer — the thing a developer
   * needs before writing a line of CSS. Absent on specs generated before this section
   * existed, so treat as optional at every read site.
   */
  tokens?: {
    colors: TokenMatch[];
    typography: TokenMatch[];
    spacing: TokenMatch[];
    radii: TokenMatch[];
    /** 0.0–1.0 — share of observed values that matched an existing token exactly. */
    coverage: number;
    notes: string;
  };

  /**
   * Brand-voice compliance for the copy in the design, checked against the workspace's
   * `brandVoice` guidance (banned phrases, length rules, tone). Optional for the same
   * backwards-compatibility reason as `tokens`.
   */
  voice?: {
    findings: VoiceFinding[];
    /** Banned phrases from the workspace list that actually appear in the design. */
    bannedPhrasesFound: string[];
    /** 0.0–1.0 — share of checked copy that passed. */
    score: number;
    summary: string;
  };

  implementation: {
    existingComponentMatches: {
      componentId: string;
      componentTitle: string;
      /** exact | variation | similar */
      matchLevel: string;
      /** 0.0–1.0 */
      confidence: number;
      propMapping: {
        specProp: string;
        existingProp: string;
        suggestedValue?: string;
      }[];
      missingProps: string[];
      /** Full prop object to pass when rendering as this existing component */
      sampleConfig: Record<string, unknown>;
      recommendation: string;
    }[];
    dependencies: string[];
    cssNotes: string;
    developerHints: string[];
  };
}

/** Richer extracted asset shape — stored in artifact.assets jsonb. */
export interface ExtractedAssetV2 {
  /** Unique key: "state_hover", "sub_label", "icon_close", "annotated_overview" */
  key: string;
  label: string;
  imageUrl: string;
  /** state | subcomponent | icon | media | background | annotated_overview */
  role: string;
  stateName?: string;
  semanticName?: string;
  /** 0–1 relative coordinates within the 1024×1024 canvas */
  boundingBox?: { x: number; y: number; w: number; h: number };
  description: string;
  /** Legacy fields kept for backwards compat */
  prompt?: string;
  usage?: string;
  preserveFrame?: boolean;
}

/** Design classification from Phase 1 of extraction. */
export interface DesignClassification {
  componentType:
    | 'button'
    | 'card'
    | 'form'
    | 'input'
    | 'navigation'
    | 'modal'
    | 'table'
    | 'list'
    | 'badge'
    | 'tooltip'
    | 'hero'
    | 'banner'
    | 'media'
    | 'other';
  suggestedName: string;
  visibleStates: string[];
  subComponents: { name: string; role: string }[];
  hasIcons: boolean;
  hasMedia: boolean;
  complexity: 'simple' | 'medium' | 'complex';
}
