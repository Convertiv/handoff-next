import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { auth } from '../../../lib/auth';
import { usePostgres } from '../../../lib/db/dialect';
import type { AiCostByUserRow, AiEventRow } from '../../../lib/db/queries';

export const metadata: Metadata = {
  title: 'Account AI Cost',
  description: 'AI usage and estimated cost',
};

export const dynamic = 'force-dynamic';

function currency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export default async function AccountAiCostPage() {
  if (!usePostgres()) {
    return null;
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/account/ai-cost');
  }

  if (session.user.role !== 'admin') {
    return <p className="text-sm text-muted-foreground">You need administrator access to view this page.</p>;
  }

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let aiEvents: AiEventRow[] = [];
  let aiByUser: AiCostByUserRow[] = [];

  try {
    const { getAiEventsForRange, getAiCostByUser } = await import('../../../lib/db/queries');
    [aiEvents, aiByUser] = await Promise.all([
      getAiEventsForRange({ from, to: now, limit: 200 }),
      getAiCostByUser({ from, to: now }),
    ]);
  } catch {
    aiEvents = [];
    aiByUser = [];
  }

  const totalCost = aiEvents.reduce((sum, event) => sum + Number(event.estimatedCostUsd || 0), 0);

  return (
    <>
      <div>
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">AI Cost</h1>
          <span className="text-sm text-muted-foreground">Last 30 days — {currency(totalCost)}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Review recent AI usage and estimated spend.</p>
      </div>

      {aiByUser.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By user</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aiByUser.map((row, index) => (
                  <TableRow key={row.userId ?? `anon-${index}`}>
                    <TableCell className="text-sm">
                      {row.name || row.email || <span className="text-muted-foreground">Unknown</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm">{row.calls}</TableCell>
                    <TableCell className="text-right text-sm">
                      {row.failedCalls > 0 ? <span className="text-destructive">{row.failedCalls}</span> : '0'}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{currency(row.totalCostUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {aiEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No AI events in the last 30 days.</p>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent events</CardTitle>
            <CardDescription>Up to 200 most recent AI calls from the last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aiEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {event.actorName || event.actorEmail || event.actorUserId || '—'}
                    </TableCell>
                    <TableCell className="text-xs">{event.eventType}</TableCell>
                    <TableCell className="text-xs">{event.model || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={event.status === 'error' ? 'destructive' : 'outline'}>{event.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {currency(Number(event.estimatedCostUsd || 0))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
