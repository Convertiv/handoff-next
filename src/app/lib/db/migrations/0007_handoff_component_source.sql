ALTER TABLE "handoff_component" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'disk' NOT NULL;
