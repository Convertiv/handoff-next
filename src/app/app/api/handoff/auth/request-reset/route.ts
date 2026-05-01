import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const { requestPasswordReset } = await import('@/lib/server/auth-reset');
  const formData = await request.formData();
  const email = String(formData.get('email') || '');
  await requestPasswordReset(email);
  return NextResponse.redirect(new URL('/reset-password?sent=1', request.url));
}
