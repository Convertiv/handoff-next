CREATE TABLE IF NOT EXISTS "cli_device_session" (
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
ALTER TABLE "cli_device_session" ADD CONSTRAINT "cli_device_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cli_device_session_expires_at_idx" ON "cli_device_session" ("expires_at");
