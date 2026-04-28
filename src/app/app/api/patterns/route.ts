import { NextResponse } from 'next/server';
import { getDataProvider } from '../../../lib/data';

export const dynamic = 'force-static';

export async function GET() {
  const provider = getDataProvider();
  const patterns = await provider.getPatterns();
  return NextResponse.json(patterns);
}
