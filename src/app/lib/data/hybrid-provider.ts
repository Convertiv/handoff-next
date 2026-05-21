import { StaticDataProvider } from './static-provider';

/**
 * Local dev without Postgres: filesystem-only data (components, pages, tokens from disk).
 */
export class HybridDataProvider extends StaticDataProvider {}
