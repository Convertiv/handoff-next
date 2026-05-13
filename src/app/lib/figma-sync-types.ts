import type {
  FigmaAuditComponentEntry,
  FigmaAuditReport,
  FigmaChildComponentCatalogEntry,
  FigmaMatchStatus,
  FigmaMatchedBy,
} from '@handoff/figma/component-linking';
import type { ComponentDeclarationFigmaBlock } from '@handoff/declarations/types';
import type { ComponentListObject } from '@handoff/transformers/preview/types';

export type { ComponentDeclarationFigmaBlock };

export type FigmaAuditApiComponent = FigmaAuditComponentEntry & {
  component: ComponentListObject;
};

export type FigmaAuditApiRow = {
  figma: FigmaChildComponentCatalogEntry;
  status: Extract<FigmaMatchStatus, 'matched' | 'unlinked' | 'missing_in_handoff'>;
  matchedBy: FigmaMatchedBy;
  missingMetadata: string[];
  component: ComponentListObject | null;
};

export type LinkedFigmaFileInfo = {
  fileKey: string;
  title: string;
  url: string;
};

export type FigmaAuditApiResponse = {
  generatedAt: string;
  summary: FigmaAuditReport['summary'];
  figmaComponents: FigmaAuditApiRow[];
  components: FigmaAuditApiComponent[];
  connected: boolean;
  oauthConfigured: boolean;
  linkedFile: LinkedFigmaFileInfo | null;
};

export type FigmaSyncAction = 'create_component' | 'sync_metadata';

export type FigmaSyncApiResponse = {
  ok: boolean;
  action: FigmaSyncAction;
  componentId?: string;
  figmaComponentKey?: string;
  figmaSlug?: string;
  createdFiles?: string[];
  configPath?: string;
  configUpdated?: boolean;
  buildSucceeded?: boolean;
  buildError?: string | null;
  summary?: ComponentListObject | null;
  message?: string;
};
