-- Migration 0002: component_artifact, handoff_component_source, handoff_design_workspace, sync_event.change_type
-- Uses IF NOT EXISTS throughout so this migration is safe to apply whether or not
-- 0001_design_workspace.sql and 0002_component_artifact.sql were previously applied manually.
CREATE TABLE IF NOT EXISTS "component_artifact" (
	"component_id" text NOT NULL,
	"filename" text NOT NULL,
	"content" text NOT NULL,
	"content_type" text DEFAULT 'text/plain' NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "component_artifact_component_id_filename_pk" PRIMARY KEY("component_id","filename")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handoff_component_source" (
	"component_id" text NOT NULL,
	"file_path" text NOT NULL,
	"content" text NOT NULL,
	"pushed_at" timestamp DEFAULT now(),
	"pushed_by_user_id" text,
	CONSTRAINT "handoff_component_source_component_id_file_path_pk" PRIMARY KEY("component_id","file_path")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handoff_design_workspace" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"design_md" text DEFAULT '' NOT NULL,
	"brand_voice" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"include_foundations" boolean DEFAULT true NOT NULL,
	"custom_foundation_image_url" text DEFAULT '' NOT NULL,
	"component_references" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"updated_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "sync_event" ADD COLUMN IF NOT EXISTS "change_type" text;--> statement-breakpoint
ALTER TABLE "handoff_component_source" ADD CONSTRAINT IF NOT EXISTS "handoff_component_source_component_id_handoff_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."handoff_component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_component_source" ADD CONSTRAINT IF NOT EXISTS "handoff_component_source_pushed_by_user_id_user_id_fk" FOREIGN KEY ("pushed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_design_workspace" ADD CONSTRAINT IF NOT EXISTS "handoff_design_workspace_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
