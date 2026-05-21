import { NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createHandoffMcpServer } from '@/lib/mcp/create-server';
import { requirePostgresForMcp, verifyHandoffApiAuth, type McpAuthContext } from '@/lib/mcp-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleMcp(request: Request): Promise<Response> {
  const pgErr = requirePostgresForMcp();
  if (pgErr) return pgErr;

  const authResult = verifyHandoffApiAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const auth = authResult as McpAuthContext;

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createHandoffMcpServer(auth, request);
  await server.connect(transport);
  return transport.handleRequest(request);
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
