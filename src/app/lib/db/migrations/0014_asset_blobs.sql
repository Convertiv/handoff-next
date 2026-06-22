CREATE TABLE IF NOT EXISTS "handoff_asset_blob" (
  "asset_id" text PRIMARY KEY REFERENCES "handoff_asset"("id") ON DELETE CASCADE,
  "data" text NOT NULL,
  "content_type" text NOT NULL,
  "content_hash" text,
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "handoff_asset_blob_content_hash_idx" ON "handoff_asset_blob" ("content_hash");
