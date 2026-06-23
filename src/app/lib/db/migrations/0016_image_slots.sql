CREATE TABLE IF NOT EXISTS "handoff_image_slot" (
  "id" text PRIMARY KEY,
  "component_id" text NOT NULL,
  "slot_name" text NOT NULL,
  "node_id" text,
  "variant_key" text,
  "recommended_width" integer,
  "recommended_height" integer,
  "aspect_ratio_w" integer,
  "aspect_ratio_h" integer,
  "scale_mode" text,
  "is_responsive" boolean DEFAULT false,
  "min_width" integer,
  "min_height" integer,
  "updated_at" timestamp DEFAULT now()
);
