import { readFileSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

/**
 * GET /api/openapi — serve the OpenAPI 3.1 spec with permissive CORS so
 * Swagger UI, Redoc, Postman, and other tools can fetch it from any origin.
 */
export function GET(): Response {
  const specPath = join(process.cwd(), 'public', 'openapi.yaml');
  let yaml: string;
  try {
    yaml = readFileSync(specPath, 'utf-8');
  } catch {
    return NextResponse.json({ error: 'OpenAPI spec not found' }, { status: 404 });
  }

  return new Response(yaml, {
    headers: {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export function OPTIONS(): Response {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
