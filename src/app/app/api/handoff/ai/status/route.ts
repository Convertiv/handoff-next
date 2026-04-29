import { NextResponse } from 'next/server';
import { getServerAiModel, isServerAiConfigured } from '@/lib/server/ai-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    available: isServerAiConfigured(),
    model: getServerAiModel(),
  });
}
