'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { handoffApiUrl } from '../../lib/api-path';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

export default function ResetPasswordClient() {
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get('token') ?? '';
  const sent = searchParams.get('sent') === '1';
  const err = searchParams.get('err') === '1';

  const showResetForm = Boolean(tokenFromUrl);

  if (showResetForm) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Set a new password</CardTitle>
            <CardDescription>Choose a password at least 8 characters long.</CardDescription>
          </CardHeader>
          <form action={handoffApiUrl('/api/handoff/auth/reset-password')} method="post">
            <input type="hidden" name="token" value={tokenFromUrl} />
            <CardContent className="space-y-4">
              {err ? <p className="text-sm text-destructive">Could not update password. Check your link or try again.</p> : null}
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full">
                Update password
              </Button>
              <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
                Back to sign in
              </Link>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
          <CardDescription>
            {sent
              ? 'If an account exists for that email, we sent a link to reset your password.'
              : 'Enter your email and we will send you a reset link if an account exists.'}
          </CardDescription>
        </CardHeader>
        {!sent ? (
          <form action={handoffApiUrl('/api/handoff/auth/request-reset')} method="post">
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full">
                Send reset link
              </Button>
            </CardFooter>
          </form>
        ) : (
          <CardFooter className="flex flex-col gap-3">
            <Link href="/login" className="text-center text-sm text-primary underline-offset-4 hover:underline">
              Return to sign in
            </Link>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
