import React from 'react';
import { getDataProvider } from '@/lib/data/index';
import { getClientRuntimeConfig } from '@/components/util';
import type { ComponentInput } from './health-types';
import { computeHealthSummary } from './health-types';
import { HealthDashboardClient } from './HealthDashboardClient';
import HeadersType from '@/components/Typography/Headers';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return { title: 'System Health', description: 'Validation health across all design system components.' };
}

export default async function HealthPage() {
  const provider = await getDataProvider();

  // Manifest tells us whether validators are configured and which ones to expect.
  // Use the provider method we added; fall back gracefully if it doesn't exist yet.
  const manifest = typeof (provider as any).getValidationManifest === 'function'
    ? await (provider as any).getValidationManifest()
    : null;

  // Only show the health dashboard when validation is explicitly configured.
  if (!manifest?.configured) {
    return (
      <div className="mx-auto max-w-2xl py-24 text-center space-y-4">
        <HeadersType.H1>System Health</HeadersType.H1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Validation isn't configured for this workspace yet. Add a{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">validation</code> block to your{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">handoff.config.js</code> to start
          tracking component health here.
        </p>
        <pre className="mx-auto w-fit rounded-lg bg-muted p-4 text-left text-xs leading-relaxed">
{`const { schema, axe, contrast } = require('handoff-app/validators');

module.exports = {
  // ...existing config
  validation: {
    validators: [
      schema(),
      axe({ spec: 'wcag21aa' }),
      contrast({ spec: 'wcag-aa' }),
    ],
  },
};`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Then run <code className="rounded bg-muted px-1 py-0.5">handoff-app push:all</code> — results appear here automatically.
        </p>
      </div>
    );
  }

  // Fetch all components and run history in parallel.
  const [components, history] = await Promise.all([
    provider.getComponents(),
    typeof (provider as any).getValidationRunHistory === 'function'
      ? (provider as any).getValidationRunHistory(30)
      : Promise.resolve([]),
  ]);

  const inputs: ComponentInput[] = components.map((c: any) => ({
    id: c.id,
    title: c.title ?? c.id,
    group: c.group ?? '',
    image: c.image,
    path: c.path ?? `/system/component/${c.id}`,
    validationResults: c.validationResults,
  }));

  const summary = computeHealthSummary(inputs, manifest);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <HeadersType.H1>System Health</HeadersType.H1>
        {summary.lastRunAt && (
          <p className="text-xs text-muted-foreground">
            Last checked {new Date(summary.lastRunAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        )}
      </div>
      <HealthDashboardClient summary={summary} manifest={manifest} history={history} />
    </div>
  );
}
