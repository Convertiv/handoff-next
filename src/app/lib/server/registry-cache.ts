import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getRegistryConfig, getRegistryNavigation, type RegistryConfigData, type NavigationNode } from '../db/registry-queries';
import { getUserCount } from '../db/queries';
import { getHandoffPageBySlug } from './doc-pages';
import { isPostgres } from '../db/dialect';

/**
 * Cross-request caching for the registry read hot-path.
 *
 * The root layout runs on EVERY request (registry mode) and, uncached, fired a
 * cluster of live Postgres reads per hit — registry config, navigation tree,
 * component summaries, user count — plus per-page content reads. With only
 * developer traffic that was enough to keep the Neon compute endpoint from ever
 * auto-suspending (~0.25 CU sustained 24/7). See DEVLOG 2026-07-21.
 *
 * These wrappers move those reads into Next's Data Cache. On a cache hit the
 * request does ZERO Postgres work, so query volume drops from ~per-request to
 * at most once per `revalidate` window per key — letting Neon idle between real
 * content changes. Freshness is preserved two ways:
 *   1. Tag-based invalidation on every write path (see `revalidateRegistry*`).
 *   2. A time-based `revalidate` floor as a safety net if a write path is missed.
 *
 * Only the read-path (layout / data provider) uses these. Admin/mutation routes
 * keep calling the raw `registry-queries` functions directly so they always see
 * fresh data.
 */
export const REGISTRY_TAGS = {
  config: 'registry-config',
  nav: 'registry-nav',
  components: 'registry-components',
  users: 'registry-users',
  pages: 'registry-pages',
} as const;

/** Content revalidates at most every 5 min even if a write path forgets to invalidate. */
const CONTENT_TTL = 300;
/** Users effectively never un-exist; long floor, invalidated explicitly on setup. */
const USERS_TTL = 3600;

export const getCachedRegistryConfig = unstable_cache(
  async (): Promise<RegistryConfigData | null> => getRegistryConfig(),
  ['registry-config'],
  { tags: [REGISTRY_TAGS.config], revalidate: CONTENT_TTL }
);

export const getCachedRegistryNavigation = unstable_cache(
  async (): Promise<NavigationNode[] | null> => getRegistryNavigation(),
  ['registry-nav'],
  { tags: [REGISTRY_TAGS.nav], revalidate: CONTENT_TTL }
);

export const getCachedUserCount = unstable_cache(
  async (): Promise<number> => getUserCount(),
  ['registry-user-count'],
  { tags: [REGISTRY_TAGS.users], revalidate: USERS_TTL }
);

/**
 * Per-slug cached page read. Used by the public doc routes (page body +
 * generateMetadata both read it within one request). Keyed by slug so each page
 * caches independently and can be invalidated individually on push.
 */
export function getCachedPageBySlug(slug: string) {
  // Workspace mode (no DB) runs the same routes — keep its path byte-identical by
  // only engaging the Data Cache in registry mode.
  if (!isPostgres()) return getHandoffPageBySlug(slug);
  return unstable_cache(
    async () => getHandoffPageBySlug(slug),
    ['registry-page', slug],
    { tags: [REGISTRY_TAGS.pages, `registry-page:${slug}`], revalidate: CONTENT_TTL }
  )();
}

// Next 16 requires a cache-life profile as the second arg; 'max' is the
// documented value for an on-demand purge (no time-based expiry imposed).
const PURGE = 'max';

/** Invalidate the registry config read cache — call after any config write. */
export function revalidateRegistryConfig(): void {
  revalidateTag(REGISTRY_TAGS.config, PURGE);
}

/** Invalidate the navigation tree read cache — call after any nav write. */
export function revalidateRegistryNavigation(): void {
  revalidateTag(REGISTRY_TAGS.nav, PURGE);
}

/** Invalidate the component-summaries read cache — call after any component write. */
export function revalidateRegistryComponents(): void {
  revalidateTag(REGISTRY_TAGS.components, PURGE);
}

/** Invalidate the user-count read cache — call after user creation/deletion. */
export function revalidateRegistryUsers(): void {
  revalidateTag(REGISTRY_TAGS.users, PURGE);
}

/**
 * Invalidate cached page content. Pass a slug to invalidate one page (plus the
 * shared nav, which page pushes can reshape); omit to invalidate all pages.
 */
export function revalidateRegistryPages(slug?: string): void {
  revalidateTag(REGISTRY_TAGS.pages, PURGE);
  revalidateTag(REGISTRY_TAGS.nav, PURGE);
  if (slug) revalidateTag(`registry-page:${slug}`, PURGE);
}
