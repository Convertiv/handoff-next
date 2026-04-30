-- Idempotent: databases that never applied 0008_tranquil_captain_marvel still need this table.
CREATE TABLE IF NOT EXISTS "handoff_design_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"user_id" text NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"source_images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"component_guides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"foundation_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conversation_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "handoff_design_artifact" ADD CONSTRAINT "handoff_design_artifact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
