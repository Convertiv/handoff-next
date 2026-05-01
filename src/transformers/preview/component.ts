import type { DocAnnotation, TypeNode } from 'handoff-docgen';
import path from 'path';
import Handoff from '@handoff/index';
import { getAPIPath } from './component/api.js';
import processComponents from './component/builder.js';
import { buildMainCss } from './component/css.js';
import { buildMainJS } from './component/javascript.js';
import writeComponentSummaryAPI from './component/summary.js';

export interface ComponentMetadata {
  title: string;
  type?: string;
  group?: string;
  description: string;
  properties: { [key: string]: SlotMetadata };
}

export enum SlotType {
  TEXT = 'text',
  IMAGE = 'image',
  BUTTON = 'button',
  ARRAY = 'array',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  OBJECT = 'object',
  FUNCTION = 'function',
  ENUM = 'enum',
  ANY = 'any',
}

export interface SlotMetadata {
  id?: string;
  name: string;
  description: string;
  generic: string;
  default?: string | number | boolean | object | any[] | null;
  type: SlotType;
  // used if type is array
  items?: {
    type: SlotType;
    properties?: { [key: string]: SlotMetadata };
  };
  // Used if type is object
  properties?: { [key: string]: SlotMetadata };
  key?: string;
  rules?: RuleObject;
  docgenType?: string;
  deepType?: TypeNode;
  typeRefs?: string[];
  warnings?: string[];
  annotations?: DocAnnotation[];
}

export type RuleObject = {
  required?: boolean;
  content?: {
    min: number;
    max: number;
  };
  dimensions?: {
    width: number;
    height: number;
    min: {
      width: number;
      height: number;
    };
    max: {
      width: number;
      height: number;
    };
    recommend: {
      width: number;
      height: number;
    };
  };
  filesize?: number;
  filetype?: string;
  pattern?: string;
};

export const getComponentOutputPath = (handoff: Handoff) => path.resolve(getAPIPath(handoff), 'component');
/**
 * Create a component transformer
 * @param handoff
 * @param documentationObject
 * @returns
 */
export async function componentTransformer(handoff: Handoff) {
  const componentData = await processComponents(handoff);
  await writeComponentSummaryAPI(handoff, componentData);
  await buildMainJS(handoff);
  await buildMainCss(handoff);
}
