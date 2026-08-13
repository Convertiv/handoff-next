/**
 * A sliding-window counter, in memory.
 *
 * **What it is for, and what it is not.** This is burst protection on the unauthenticated guest paths (reflow
 * R.3): entering a link, creating a page, submitting one, and the email that submission sends. It makes a
 * script that hammers an endpoint stop being free.
 *
 * ⚠️ **It is per-isolate, and that is a real limitation, not a footnote.** On serverless each warm instance
 * keeps its own map, so the effective limit across N instances is N × the number here, and a cold start forgets
 * everything. It is therefore **not the ceiling** on anything that matters. The durable ceiling on guest writes
 * is `MAX_PAGES_PER_SHARE_LINK`, which is counted in the database and cannot be evaded by spreading requests
 * across instances. Read this as "slows a burst", never as "bounds the damage".
 *
 * Four copies of this loop already existed inline in AI and Figma routes. This one is shared and documented;
 * those are left alone rather than refactored under an unrelated change, but the next one is free.
 */

const hits = new Map<string, number[]>();

/**
 * How many events this key has had inside the window, **and** record this one.
 *
 * One call rather than a check/record pair on purpose: the two-call shape invites a caller to check, take a
 * slow path, and forget to record — which reads as a working limit that counts nothing.
 *
 * @returns the count *including* this event, so `> limit` is the refusal test.
 */
export function hitCount(key: string, windowMs: number, now: number = Date.now()): number {
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(key, recent);

  /**
   * Keep the map from growing without bound.
   *
   * A guest key is a link token, and links are unbounded over time — without this the map is a slow leak in a
   * long-lived isolate. Cheap because it only runs when the map is already large.
   */
  if (hits.size > 5_000) {
    for (const [k, times] of hits) {
      if (!times.some((t) => t > cutoff)) hits.delete(k);
    }
  }

  return recent.length;
}

/** True when this event should be refused — `limit` events per window are allowed, the next one is not. */
export function isRateLimited(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  return hitCount(key, windowMs, now) > limit;
}

/** Test seam. Never called in production code — a limiter that forgets on demand is not one. */
export function __resetRateLimits(): void {
  hits.clear();
}

/**
 * The guest limits, in one place so they can be read against each other.
 *
 * Chosen to be invisible to a person and obstructive to a script. A visitor enters a link once and submits
 * once; ten entries a minute is already someone testing something.
 */
export const GUEST_LIMITS = {
  /** Opening a share link: passphrase attempts have their own lockout, this is the outer bound. */
  enter: { limit: 10, windowMs: 60_000 },
  /** Creating a page from a template. The hard cap is per link and lives in the database. */
  create: { limit: 5, windowMs: 60_000 },
  /**
   * Submitting. Low, because each success sends an email carrying a bearer credential — a submit loop is also
   * a mail loop, and the address is attacker-supplied.
   */
  submit: { limit: 5, windowMs: 60_000 },
} as const;
