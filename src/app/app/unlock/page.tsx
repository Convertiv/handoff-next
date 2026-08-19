import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProtectionState } from '../../lib/server/site-protection';
import UnlockClient from './UnlockClient';

export const metadata: Metadata = {
  title: 'Enter password',
  // Nothing here should ever be indexed, and the page exists only to be typed into.
  robots: { index: false, follow: false },
};

/**
 * The curtain (`docs/SITE-PASSWORD.md`).
 *
 * Exempt from the gate itself via `GATE_EXEMPT_PREFIXES` — without that, the redirect target would also be
 * gated and the app would bounce forever.
 *
 * Deliberately **not** wrapped in the app's `Layout`: the person looking at it has not been let in yet, and the
 * navigation would leak the shape of the deployment — page titles, component names — which is some of what the
 * password is there to cover.
 */
export default async function UnlockPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const state = await getProtectionState();
  // Nothing to unlock. Sending them home is friendlier than a form that cannot succeed.
  if (!state.enabled) redirect('/');

  const sp = searchParams ? await searchParams : undefined;
  /**
   * Relative paths only. `next` is reflected into a redirect after a successful unlock, so an absolute URL
   * here would be an open redirect — and one reached by typing the right password, which is worse.
   */
  const raw = typeof sp?.next === 'string' ? sp.next : '/';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';

  return <UnlockClient hint={state.hint} next={next} />;
}
