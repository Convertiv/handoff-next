import { Types as CoreTypes } from 'handoff-core';
import type { GeneratedDocs } from 'handoff-docgen';
import type { FigmaComponentLinkData } from '@handoff/figma/component-linking';
import { SlotMetadata } from '@handoff/transformers/preview/slots';
import { ComponentPageDefinition } from '@handoff/transformers/preview/types';
import { type Filter } from '@handoff/utils/filter';

export interface ValidationResult {
  /**
   * Description of what this validation check does
   */
  description: string;
  /**
   * Whether the validation passed or failed
   */
  passed: boolean;
  /**
   * Optional messages providing more details about the validation result
   */
  messages?: string[];
  /**
   * Optional severity level of the validation result
   */
  severity?: 'error' | 'warning' | 'info';
  /**
   * Optional timestamp of when the validation was performed
   */
  timestamp?: string;
}

export interface ValidationResults {
  [key: string]: ValidationResult;
}

export interface ReferenceObject {
  reference: string;
  type: string;
  name: string;
  group: string;
}

export interface PreviewObject {
  id: string;
  title: string;
  image: string;
  description: string;
  figma: string;
  figmaComponentId?: string;
  should_do: string[];
  should_not_do: string[];
  group?: string;
  categories?: string[];
  tags?: string[];
  preview: string;
  previews: {
    [key: string]: {
      title: string;
      values: { [key: string]: string };
      url: string;
      usage?: string;
    };
  };
  properties?: { [key: string]: SlotMetadata };
  code: string;
  html?: string;
  usage?: string;
  format: string;
  variant?: Record<string, string>;
  options?: {
    preview?: {
      groupBy?: string;
      filterBy?: Filter;
    };
  };
  /**
   * Validation results for the component
   * Each key represents a validation type and the value contains detailed validation results
   * @deprecated Use `validationResults` (ADR-002).
   */
  validations?: Record<string, ValidationResult>;
  /**
   * Results from the pluggable validation framework (ADR-002). One entry
   * per configured validator; pushed up by the workspace and rendered as
   * pass/fail badges + finding lists on the registry component detail page.
   */
  validationResults?: import('./validation').ValidatorResult[];
  page?: ComponentPageDefinition;
  docgen?: GeneratedDocs;
}

export interface PreviewObject extends FigmaComponentLinkData {}

export type PreviewJson = {
  components: {
    [key in keyof CoreTypes.IDocumentationObject['components']]: PreviewObject[];
  };
};

export interface ComponentDocumentationOptions {
  views?: {
    [view: string]: {
      condition?: {
        [property: string]: ComponentViewFilterValue;
      };
      sort?: string[];
      title?: string;
    };
  };
}

type ComponentViewFilterValue = string | string[] | { [value: string]: { [prop: string]: string } };
