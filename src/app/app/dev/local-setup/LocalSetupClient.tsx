'use client';

import { handoffApiUrl, handoffBasePath } from '@/lib/api-path';
import { Button } from '@/components/ui/button';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import McpSetupSection from './McpSetupSection';

type LocalSetupClientProps = {
  mcpOnThisHost: boolean;
  /** Team Handoff origin when this page is not the MCP host (local filesystem mode). */
  fallbackMcpUrl: string;
};

export default function LocalSetupClient({ mcpOnThisHost, fallbackMcpUrl }: LocalSetupClientProps) {
  const { data: session, status } = useSession();
  const [copied, setCopied] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const handoffUrl = useMemo(() => {
    const base = handoffBasePath();
    if (!origin) return '';
    return base ? `${origin}${base}`.replace(/\/+$/, '') : origin.replace(/\/+$/, '');
  }, [origin]);

  const mcpHandoffUrl = mcpOnThisHost ? handoffUrl : fallbackMcpUrl || handoffUrl;
  const remoteUrl = mcpHandoffUrl || handoffUrl;

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const envSnippet = `HANDOFF_CLOUD_URL=${remoteUrl || 'https://your-handoff.example.com'}
# Optional if you use \`handoff-app login\` (recommended):
# (credentials saved to .handoff/cli-auth.json — no HANDOFF_CLOUD_TOKEN needed)

# Legacy / CI — same value as server HANDOFF_SYNC_SECRET:
# HANDOFF_CLOUD_TOKEN=...
`;

  const loginCmd = `handoff-app login --url ${remoteUrl || 'https://your-handoff.example.com'}`;

  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!session?.user) {
    return (
      <div className="space-y-8">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Sign in to see team-specific links and the CLI authorization page.</p>
          <Button asChild variant="default">
            <Link href={`${handoffApiUrl('/login')}?callbackUrl=${encodeURIComponent(`${handoffBasePath()}/dev/local-setup`)}`}>Sign in</Link>
          </Button>
        </div>
        <McpSetupSection handoffUrl={mcpHandoffUrl} mcpOnThisHost={mcpOnThisHost} />
      </div>
    );
  }

  return (
    <div className="space-y-8 text-sm leading-relaxed">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">1. Recommended: OAuth device login</h2>
        <p className="text-muted-foreground">
          Run <code className="rounded bg-muted px-1">handoff-app login</code> in your design repo. Open the printed URL, sign in here if needed, and approve the CLI. Your access token is stored in{' '}
          <code className="rounded bg-muted px-1">.handoff/cli-auth.json</code> (add that path to <code className="rounded bg-muted px-1">.gitignore</code> if you do not want it committed).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{loginCmd}</pre>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy('login', loginCmd)}>
            {copied === 'login' ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p>
          <Link className="text-primary underline" href={handoffApiUrl('/cli/device')}>
            Open CLI authorization page
          </Link>{' '}
          (after <code className="rounded bg-muted px-1">login</code> prints a user code, you can approve here.)
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">2. Pull and push</h2>
        <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">
          {`handoff-app pull
handoff-app push`}
        </pre>
        <p className="text-muted-foreground">
          <code className="rounded bg-muted px-1">pull</code> needs <code className="rounded bg-muted px-1">sync:read</code> (all signed-in users). <code className="rounded bg-muted px-1">push</code> needs <code className="rounded bg-muted px-1">sync:write</code> (admins only via CLI login).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">3. Legacy: shared secret (CI / automation)</h2>
        <p className="text-muted-foreground">
          If you do not use <code className="rounded bg-muted px-1">login</code>, set <code className="rounded bg-muted px-1">HANDOFF_CLOUD_TOKEN</code> to the same value as the server&apos;s <code className="rounded bg-muted px-1">HANDOFF_SYNC_SECRET</code>. This is a <strong>team secret</strong> — prefer device login for laptops.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{envSnippet}</pre>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy('env', envSnippet)}>
            {copied === 'env' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </section>

      <McpSetupSection handoffUrl={mcpHandoffUrl} mcpOnThisHost={mcpOnThisHost} />

      <section>
        <Button type="button" variant="ghost" size="sm" className="px-0" onClick={() => void copy('logout', 'handoff-app logout')}>
          Remove saved CLI token: <code className="rounded bg-muted px-1">handoff-app logout</code> {copied === 'logout' ? '(copied)' : ''}
        </Button>
      </section>
    </div>
  );
}
