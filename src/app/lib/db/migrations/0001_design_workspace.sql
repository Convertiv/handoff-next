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
ALTER TABLE "handoff_design_workspace" ADD CONSTRAINT "handoff_design_workspace_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
