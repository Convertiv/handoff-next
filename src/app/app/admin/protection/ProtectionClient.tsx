'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Lock, LockOpen, ShieldAlert } from 'lucide-react';
import Layout from '../../../components/Layout/Main';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import { handoffApiUrl } from '../../../lib/api-path';

type State = { enabled: boolean; configured: boolean; hint: string | null; epoch: number };

/**
 * The site-password admin screen (`docs/SITE-PASSWORD.md` §7).
 *
 * It says plainly what the feature does *not* cover. That is not hedging: an operator who believes this
 * secures the API will use it for something it cannot do, and the honest sentence is cheaper than that
 * mistake.
 */
export default function ProtectionClient({
  config,
  menu,
  message,
}: {
  config: any;
  menu: any;
  message?: string;
}) {
  const layoutMeta = { metaTitle: 'Site protection', metaDescription: 'Password-protect this deployment' };

  const [state, setState] = useState<State | null>(null);
  const [password, setPassword] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/site-protection'), { credentials: 'include' });
      if (!res.ok) return;
      const json = (await res.json()) as State;
      setState(json);
      setHint(json.hint ?? '');
    } catch {
      setError('Could not load these settings.');
    }
  }, []);

  useEffect(() => {
    if (!message) void load();
  }, [load, message]);

  const save = useCallback(
    async (body: Record<string, unknown>, successNote: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(handoffApiUrl('/api/handoff/site-protection'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as State & { error?: string };
        if (!res.ok) {
          setError(json.error || 'Could not save that.');
          return;
        }
        setState(json);
        setHint(json.hint ?? '');
        setNotice(successNote);
      } catch {
        setError('Could not save that.');
      } finally {
        setBusy(false);
      }
    },
    []
  );

  if (message) {
    return (
      <Layout config={config} menu={menu} current={null} metadata={layoutMeta}>
        <div className="p-6">
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout config={config} menu={menu} current={null} metadata={layoutMeta}>
      <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">Site protection</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Put a shared password in front of this deployment, for showing work in progress before it is public.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
            {error}
          </p>
        ) : null}
        {notice ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p> : null}

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                {state?.enabled ? <Lock className="h-4 w-4" aria-hidden /> : <LockOpen className="h-4 w-4" aria-hidden />}
                Password protection
                {state ? (
                  <Badge variant={state.enabled ? 'default' : 'secondary'}>{state.enabled ? 'On' : 'Off'}</Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {state?.configured
                  ? 'A password is set. Turning this on asks every visitor for it.'
                  : 'Set a password below before turning this on.'}
              </CardDescription>
            </div>
            <Switch
              checked={Boolean(state?.enabled)}
              disabled={busy || !state?.configured}
              onCheckedChange={(enabled) =>
                void save({ enabled }, enabled ? 'Protection is on.' : 'Protection is off.')
              }
              aria-label="Password protection"
            />
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{state?.configured ? 'Change the password' : 'Set a password'}</CardTitle>
            <CardDescription>
              At least 8 characters. Changing it signs out everyone who is currently in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              aria-label="New site password"
            />
            <Button
              disabled={busy || password.trim().length < 8}
              onClick={() => {
                void save({ password }, 'Password saved. Everyone will need to enter it again.');
                setPassword('');
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Save password
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hint</CardTitle>
            <CardDescription>
              Optional, shown on the password screen. Anyone can read it, so keep it a reminder rather than a clue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="e.g. the usual project password"
              aria-label="Password hint"
            />
            <Button variant="outline" disabled={busy} onClick={() => void save({ hint }, 'Hint saved.')}>
              Save hint
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lock everyone out</CardTitle>
            <CardDescription>
              Keeps the same password but ends every current session, so everyone types it again. For when a link
              has travelled further than you meant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              disabled={busy || !state?.configured}
              onClick={() => void save({ lockEveryoneOut: true }, 'Everyone has been locked out.')}
            >
              Lock everyone out
            </Button>
          </CardContent>
        </Card>

        {/*
          * Said out loud rather than implied. An operator who thinks this protects the API will rely on it for
          * something it cannot do.
          */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              What this does not cover
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              This is a shared password, not an account. There is no record of who entered it, and anyone given
              it keeps access until you change it.
            </p>
            <p>
              It covers pages, not the API. Component CSS and JavaScript stay reachable — the page previews
              cannot render without them.
            </p>
            <p>People with an account sign in as usual and never see the password screen.</p>
            <p>Guest share links keep working. The link is its own credential.</p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
