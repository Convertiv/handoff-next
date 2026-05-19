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
