import { getClientRuntimeConfig } from '../../components/util';
import { getDataProvider } from '../../lib/data';
import PatternBrowserClient from './PatternBrowserClient';

export const metadata = {
  title: 'Patterns',
  description: 'Browse, search, and open saved layout patterns.',
};

export default async function PatternsPage() {
  const config = getClientRuntimeConfig();
  const menu = await getDataProvider().getMenu();
  return <PatternBrowserClient menu={menu} config={config} />;
}
