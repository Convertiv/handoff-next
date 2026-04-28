CREATE TABLE "component_build_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"component_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
