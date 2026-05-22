CREATE TABLE IF NOT EXISTS "component_artifact" (
  "component_id" text NOT NULL,
  "filename" text NOT NULL,
  "content" text NOT NULL,
  "content_type" text NOT NULL DEFAULT 'text/plain',
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "component_artifact_pkey" PRIMARY KEY ("component_id", "filename")
);
