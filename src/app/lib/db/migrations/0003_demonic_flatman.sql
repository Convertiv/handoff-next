-- Migration 0003: registry config / theme / navigation tables + handoff_page type/assets columns
-- Idempotent via IF NOT EXISTS on tables/columns and pg_constraint checks on FKs
-- (Postgres does not support ADD CONSTRAINT IF NOT EXISTS — must use DO blocks).
CREATE TABLE IF NOT EXISTS "handoff_registry_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"updated_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handoff_registry_navigation" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"tree" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"updated_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handoff_registry_theme" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"css" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"updated_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "handoff_page" ADD COLUMN IF NOT EXISTS "type" text DEFAULT 'markdown' NOT NULL;--> statement-breakpoint
ALTER TABLE "handoff_page" ADD COLUMN IF NOT EXISTS "assets" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_registry_config_updated_by_user_id_user_id_fk') THEN
    ALTER TABLE "handoff_registry_config" ADD CONSTRAINT "handoff_registry_config_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_registry_navigation_updated_by_user_id_user_id_fk') THEN
    ALTER TABLE "handoff_registry_navigation" ADD CONSTRAINT "handoff_registry_navigation_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_registry_theme_updated_by_user_id_user_id_fk') THEN
    ALTER TABLE "handoff_registry_theme" ADD CONSTRAINT "handoff_registry_theme_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
