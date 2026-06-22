/** Shared types for the asset inventory — safe to import in client and server code. */

export type AssetType = 'logo' | 'icon' | 'image' | 'video';
export type AssetStatus = 'pending' | 'active';
export type AssetSourceType = 'figma' | 'upload' | 'url' | 'wordpress' | 'cloudinary' | 'component';
export type AssetUsageType = 'thumbnail' | 'design_preview' | 'prop_default' | 'documentation' | 'icon';
export type CollectionSourceType = 'figma' | 'manual';

export type AssetRow = {
  id: string;
  title: string;
  description: string | null;
  altText: string | null;
  assetType: AssetType;
  mimeType: string | null;
  fileSizeBytes: number | null;
  nativeWidth: number | null;
  nativeHeight: number | null;
  storageUrl: string;
  storageKey: string | null;
  thumbnailUrl: string | null;
  svgContent: string | null;
  iconSetId: string | null;
  iconVariant: string | null;
  collectionId: string | null;
  sourceType: AssetSourceType;
  sourceUrl: string | null;
  sourceMetadata: Record<string, unknown>;
  tags: string[];
  status: AssetStatus;
  createdBy: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

export type AssetUsageRow = {
  id: number;
  assetId: string;
  componentId: string;
  usageType: AssetUsageType;
  propKey: string | null;
  figmaContainerWidth: number | null;
  figmaContainerHeight: number | null;
  recommendedWidth: number | null;
  recommendedHeight: number | null;
  notes: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

export type CollectionRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sourceType: CollectionSourceType;
  figmaSectionId: string | null;
  figmaFileKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

export type IconSetRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  figmaComponentSetId: string | null;
  figmaFileKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

export type AssetWithUsages = AssetRow & {
  usages: AssetUsageRow[];
  collection: CollectionRow | null;
  iconSet: IconSetRow | null;
};

/** Shape returned by list endpoints */
export type AssetListItem = Pick<
  AssetRow,
  'id' | 'title' | 'assetType' | 'mimeType' | 'nativeWidth' | 'nativeHeight' |
  'storageUrl' | 'thumbnailUrl' | 'tags' | 'collectionId' | 'iconSetId' |
  'iconVariant' | 'status' | 'createdAt'
> & { collectionName?: string | null; iconSetName?: string | null };
