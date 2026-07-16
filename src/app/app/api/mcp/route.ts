import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createHandoffMcpServer } from '@/lib/mcp/create-server';
import { requirePostgresForMcp, verifyHandoffApiAuth, type McpAuthContext } from '@/lib/mcp-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * In-memory session store, keyed by Mcp-Session-Id. Lets a client reuse the same
 * server+transport pair across requests instead of re-negotiating `initialize`
 * every call — required for MCP Apps: Claude Desktop opens a separate client
 * connection to bridge a ui:// resource into the sandboxed iframe, and that
 * connection's `getServerCapabilities()` comes back empty ("Client server
 * capabilities not available") unless it can actually complete its own
 * initialize handshake against a session the server remembers.
 *
 * Caveat: this Map lives in one Node process — fine for a single warm Vercel
 * lambda instance (the common case for a given user's session), but isn't
 * shared across concurrent instances. If that proves unreliable at scale,
 * swap in a shared store (Redis/KV) keyed the same way.
 */
const sessions = new Map<string, { transport: WebStandardStreamableHTTPServerTransport }>();

async function handleMcp(request: Request): Promise<Response> {
  const pgErr = requirePostgresForMcp();
  if (pgErr) return pgErr;

  const authResult = verifyHandoffApiAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const auth = authResult as McpAuthContext;

  const sessionId = request.headers.get('mcp-session-id') ?? undefined;
  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing) {
    return existing.transport.handleRequest(request);
  }

  // No known session: only a fresh `initialize` request (POST, no session
  // header yet) is valid here — everything else (unknown session id, or a
  // non-initialize call with no session) is rejected, matching the SDK's own
  // reference Streamable HTTP server.
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    body = undefined;
  }

  if (sessionId || !isInitializeRequest(body)) {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null },
      { status: 400 }
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { transport });
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  const server = createHandoffMcpServer(auth, request);
  await server.connect(transport);
  return transport.handleRequest(request, { parsedBody: body });
}

export async function GET(request: Request) {
  return handleMcp(request);
}

export async function POST(request: Request) {
  return handleMcp(request);
}

export async function DELETE(request: Request) {
  return handleMcp(request);
}
