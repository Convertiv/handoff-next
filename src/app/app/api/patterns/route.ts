import { NextResponse } from 'next/server';
import { getDataProvider } from '../../../lib/data';

export async function GET() {
  const provider = getDataProvider();
  const patterns = await provider.getPatterns();
  return NextResponse.json(patterns);
}
