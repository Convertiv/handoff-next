'use client';

import { useMemo, useState } from 'react';
import Layout from '../../../components/Layout/Main';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

type AiEvent = {
  id: number;
  createdAt: Date | null;
  eventType: string;
  status: string;
  model: string | null;
  provider: string | null;
  route: string | null;
  estimatedInputTokens: number | null;
  estimatedOutputTokens: number | null;
  estimatedCostUsd: number;
  requestPreview: string | null;
  error: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
};

type AiSummary = {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalCostUsd: number;
  byModel: { model: string; calls: number; totalCostUsd: number; failedCalls: number }[];
  byDay: { day: string; calls: number; totalCostUsd: number }[];
};

function currency(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString();
}

function truncate(value: string | null | undefined, max = 120): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default function AiCostClient({
  config,
  menu,
  initialEvents,
  initialSummary,
  message,
}: {
  config: any;
  menu: any;
  initialEvents: AiEvent[];
  initialSummary: AiSummary;
  message?: string;
}) {
  const layoutMeta = { metaTitle: 'AI Cost', metaDescription: 'AI usage and estimated cost' };
  const [rangeDays, setRangeDays] = useState<7 | 30>(30);

  const filteredEvents = useMemo(() => {
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    return initialEvents.filter((event) => {
      if (!event.createdAt) return false;
      const ts = typeof event.createdAt === 'string' ? new Date(event.createdAt).getTime() : event.createdAt.getTime();
      return ts >= cutoff;
    });
  }, [initialEvents, rangeDays]);

  const computed = useMemo(() => {
    const totalCalls = filteredEvents.length;
    const failedCalls = filteredEvents.filter((event) => event.status === 'error').length;
    const successCalls = totalCalls - failedCalls;
    const totalCostUsd = filteredEvents.reduce((sum, event) => sum + Number(event.estimatedCostUsd || 0), 0);

    const byModelMap = new Map<string, { calls: number; failedCalls: number; totalCostUsd: number }>();
    for (const event of filteredEvents) {
      const model = event.model || 'unknown';
      const current = byModelMap.get(model) ?? { calls: 0, failedCalls: 0, totalCostUsd: 0 };
      current.calls += 1;
      if (event.status === 'error') current.failedCalls += 1;
      current.totalCostUsd += Number(event.estimatedCostUsd || 0);
      byModelMap.set(model, current);
    }
    const byModel = [...byModelMap.entries()]
      .map(([model, value]) => ({ model, ...value }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

    return {
      totalCalls,
      successCalls,
      failedCalls,
      totalCostUsd,
      byModel,
      topModel: byModel[0]?.model ?? '—',
      errorRate: totalCalls > 0 ? (failedCalls / totalCalls) * 100 : 0,
    };
  }, [filteredEvents]);

  return (
    <Layout config={config} menu={menu} current={null} metadata={layoutMeta}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">AI Cost</h1>
            <p className="text-sm text-muted-foreground">Estimated spend for server-side AI API calls.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={rangeDays === 7 ? 'default' : 'outline'} size="sm" onClick={() => setRangeDays(7)}>
              Last 7 days
            </Button>
            <Button variant={rangeDays === 30 ? 'default' : 'outline'} size="sm" onClick={() => setRangeDays(30)}>
              Last 30 days
            </Button>
          </div>
        </div>

        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Estimated Cost</CardDescription>
                  <CardTitle className="text-2xl">{currency(computed.totalCostUsd)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Calls</CardDescription>
                  <CardTitle className="text-2xl">{computed.totalCalls}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Error Rate</CardDescription>
                  <CardTitle className="text-2xl">{computed.errorRate.toFixed(1)}%</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Top Model</CardDescription>
                  <CardTitle className="text-lg">{computed.topModel}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">By model ({rangeDays}d)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {computed.byModel.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No AI calls in this range.</p>
                ) : (
                  computed.byModel.map((row) => (
                    <div key={row.model} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div className="font-medium">{row.model}</div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span>{row.calls} calls</span>
                        <span>{row.failedCalls} failed</span>
                        <span>{currency(row.totalCostUsd)}</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent AI events</CardTitle>
                <CardDescription>Showing up to 200 server-side AI events from the last 30 days.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>Request</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEvents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-muted-foreground">No events in this range.</TableCell>
                      </TableRow>
                    ) : (
                      filteredEvents.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</TableCell>
                          <TableCell className="text-xs">
                            {event.actorName || event.actorEmail || event.actorUserId || '—'}
                          </TableCell>
                          <TableCell className="text-xs">{event.eventType}</TableCell>
                          <TableCell className="text-xs">{event.model || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={event.status === 'error' ? 'destructive' : 'outline'}>{event.status}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{currency(Number(event.estimatedCostUsd || 0))}</TableCell>
                          <TableCell className="max-w-[320px] text-xs text-muted-foreground" title={event.requestPreview || undefined}>
                            {event.status === 'error' ? `${truncate(event.error, 120)}` : truncate(event.requestPreview, 120)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}

        {!message ? (
          <p className="text-xs text-muted-foreground">
            Estimates use model pricing assumptions from server config and may differ from final provider billing.
            Loaded baseline summary: {initialSummary.totalCalls} calls / {currency(initialSummary.totalCostUsd)} over last 30 days.
          </p>
        ) : null}
      </div>
    </Layout>
  );
}
