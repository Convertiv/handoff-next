import { NextResponse } from 'next/server';
import { getDataProvider } from '../../../lib/data';

export const dynamic = process.env.HANDOFF_MODE === 'dynamic' ? 'force-dynamic' : 'force-static';

export async function GET() {
  const provider = getDataProvider();
  const components = await provider.getComponents();
  return NextResponse.json(components);
}
