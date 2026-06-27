CREATE TABLE IF NOT EXISTS "handoff_component_preview" (
  "id" text PRIMARY KEY,
  "component_id" text NOT NULL REFERENCES "handoff_component"("id") ON DELETE cascade,
  "preview_key" text NOT NULL,
  "component_version" integer,
  "title" text DEFAULT '' NOT NULL,
  "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "slots" jsonb,
  "semantic" text,
  "rationale" text,
  "source" text DEFAULT 'manual' NOT NULL,
  "sync_state" text DEFAULT 'in-sync' NOT NULL,
  "author_id" text REFERENCES "user"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "component_preview_component_idx" ON "handoff_component_preview" ("component_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "component_preview_key_unique" ON "handoff_component_preview" ("component_id", "preview_key");
