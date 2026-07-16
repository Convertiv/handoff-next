-- MCP OAuth 2.1 connector (RFC 7591 dynamic client registration + authorization_code/PKCE),
-- so claude.ai / Claude Desktop can register Handoff as a remote Connector rather than
-- requiring a per-project .mcp.json. Distinct from the CLI's device-code flow. Idempotent.

CREATE TABLE IF NOT EXISTS "oauth_client" (
  "client_id" text PRIMARY KEY,
  "client_secret_hash" text,
  "client_name" text NOT NULL,
  "redirect_uris" text NOT NULL,
  "token_endpoint_auth_method" text NOT NULL DEFAULT 'none',
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "oauth_authorization_code" (
  "id" text PRIMARY KEY,
  "code_hash" text NOT NULL UNIQUE,
  "client_id" text NOT NULL REFERENCES "oauth_client"("client_id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "code_challenge_method" text NOT NULL DEFAULT 'S256',
  "scopes" text NOT NULL,
  "consumed" boolean NOT NULL DEFAULT false,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "oauth_refresh_token" (
  "id" text PRIMARY KEY,
  "token_hash" text NOT NULL UNIQUE,
  "client_id" text NOT NULL REFERENCES "oauth_client"("client_id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "scopes" text NOT NULL,
  "revoked_at" timestamp,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now()
);
