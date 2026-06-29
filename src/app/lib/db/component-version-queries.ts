import { createHash } from 'node:crypto';
import { desc, eq, gte, max, sql } from 'drizzle-orm';
import { getDb } from './index';
import { componentArtifacts, handoffComponents, handoffComponentVersions, users } from './schema';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ComponentChangeSummary {
  firstVersion: boolean;
  metadataChanged: boolean;
  /** Which top-level snapshot fields changed (e.g. ['title', 'properties']) */
  fieldsChanged: string[];
  sourceAdded: string[];
  sourceModified: string[];
  sourceRemoved: string[];
  artifactsChanged: boolean;
  /** Total artifact count at this version */
  artifactCount: number;
}

export interface ComponentVersionSnapshot {
  title: string;
  description: string | null;
  group: string | null;
  path: string | null;
  type: string | null;
  properties: unknown;
  previews: unknown;
  data: unknown;
}

export interface ComponentVersionRecord {
  id: number;
  componentId: string;
  versionNumber: number;
  pushedAt: Date;
  pushedByUserId: string | null;
  pushedByName: string | null;
  pushedByEmail: string | null;
  trigger: string;
  snapshot: ComponentVersionSnapshot;
  changeSummary: ComponentChangeSummary;
  sourceFileHashes: Record<string, string>;
  artifactFilenames: string[];
}

/**
 * Light row for the history list — same shape as a full record but with the
 * heavy snapshot fields (`data`/`properties`/`previews`) omitted. The history
 * UI only renders title/description/group/type + change summary + file lists,
 * so the list query never transfers the full per-version `data` blob (which
 * embeds the whole ComponentObject).
 */
export interface ComponentVersionListItem {
  id: number;
  componentId: string;
  versionNumber: number;
  pushedAt: Date;
  pushedByUserId: string | null;
  pushedByName: string | null;
  pushedByEmail: string | null;
  trigger: string;
  snapshot: Pick<ComponentVersionSnapshot, 'title' | 'description' | 'group' | 'type'>;
  changeSummary: ComponentChangeSummary;
  sourceFileHashes: Record<string, string>;
  artifactFilenames: string[];
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** 12-hex-char fingerprint of a string — good enough for change detection. */
function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Keys (at any depth in a component `data`/preview blob) that are *derived* or
 * *per-run volatile* — they change on every push without representing an
 * authored change, so we exclude them from version change-detection. Leaving
 * them in produced a new version on EVERY push: `validationResults` carries a
 * fresh `runAt` timestamp + `durationMs` each run, and `sharedStyles` is the
 * compiled global CSS (recompiled on any token change, duplicated into every
 * component). Real component changes still surface via `code`/`css`/`html` in
 * `data` and via `sourceFileHashes`.
 */
const VOLATILE_FINGERPRINT_KEYS = new Set(['validationResults', 'validations', 'sharedStyles']);

/**
 * Canonicalize a value for fingerprinting: sort object keys (so key-order
 * churn doesn't read as a change) and drop volatile/derived keys recursively.
 */
function canonicalizeForFingerprint(val: unknown): unknown {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(canonicalizeForFingerprint);
  const obj = val as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (VOLATILE_FINGERPRINT_KEYS.has(key)) continue;
    out[key] = canonicalizeForFingerprint(obj[key]);
  }
  return out;
}

/** Stable JSON fingerprint for an arbitrary object (handles null). */
function objectFingerprint(val: unknown): string {
  if (val == null) return 'null';
  return fingerprint(JSON.stringify(canonicalizeForFingerprint(val)));
}

// ─── Core recording function ─────────────────────────────────────────────────

/**
 * Compare the incoming push data against the last recorded version and, if
 * anything changed (or no version exists yet), insert a new version row.
 *
 * Call this AFTER `upsertComponentSources` and `upsertComponentArtifacts` have
 * already run so the live tables are up to date.
 *
 * @param componentId   The component being pushed
 * @param userId        Auth user who triggered the push
 * @param trigger       'push' | 'push:all' | 'manual'
 * @param newRow        The component metadata written during this push
 * @param incomingSourceFiles  { filePath → content } from the push payload
 *                             (empty object if sources weren't included)
 * @param incomingArtifactFilenames  Filenames from the push payload
 *                                   (empty array if artifacts weren't included)
 */
export async function recordComponentVersion(params: {
  componentId: string;
  userId: string | null;
  trigger: string;
  newRow: {
    title: string;
    description: string | null;
    group: string | null;
    path: string | null;
    type: string | null;
    properties: unknown;
    previews: unknown;
    data: unknown;
  };
  incomingSourceFiles: Record<string, string>;
  incomingArtifactFilenames: string[];
}): Promise<void> {
  const { componentId, userId, trigger, newRow, incomingSourceFiles, incomingArtifactFilenames } = params;
  const db = getDb();

  // ── 1. Read the latest version row (if any) ──────────────────────────────
  const [prevVersion] = await db
    .select()
    .from(handoffComponentVersions)
    .where(eq(handoffComponentVersions.componentId, componentId))
    .orderBy(desc(handoffComponentVersions.versionNumber))
    .limit(1);

  const isFirstVersion = !prevVersion;

  // ── 2. Compute new source file hashes ─────────────────────────────────────
  // If the push didn't include source files, carry over the previous hashes.
  const prevSourceHashes = (prevVersion?.sourceFileHashes ?? {}) as Record<string, string>;
  const newSourceHashes: Record<string, string> =
    Object.keys(incomingSourceFiles).length > 0
      ? Object.fromEntries(Object.entries(incomingSourceFiles).map(([p, c]) => [p, fingerprint(c)]))
      : { ...prevSourceHashes };

  // ── 3. Artifact filenames: use incoming or fall back to live DB ────────────
  // If artifacts were included in the push, use them. Otherwise query live.
  let newArtifactFilenames: string[];
  if (incomingArtifactFilenames.length > 0) {
    newArtifactFilenames = [...incomingArtifactFilenames].sort();
  } else {
    const rows = await db
      .select({ filename: componentArtifacts.filename })
      .from(componentArtifacts)
      .where(eq(componentArtifacts.componentId, componentId));
    newArtifactFilenames = rows.map((r) => r.filename).sort();
  }

  // ── 4. Build change summary ───────────────────────────────────────────────
  let changeSummary: ComponentChangeSummary;

  if (isFirstVersion) {
    changeSummary = {
      firstVersion: true,
      metadataChanged: false,
      fieldsChanged: [],
      sourceAdded: Object.keys(newSourceHashes),
      sourceModified: [],
      sourceRemoved: [],
      artifactsChanged: newArtifactFilenames.length > 0,
      artifactCount: newArtifactFilenames.length,
    };
  } else {
    const prevSnap = (prevVersion.snapshot ?? {}) as Record<string, unknown>;
    const prevArtifacts = ((prevVersion.artifactFilenames ?? []) as string[]).sort();

    // Metadata diff — compare snapshot fields
    const METADATA_FIELDS: (keyof typeof newRow)[] = [
      'title', 'description', 'group', 'path', 'type', 'properties', 'previews', 'data',
    ];
    const fieldsChanged: string[] = [];
    for (const field of METADATA_FIELDS) {
      const prevVal = prevSnap[field] ?? null;
      const newVal = newRow[field] ?? null;
      // Use fingerprint comparison for objects, direct for primitives
      const prevFp = typeof prevVal === 'object' ? objectFingerprint(prevVal) : String(prevVal ?? '');
      const newFp = typeof newVal === 'object' ? objectFingerprint(newVal) : String(newVal ?? '');
      if (prevFp !== newFp) fieldsChanged.push(field);
    }
    const metadataChanged = fieldsChanged.length > 0;

    // Source diff
    const prevKeys = new Set(Object.keys(prevSourceHashes));
    const newKeys = new Set(Object.keys(newSourceHashes));
    const sourceAdded = [...newKeys].filter((k) => !prevKeys.has(k));
    const sourceRemoved = [...prevKeys].filter((k) => !newKeys.has(k));
    const sourceModified = [...newKeys].filter(
      (k) => prevKeys.has(k) && prevSourceHashes[k] !== newSourceHashes[k]
    );

    // Artifact diff — compare sorted filename lists
    const artifactsChanged =
      prevArtifacts.length !== newArtifactFilenames.length ||
      prevArtifacts.some((f, i) => f !== newArtifactFilenames[i]);

    // Skip the insert if nothing actually changed
    if (
      !metadataChanged &&
      sourceAdded.length === 0 &&
      sourceModified.length === 0 &&
      sourceRemoved.length === 0 &&
      !artifactsChanged
    ) {
      return; // identical push — no new version
    }

    changeSummary = {
      firstVersion: false,
      metadataChanged,
      fieldsChanged,
      sourceAdded,
      sourceModified,
      sourceRemoved,
      artifactsChanged,
      artifactCount: newArtifactFilenames.length,
    };
  }

  // ── 5. Resolve pusher display info ────────────────────────────────────────
  let pushedByName: string | null = null;
  let pushedByEmail: string | null = null;
  if (userId) {
    const [userRow] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    pushedByName = userRow?.name ?? null;
    pushedByEmail = userRow?.email ?? null;
  }

  // ── 6. Get next version number ────────────────────────────────────────────
  const [maxRow] = await db
    .select({ maxVer: max(handoffComponentVersions.versionNumber) })
    .from(handoffComponentVersions)
    .where(eq(handoffComponentVersions.componentId, componentId));
  const nextVersionNumber = (maxRow?.maxVer ?? 0) + 1;

  // ── 7. Insert the version row ─────────────────────────────────────────────
  await db.insert(handoffComponentVersions).values({
    componentId,
    versionNumber: nextVersionNumber,
    pushedAt: new Date(),
    pushedByUserId: userId,
    pushedByName,
    pushedByEmail,
    trigger,
    snapshot: newRow as object,
    changeSummary: changeSummary as object,
    sourceFileHashes: newSourceHashes as object,
    artifactFilenames: newArtifactFilenames as unknown as object,
  });
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function getComponentVersionHistory(
  componentId: string,
  limit = 50
): Promise<ComponentVersionListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: handoffComponentVersions.id,
      componentId: handoffComponentVersions.componentId,
      versionNumber: handoffComponentVersions.versionNumber,
      pushedAt: handoffComponentVersions.pushedAt,
      pushedByUserId: handoffComponentVersions.pushedByUserId,
      pushedByName: handoffComponentVersions.pushedByName,
      pushedByEmail: handoffComponentVersions.pushedByEmail,
      trigger: handoffComponentVersions.trigger,
      // Extract only the light snapshot fields the history UI shows — never the
      // full `data`/`properties`/`previews` jsonb.
      snapTitle: sql<string | null>`${handoffComponentVersions.snapshot}->>'title'`,
      snapDescription: sql<string | null>`${handoffComponentVersions.snapshot}->>'description'`,
      snapGroup: sql<string | null>`${handoffComponentVersions.snapshot}->>'group'`,
      snapType: sql<string | null>`${handoffComponentVersions.snapshot}->>'type'`,
      changeSummary: handoffComponentVersions.changeSummary,
      sourceFileHashes: handoffComponentVersions.sourceFileHashes,
      artifactFilenames: handoffComponentVersions.artifactFilenames,
    })
    .from(handoffComponentVersions)
    .where(eq(handoffComponentVersions.componentId, componentId))
    .orderBy(desc(handoffComponentVersions.versionNumber))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    componentId: r.componentId,
    versionNumber: r.versionNumber,
    pushedAt: r.pushedAt as Date,
    pushedByUserId: r.pushedByUserId,
    pushedByName: r.pushedByName,
    pushedByEmail: r.pushedByEmail,
    trigger: r.trigger,
    snapshot: {
      title: r.snapTitle ?? '',
      description: r.snapDescription,
      group: r.snapGroup,
      type: r.snapType,
    },
    changeSummary: (r.changeSummary ?? {}) as ComponentChangeSummary,
    sourceFileHashes: (r.sourceFileHashes ?? {}) as Record<string, string>,
    artifactFilenames: ((r.artifactFilenames ?? []) as string[]),
  }));
}

export async function getComponentVersionCount(componentId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(handoffComponentVersions)
    .where(eq(handoffComponentVersions.componentId, componentId));
  return Number(row?.cnt ?? 0);
}

export async function getComponentVersion(
  componentId: string,
  versionNumber: number
): Promise<ComponentVersionRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(handoffComponentVersions)
    .where(eq(handoffComponentVersions.componentId, componentId));
  const match = rows.find((r) => r.versionNumber === versionNumber);
  return match ? rowToRecord(match) : null;
}

// ─── Internal mapper ──────────────────────────────────────────────────────────

function rowToRecord(r: typeof handoffComponentVersions.$inferSelect): ComponentVersionRecord {
  return {
    id: r.id,
    componentId: r.componentId,
    versionNumber: r.versionNumber,
    pushedAt: r.pushedAt as Date,
    pushedByUserId: r.pushedByUserId,
    pushedByName: r.pushedByName,
    pushedByEmail: r.pushedByEmail,
    trigger: r.trigger,
    snapshot: (r.snapshot ?? {}) as ComponentVersionSnapshot,
    changeSummary: (r.changeSummary ?? {}) as ComponentChangeSummary,
    sourceFileHashes: (r.sourceFileHashes ?? {}) as Record<string, string>,
    artifactFilenames: ((r.artifactFilenames ?? []) as string[]),
  };
}

// ─── Cross-component recent changes ──────────────────────────────────────────

export interface RecentChangeRow {
  id: number;
  componentId: string;
  componentTitle: string;
  componentGroup: string;
  versionNumber: number;
  pushedAt: Date;
  pushedByName: string | null;
  pushedByEmail: string | null;
  trigger: string;
  changeSummary: ComponentChangeSummary;
}

export async function getRecentComponentChanges(
  limit = 50,
  since?: Date
): Promise<RecentChangeRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: handoffComponentVersions.id,
      componentId: handoffComponentVersions.componentId,
      versionNumber: handoffComponentVersions.versionNumber,
      pushedAt: handoffComponentVersions.pushedAt,
      pushedByName: handoffComponentVersions.pushedByName,
      pushedByEmail: handoffComponentVersions.pushedByEmail,
      trigger: handoffComponentVersions.trigger,
      changeSummary: handoffComponentVersions.changeSummary,
      componentTitle: handoffComponents.title,
      componentGroup: handoffComponents.group,
    })
    .from(handoffComponentVersions)
    .leftJoin(handoffComponents, eq(handoffComponentVersions.componentId, handoffComponents.id))
    .where(since ? gte(handoffComponentVersions.pushedAt, since) : undefined)
    .orderBy(desc(handoffComponentVersions.pushedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    componentId: r.componentId,
    versionNumber: r.versionNumber,
    pushedAt: r.pushedAt as Date,
    pushedByName: r.pushedByName,
    pushedByEmail: r.pushedByEmail,
    trigger: r.trigger,
    changeSummary: (r.changeSummary as unknown as ComponentChangeSummary) ?? {
      firstVersion: false,
      metadataChanged: false,
      fieldsChanged: [],
      sourceAdded: [],
      sourceModified: [],
      sourceRemoved: [],
      artifactsChanged: false,
      artifactCount: 0,
    },
    componentTitle: r.componentTitle ?? r.componentId,
    componentGroup: r.componentGroup ?? '',
  }));
}
