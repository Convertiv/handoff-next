import { NextResponse } from 'next/server';
import { getDataProvider } from '../../../lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const provider = getDataProvider();
  const components = await provider.getComponents();
  return NextResponse.json(components);
}
