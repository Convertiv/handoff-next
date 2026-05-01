import { getDataProvider } from '@handoff/app/lib/data';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const provider = getDataProvider();
  const components = await provider.getComponents();
  return NextResponse.json(components);
}
