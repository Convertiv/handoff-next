import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return [{ nextauth: ['session'] }];
}

const stub = () => NextResponse.json({ error: 'Auth requires HANDOFF_MODE=dynamic' }, { status: 404 });

export async function GET(request: Request) {
  if (process.env.HANDOFF_MODE !== 'dynamic') return stub();
  const { handlers } = await import('../../../../lib/auth');
  return handlers.GET(request as any);
}

export async function POST(request: Request) {
  if (process.env.HANDOFF_MODE !== 'dynamic') return stub();
  const { handlers } = await import('../../../../lib/auth');
  return handlers.POST(request as any);
}
