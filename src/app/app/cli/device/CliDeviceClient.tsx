'use client';

import { handoffApiUrl, handoffBasePath } from '@/lib/api-path';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

export default function CliDeviceClient() {
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [userCode, setUserCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = searchParams.get('user_code')?.trim();
    if (q) setUserCode(q.replace(/\s/g, '').toUpperCase());
  }, [searchParams]);

  const approve = useCallback(async () => {
    setError(null);
    setMessage(null);
    const code = userCode.replace(/\s/g, '').toUpperCase();
    if (!code) {
      setError('Enter the user code shown in your terminal.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(handoffApiUrl('/api/oauth/device/approve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user_code: code }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Approval failed');
        return;
      }
      setMessage('CLI authorized. You can return to your terminal — `handoff-app login` should complete shortly.');
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }, [userCode]);

  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!session?.user) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <p className="text-sm text-muted-foreground">Sign in to authorize the Handoff CLI on your machine.</p>
        <Button asChild variant="default">
          <Link
            href={`${handoffApiUrl('/login')}?callbackUrl=${encodeURIComponent(
              `${handoffBasePath()}/cli/device${typeof window !== 'undefined' ? window.location.search : ''}`
            )}`}
          >
            Sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Approve CLI access for <strong>{session.user.email}</strong>. Enter the user code from your terminal (format{' '}
        <code className="rounded bg-muted px-1">XXXX-XXXX</code>), then confirm.
      </p>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="user-code">
          User code
        </label>
        <Input
          id="user-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={userCode}
          onChange={(e) => setUserCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
        />
      </div>
      <Button type="button" disabled={busy} onClick={() => void approve()}>
        {busy ? 'Authorizing…' : 'Authorize CLI'}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-green-700 dark:text-green-400">{message}</p> : null}
      <Button type="button" variant="ghost" size="sm" className="self-start px-0" asChild>
        <Link href={handoffApiUrl('/developer/local-setup')}>Develop locally help</Link>
      </Button>
    </div>
  );
}
