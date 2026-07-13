import type React from 'react';
import type { FigmaComponentLinkData } from '@handoff/figma/component-linking';
import type { ComponentObject } from '@handoff/transformers/preview/types';

export type RendererKind = 'react' | 'handlebars' | 'csf';

/** Nested `figma` block in `.handoff.ts` / JSON (`url` = canvas link; other keys mirror {@link FigmaComponentLinkData}). */
export type ComponentDeclarationFigmaBlock = Partial<Omit<FigmaComponentLinkData, 'figma'>> & {
  url?: string;
};

export type DeclarationPreview<TArgs = Record<string, any>> = {
  title: string;
  args?: TArgs;
  values?: TArgs;
  url?: string;
  usage?: string;
};

type BaseDeclarationEntries = NonNullable<ComponentObject['entries']> & {
  component?: string;
  story?: string;
  templates?: string;
};

type OptionalComponentMetadata = Partial<Omit<ComponentObject, 'previews' | 'entries' | 'title' | 'should_do' | 'should_not_do'>>;

export type BaseDeclarationConfig = OptionalComponentMetadata & {
  id?: string;
  name: string;
  renderer?: RendererKind;
  entries?: BaseDeclarationEntries;
  previews?: Record<string, DeclarationPreview>;
  shouldDo?: string[];
  shouldNotDo?: string[];
  /** Field annotations (untyped at the generic layer; see `FieldAnnotations<TProps>`). */
  fields?: Record<string, FieldAnnotation>;
};

/**
 * Editor widget signal for a field (Handoff's `argTypes` control). OPEN
 * vocabulary — maps to `PropertySpec.editorType` (see COMPONENT_PREVIEW_SCHEMA
 * §4/§12a). Known values are suggested; any string is allowed so projects can
 * add their own widgets without a core change.
 */
export type FieldEditorType =
  | 'text'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'select'
  | 'image'
  | 'link'
  | 'button'
  | 'icon'
  | 'object'
  | 'array'
  | 'slot'
  | (string & {});

/**
 * Refinement of one inferred prop → a `PropertySpec` (COMPONENT_PREVIEW_SCHEMA
 * §12a, "Handoff's argTypes"). Everything here is serializable and pushed to
 * drive the builder form / MCP / validation — EXCEPT `render`, which is code
 * that stays in the preview bundle (the Storybook `mapping`/`render` pattern).
 *
 * @typeParam TProp  the real prop type this field refines (the `render` return).
 */
export type FieldAnnotation<TProp = unknown> = {
  /** Which builder widget to use. Maps to `PropertySpec.editorType`. */
  editorType?: FieldEditorType;
  /** Display label in the builder. */
  label?: string;
  /** Help text. */
  description?: string;
  /** Choices for a `select` editor — bare strings or `{ value, label }`. Maps to `enumOptions`. */
  options?: Array<string | { value: string; label?: string }>;
  /** For `array` editors: the item editor (e.g. `'button'`). */
  of?: FieldEditorType;
  /** Validation rules (mirrors `PropertySpec.rules`). */
  rules?: {
    required?: boolean;
    content?: { min?: number; max?: number };
    pattern?: string;
  };
  /** Seed value shown in the builder. */
  default?: unknown;
  /** Keep this (code-only) prop OUT of the builder form. */
  hidden?: boolean;
  /**
   * Map the serializable editor value → the real prop value (e.g. a React node
   * for a `React.ReactNode` slot). CODE, not data: it is NEVER serialized into
   * the pushed schema and runs only in the preview bundle at render time.
   * The argument is whatever the editor produces (no fixed shape); the return
   * is the actual prop value the component receives.
   */
  render?: (value: any) => TProp;
};

/** Per-prop field annotations, keyed by the component's prop names. */
export type FieldAnnotations<TProps> = {
  [K in keyof TProps]?: FieldAnnotation<TProps[K]>;
};

export type ReactDeclarationConfig<TProps> = Omit<BaseDeclarationConfig, 'renderer' | 'entries' | 'previews' | 'fields'> & {
  entries: BaseDeclarationEntries & { component: string };
  previews: Record<string, DeclarationPreview<Partial<TProps>>>;
  /**
   * Field annotations (Handoff's `argTypes`) — refine inferred props and, for
   * slots, map a serializable editor value to a React node via `render`.
   * Inference (§12) is the baseline; annotate only what needs refining.
   */
  fields?: FieldAnnotations<TProps>;
};

export type HandlebarsDeclarationConfig = Omit<BaseDeclarationConfig, 'renderer' | 'entries' | 'figma'> & {
  entries: BaseDeclarationEntries & { template: string };
  figma?: string | ComponentDeclarationFigmaBlock;
};

export type CsfDeclarationConfig = Omit<BaseDeclarationConfig, 'renderer' | 'entries'> & {
  entries: BaseDeclarationEntries & { story: string };
};

export type GenericDeclarationConfig = Omit<BaseDeclarationConfig, 'renderer' | 'figma'> & {
  renderer: RendererKind;
  figma?: string | ComponentDeclarationFigmaBlock;
};

export type ReactComponentType<TProps = any> = React.ComponentType<TProps>;

// ---------------------------------------------------------------------------
// Pattern declarations
// ---------------------------------------------------------------------------

export type PatternComponentRef = {
  id: string;
  preview?: string;
  args?: Record<string, any>;
};

export type BasePatternDeclarationConfig = {
  id?: string;
  name: string;
  description?: string;
  group?: string;
  tags?: string[];
  components: PatternComponentRef[];
};

export type GenericPatternDeclarationConfig = BasePatternDeclarationConfig;
