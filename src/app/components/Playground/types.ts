export interface PlaygroundComponent {
  id: string;
  title: string;
  description: string;
  type: string;
  group: string;
  image: string;
  figma: string;
  categories: string[];
  tags: string[];
  properties: Record<string, any>;
  previews: {
    [key: string]: {
      title: string;
      values: Record<string, any>;
      url: string;
    };
  };
  format: string;
  code: string;
  html: string;
  /**
   * What each `ReactNode` slot was measured to accept, from the build-time probe. Arrives in the
   * component's built `<id>.json`. Drives which editor a slot gets — see `lib/slot-capabilities.ts`.
   */
  capabilities?: Record<string, any>;
  /**
   * Field annotations from the component's Handoff definition — `of`, `item`, `label`, `editorType`.
   *
   * Passed to `applyCapabilitiesToProperties` so a declared `of:` can pick between several accepted
   * encodings and supply item fields the props never declared. See `docs/AUTHORING-BRIDGE.md`.
   */
  fields?: Record<string, any>;
  /** The block's authored args — NOT the component row's `data` column. */
  data?: Record<string, any>;
  rendered?: string;
  options?: {
    preview?: {
      groupBy?: string;
      /** Optional URL or path to a CSS file that overrides styles in the component page preview */
      css?: string;
    };
  };
}

export interface SelectedPlaygroundComponent extends PlaygroundComponent {
  order: number;
  quantity: number;
  uniqueId: string;
}

export interface BulkComponentEntry {
  componentId: string;
  data: Record<string, any>;
}

export interface PlaygroundAsset {
  id: string;
  name: string;
  src: string;
  alt: string;
  type: 'image' | 'video';
  width?: number;
  height?: number;
  tags?: string[];
  thumbnail?: string;
}

/** Handoff pattern format exported from Playground (matches PatternObject without id/path). */
export interface PlaygroundPageExport {
  title: string;
  description: string;
  group: string;
  components: string[];
  previews: { [key: string]: { title: string; values: Record<string, any>[] } };
}
