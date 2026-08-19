'use client';

import { useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { handoffApiUrl } from '../../lib/api-path';

/**
 * The password form.
 *
 * One field, no email, no "forgot password" — there is no identity here to recover. Someone who does not have
 * the password has to be given it by whoever runs the deployment, and saying so is more useful than a link
 * that cannot help.
 */
export default function UnlockClient({ hint, next }: { hint: string | null; next: string }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/site-protection/unlock'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || 'That password did not work.');
        setPassword('');
        return;
      }
      /**
       * A full navigation rather than a router push: the gate lives in the root layout, which has to run again
       * against the new cookie. A client-side transition can reuse the tree that was rendered while locked.
       */
      window.location.href = next;
    } catch {
      setError('Could not check that just now. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold text-foreground">This site is password protected</h1>
          <p className="text-sm text-muted-foreground">Enter the password you were given to continue.</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Site password"
            autoComplete="current-password"
          />
          {hint ? <p className="text-xs text-muted-foreground">Hint: {hint}</p> : null}
          {error ? (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy || !password}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Checking…
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </form>

        {/* Someone with an account has a stronger credential and should not need the shared one. */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Have an account?{' '}
          <a href="/login" className="underline underline-offset-2 hover:text-foreground">
            Sign in instead
          </a>
        </p>
      </div>
    </main>
  );
}
