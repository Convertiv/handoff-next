/**
 * Wire format shared with the Figma Handoff plugin push-properties API.
 * Kept in-repo (instead of importing `handoff-figma-plugin/contract`) so Next/Vercel
 * typecheck does not depend on installing that package (it is `file:`-linked locally only).
 *
 * Canonical source: handoff-figma-plugin `src/contract/index.ts` — keep in sync when the contract changes.
 */

export const HandoffPropertyTypes = ['text', 'richtext', 'image', 'button', 'link', 'object', 'array', 'string', 'boolean'] as const;

export type HandoffPropertyType = (typeof HandoffPropertyTypes)[number];

export interface IHandoffPropertyRules {
  required?: boolean;
  /**
   * Content length the component can render without breaking — a **structural** limit owned by the component,
   * not an editorial one (roadmap E.9).
   *
   * **`content` is the canonical shape.** It is what `config/templates/component/template.json` models, what
   * `RulesSheet` renders, and what real registries carry. E.9 originally shipped reading a flat `maxLength`,
   * which nothing in any registry used — a key invented alongside the real one (corrected 2026-08-10).
   *
   * A brief can still be stricter: `resolveFieldGuardrail` prefers an explicit per-field brief rule over this,
   * and this over a brief's blanket default — most specific wins.
   */
  content?: { min?: number; max?: number };
  /**
   * Legacy flat alias for `content.max`, read only as a fallback.
   *
   * Kept because `Wizard/prompt-builder.ts` has read it for LLM context since before either was declared.
   * New components should declare `content`.
   */
  maxLength?: number;
  dimensions?: {
    width?: number;
    height?: number;
    min?: { width: number; height: number };
    max?: { width: number; height: number };
    recommend?: { width: number; height: number };
  };
}

export interface IHandoffProperty {
  key: string;
  name: string;
  type: HandoffPropertyType;
  description?: string;
  linkedNodePath?: string;
  linkedPropertyName?: string;
  rules?: IHandoffPropertyRules;
  default?: any;
  properties?: IHandoffProperty[];
  items?: IHandoffProperty;
}

export interface IDetectedProperty {
  key: string;
  name: string;
  suggestedType: HandoffPropertyType;
  nodePath?: string;
  figmaPropertyName?: string;
  figmaPropertyType?: string;
  defaultValue?: any;
  width?: number;
  height?: number;
}

export interface IDetectedImage {
  nodeId: string;
  nodeName: string;
  imageHash: string;
  width: number;
  height: number;
  propertyKey: string | null;
}

export interface IFrameInstanceInfo {
  instanceNodeId: string;
  instanceName: string;
  componentSetId: string | null;
  componentSetName: string | null;
  handoffComponentId: string | null;
  propertiesDefined: boolean;
  propertyValues: Record<string, any>;
  images: IDetectedImage[];
}

export interface PushComponentPropertiesRequest {
  componentSetId: string;
  componentSetName?: string | null;
  handoffComponentId?: string | null;
  figmaComponentKey?: string | null;
  properties: IDetectedProperty[];
  images: IDetectedImage[];
}

export interface PushComponentPropertiesResponse {
  ok: boolean;
  componentId?: string;
  matchedBy?: 'handoff_component_id' | 'figma_component_key' | 'component_set_id' | null;
  propertyCount: number;
  imageCount: number;
  message: string;
}
