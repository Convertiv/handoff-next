import { startCase } from 'lodash';
import { getClientRuntimeConfig, getCurrentSection } from '../../../../components/util';
import { getDataProvider } from '../../../../lib/data';
import PatternDetailClient from './PatternDetailClient';

export const dynamicParams = false;

export async function generateStaticParams() {
  const pats = (await getDataProvider().getPatterns()).map((p) => ({ pattern: p.id }));
  return pats.length > 0 ? pats : [{ pattern: '_placeholder' }];
}

export async function generateMetadata({ params }: { params: Promise<{ pattern: string }> }) {
  const { pattern } = await params;
  const patterns = await getDataProvider().getPatterns();
  const patternData = patterns.find((p) => p.id === pattern);
  const config = getClientRuntimeConfig();
  const fallbackTitle = patternData?.title || startCase(pattern);
  const metaTitle = `${fallbackTitle}${config?.app?.client ? ` | ${config.app.client} Design System` : ''}`;
  return { title: metaTitle, description: patternData?.description || '' };
}

export default async function PatternPage({ params }: { params: Promise<{ pattern: string }> }) {
  const { pattern } = await params;
  const patterns = await getDataProvider().getPatterns();
  const menu = await getDataProvider().getMenu();
  const config = getClientRuntimeConfig();
  const patternData = patterns.find((p) => p.id === pattern);

  const sameGroupPatterns = patterns.filter((p) => p.group === patternData?.group);
  const groupIndex = sameGroupPatterns.findIndex((p) => p.id === pattern);
  const previousPattern = sameGroupPatterns[groupIndex - 1] ?? null;
  const nextPattern = sameGroupPatterns[groupIndex + 1] ?? null;

  const fallbackTitle = patternData?.title || startCase(pattern);

  return (
    <PatternDetailClient
      id={pattern}
      menu={menu}
      config={config}
      current={getCurrentSection(menu, '/system') ?? []}
      metadata={{
        title: fallbackTitle,
        description: patternData?.description || '',
        metaTitle: `${fallbackTitle}${config?.app?.client ? ` | ${config.app.client} Design System` : ''}`,
        metaDescription: patternData?.description || '',
      }}
      previousPattern={previousPattern}
      nextPattern={nextPattern}
    />
  );
}
