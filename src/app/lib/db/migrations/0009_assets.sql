-- Asset collections (Figma sections, manual groupings)
CREATE TABLE IF NOT EXISTS "handoff_asset_collection" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "source_type" text NOT NULL DEFAULT 'manual',
  "figma_section_id" text,
  "figma_file_key" text,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "handoff_asset_collection_slug_unique" UNIQUE("slug")
);

-- Icon sets (Figma component sets or manual)
CREATE TABLE IF NOT EXISTS "handoff_icon_set" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "figma_component_set_id" text,
  "figma_file_key" text,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "handoff_icon_set_slug_unique" UNIQUE("slug")
);

-- Core asset table
CREATE TABLE IF NOT EXISTS "handoff_asset" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "alt_text" text,
  "asset_type" text NOT NULL,
  "mime_type" text,
  "file_size_bytes" integer,
  "native_width" integer,
  "native_height" integer,
  "storage_url" text NOT NULL,
  "storage_key" text,
  "thumbnail_url" text,
  "svg_content" text,
  "icon_set_id" text REFERENCES "handoff_icon_set"("id") ON DELETE SET NULL,
  "icon_variant" text,
  "collection_id" text REFERENCES "handoff_asset_collection"("id") ON DELETE SET NULL,
  "source_type" text NOT NULL DEFAULT 'upload',
  "source_url" text,
  "source_metadata" jsonb DEFAULT '{}',
  "tags" jsonb DEFAULT '[]',
  "status" text NOT NULL DEFAULT 'active',
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "asset_type_idx" ON "handoff_asset" ("asset_type");
CREATE INDEX IF NOT EXISTS "asset_collection_idx" ON "handoff_asset" ("collection_id");
CREATE INDEX IF NOT EXISTS "asset_icon_set_idx" ON "handoff_asset" ("icon_set_id");
CREATE INDEX IF NOT EXISTS "asset_status_idx" ON "handoff_asset" ("status");

-- Asset usage (eager component↔asset links)
CREATE TABLE IF NOT EXISTS "handoff_asset_usage" (
  "id" serial PRIMARY KEY,
  "asset_id" text NOT NULL REFERENCES "handoff_asset"("id") ON DELETE CASCADE,
  "component_id" text NOT NULL,
  "usage_type" text NOT NULL,
  "prop_key" text,
  "figma_container_width" integer,
  "figma_container_height" integer,
  "recommended_width" integer,
  "recommended_height" integer,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "asset_usage_asset_idx" ON "handoff_asset_usage" ("asset_id");
CREATE INDEX IF NOT EXISTS "asset_usage_component_idx" ON "handoff_asset_usage" ("component_id");
