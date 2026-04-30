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
ALTER TABLE "handoff_event_log" ADD CONSTRAINT "handoff_event_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;