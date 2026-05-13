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
};

export type ReactDeclarationConfig<TProps> = Omit<BaseDeclarationConfig, 'renderer' | 'entries' | 'previews'> & {
  entries: BaseDeclarationEntries & { component: string };
  previews: Record<string, DeclarationPreview<Partial<TProps>>>;
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
