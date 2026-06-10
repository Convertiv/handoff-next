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
