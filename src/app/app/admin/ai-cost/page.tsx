import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getClientRuntimeConfig } from '../../../components/util';
import { getDataProvider } from '../../../lib/data';
import { getAiCostSummaryForRange, getAiEventsForRange } from '../../../lib/db/queries';
import { auth } from '../../../lib/auth';
import { isDynamic } from '../../../lib/mode';
import AiCostClient from './AiCostClient';

export const metadata: Metadata = {
  title: 'AI Cost',
  description: 'AI usage and estimated cost',
};

export default async function AdminAiCostPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();

  if (!isDynamic()) {
    return (
      <AiCostClient
        config={config}
        menu={menu}
        initialEvents={[]}
        initialSummary={{ totalCalls: 0, successCalls: 0, failedCalls: 0, totalCostUsd: 0, byModel: [], byDay: [] }}
        message="AI cost analytics are only available in dynamic mode."
      />
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/admin/ai-cost');
  }
  if (session.user.role !== 'admin') {
    return (
      <AiCostClient
        config={config}
        menu={menu}
        initialEvents={[]}
        initialSummary={{ totalCalls: 0, successCalls: 0, failedCalls: 0, totalCostUsd: 0, byModel: [], byDay: [] }}
        message="You need administrator access to view this page."
      />
    );
  }

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let initialEvents: Awaited<ReturnType<typeof getAiEventsForRange>> = [];
  let initialSummary: Awaited<ReturnType<typeof getAiCostSummaryForRange>> = {
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    totalCostUsd: 0,
    byModel: [],
    byDay: [],
  };

  try {
    [initialSummary, initialEvents] = await Promise.all([
      getAiCostSummaryForRange({ from, to: now }),
      getAiEventsForRange({ from, to: now, limit: 200 }),
    ]);
  } catch {
    initialEvents = [];
  }

  return <AiCostClient config={config} menu={menu} initialEvents={initialEvents} initialSummary={initialSummary} />;
}
