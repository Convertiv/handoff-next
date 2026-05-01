import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const { resetPassword } = await import('@/lib/server/auth-reset');
  const formData = await request.formData();
  const token = String(formData.get('token') || '');
  const password = String(formData.get('password') || '');
  const confirm = String(formData.get('confirm') || '');
  if (password !== confirm) {
    return NextResponse.redirect(new URL(`/reset-password?token=${encodeURIComponent(token)}&err=1`, request.url));
  }
  const r = await resetPassword(token, password);
  if ('error' in r) {
    return NextResponse.redirect(new URL(`/reset-password?token=${encodeURIComponent(token)}&err=1`, request.url));
  }
  return NextResponse.redirect(new URL('/login?reset=1', request.url));
}
