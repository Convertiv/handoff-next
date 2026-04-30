/** Serializable foundations snapshot for the workbench + AI prompt. */
export type DesignWorkbenchFoundationContext = {
  colors: { name: string; value: string; group?: string; subgroup?: string }[];
  typography: { name: string; line: string }[];
  effects: { name: string; line: string }[];
  /** Spacing / layout scale when present in tokens */
  spacing: { name: string; value: string }[];
};

export type DesignWorkbenchComponentGuide = {
  id: string;
  title: string;
  group?: string;
  description?: string;
  previewUrl?: string | null;
  /** When set, matches an entry in `previews` on the row (for future per-variation picker). */
  previewKey?: string;
  propertiesSummary?: string;
};

export type DesignConversationTurn = {
  role: 'user' | 'assistant';
  prompt: string;
  imageUrl?: string;
  timestamp?: string;
};

/** One built preview variation (HTML asset under /api/component/). */
export type DesignWorkbenchComponentPreviewRef = {
  key: string;
  title: string;
  /** Filename only, e.g. `accordion-demo.html` */
  url: string;
};

/** Lightweight component row for the workbench picker (from server). */
/** One extracted composite asset (e.g. isolated background) stored on a design artifact. */
export type DesignAsset = {
  label: string;
  imageUrl: string;
  prompt: string;
};

export type DesignWorkbenchComponentRow = {
  id: string;
  title: string;
  group: string;
  description: string;
  image: string | null;
  /** Short summary of property keys for context */
  propertiesSummary: string;
  /** Built preview variations (for screenshots / future picker). */
  previews: DesignWorkbenchComponentPreviewRef[];
};
