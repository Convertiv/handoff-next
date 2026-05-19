CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "cli_device_session" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"scopes" text DEFAULT 'sync:read sync:write' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "cli_device_session_device_code_hash_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "cli_device_session_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "component_build_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"component_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "component_generation_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"user_id" text NOT NULL,
	"component_id" text NOT NULL,
	"renderer" text DEFAULT 'handlebars' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"max_iterations" integer DEFAULT 3 NOT NULL,
	"a11y_standard" text DEFAULT 'none' NOT NULL,
	"behavior_prompt" text DEFAULT '' NOT NULL,
	"use_extracted_assets" boolean DEFAULT true NOT NULL,
	"generation_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visual_score" numeric(5, 4),
	"last_build_job_id" integer,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "edit_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"user_id" text,
	"diff" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "figma_fetch_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"triggered_by_user_id" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "handoff_component" (
	"id" text PRIMARY KEY NOT NULL,
	"path" text,
	"title" text DEFAULT '' NOT NULL,
	"description" text,
	"group" text,
	"image" text,
	"type" text,
	"properties" jsonb,
	"previews" jsonb,
	"data" jsonb,
	"source" text DEFAULT 'disk' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "handoff_design_artifact" (
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
	"assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assets_status" text DEFAULT 'none' NOT NULL,
	"public_access" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "handoff_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"actor_user_id" text,
	"route" text,
	"entity_type" text,
	"entity_id" text,
	"duration_ms" integer,
	"error" text,
	"provider" text,
	"model" text,
	"estimated_input_tokens" integer,
	"estimated_output_tokens" integer,
	"estimated_cost_usd" numeric(12, 6),
	"request_preview" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "handoff_page" (
	"slug" text PRIMARY KEY NOT NULL,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "handoff_pattern" (
	"id" text PRIMARY KEY NOT NULL,
	"path" text,
	"title" text DEFAULT '' NOT NULL,
	"description" text,
	"group" text,
	"tags" jsonb,
	"components" jsonb,
	"data" jsonb,
	"user_id" text,
	"source" text DEFAULT 'build' NOT NULL,
	"thumbnail" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "handoff_reference_material" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"generated_at" timestamp DEFAULT now(),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoff_tokens_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_reset_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb,
	"user_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" timestamp,
	"image" text,
	"role" text DEFAULT 'member' NOT NULL,
	"password_hash" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_device_session" ADD CONSTRAINT "cli_device_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_generation_job" ADD CONSTRAINT "component_generation_job_artifact_id_handoff_design_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."handoff_design_artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_generation_job" ADD CONSTRAINT "component_generation_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_history" ADD CONSTRAINT "edit_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "figma_fetch_job" ADD CONSTRAINT "figma_fetch_job_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_design_artifact" ADD CONSTRAINT "handoff_design_artifact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_event_log" ADD CONSTRAINT "handoff_event_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_pattern" ADD CONSTRAINT "handoff_pattern_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_event" ADD CONSTRAINT "sync_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "component_generation_job_artifact_id_idx" ON "component_generation_job" ("artifact_id");--> statement-breakpoint
CREATE INDEX "component_generation_job_user_id_idx" ON "component_generation_job" ("user_id");--> statement-breakpoint
CREATE INDEX "cli_device_session_expires_at_idx" ON "cli_device_session" ("expires_at");