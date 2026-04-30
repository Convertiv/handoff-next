-- Design artifact: extracted assets, extraction job status, public share flag
ALTER TABLE "handoff_design_artifact" ADD COLUMN IF NOT EXISTS "assets" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "handoff_design_artifact" ADD COLUMN IF NOT EXISTS "assets_status" text NOT NULL DEFAULT 'none';
ALTER TABLE "handoff_design_artifact" ADD COLUMN IF NOT EXISTS "public_access" boolean NOT NULL DEFAULT false;
