import { getDb } from '../db';
import { handoffComponents } from '../db/schema';
import { discoverFilesystemComponents, ingestComponentDir } from './component-ingest';
import { loadHandoffConfigFile, resolveComponentEntryDirs } from './handoff-config-load';

export type ComponentDiffStatus = 'new' | 'modified' | 'unchanged' | 'db_only';

export type FieldDiff = {
  field: string;
  filesystem: string | null;
  database: string | null;
};

export type ComponentDiff = {
  id: string;
  status: ComponentDiffStatus;
  fields: FieldDiff[];
  /** Present when a DB row exists (`disk` | `db` | `figma`). */
  dbSource?: string | null;
};

/** Deterministic JSON for diffing (sorted object keys recursively). */
function stable(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((v) => stable(v)).join(',')}]`;
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(rec[k])}`).join(',')}}`;
}

function payloadFromDbRow(data: unknown, row: typeof handoffComponents.$inferSelect): Record<string, unknown> {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    group: row.group ?? '',
    image: row.image ?? '',
    type: row.type ?? '',
    properties: row.properties ?? {},
    previews: row.previews ?? {},
  };
}

const COMPARE_KEYS = ['title', 'description', 'group', 'image', 'type', 'properties', 'previews', 'entrySources', 'renderer', 'categories', 'tags'] as const;

/**
 * Compare filesystem components (from `entries.components`) with DB rows.
 */
export async function diffFilesystemVsDatabase(): Promise<ComponentDiff[]> {
  const loaded = loadHandoffConfigFile();
  const roots = resolveComponentEntryDirs(loaded?.config ?? null);
  const dirs = discoverFilesystemComponents(roots);
  const db = getDb();
  const dbRows = db ? await db.select().from(handoffComponents) : [];
  const dbById = new Map(dbRows.map((r) => [r.id, r]));

  const fsIds = new Set<string>();
  const out: ComponentDiff[] = [];

  for (const dir of dirs) {
    let ingested;
    try {
      ingested = ingestComponentDir(dir);
    } catch {
      continue;
    }
    const { id, payload } = ingested;
    fsIds.add(id);
    const row = dbById.get(id);
    if (!row) {
      out.push({
        id,
        status: 'new',
        fields: COMPARE_KEYS.map((field) => ({
          field,
          filesystem: stable((payload as Record<string, unknown>)[field]),
          database: null,
        })),
        dbSource: null,
      });
      continue;
    }

    const dbPayload = payloadFromDbRow(row.data, row);
    const fields: FieldDiff[] = [];
    for (const field of COMPARE_KEYS) {
      const fsVal = (payload as Record<string, unknown>)[field];
      const dbVal = dbPayload[field];
      if (stable(fsVal) !== stable(dbVal)) {
        fields.push({
          field,
          filesystem: typeof fsVal === 'string' ? fsVal : stable(fsVal),
          database: typeof dbVal === 'string' ? dbVal : stable(dbVal),
        });
      }
    }

    out.push({
      id,
      status: fields.length === 0 ? 'unchanged' : 'modified',
      fields,
      dbSource: row.source ?? null,
    });
  }

  for (const row of dbRows) {
    if (!fsIds.has(row.id)) {
      const dbPayload = payloadFromDbRow(row.data, row);
      out.push({
        id: row.id,
        status: 'db_only',
        fields: COMPARE_KEYS.map((field) => ({
          field,
          filesystem: null,
          database: stable(dbPayload[field]),
        })),
        dbSource: row.source ?? null,
      });
    }
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}
