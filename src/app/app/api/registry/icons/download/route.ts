import archiver from 'archiver';
import { getDb } from '@/lib/db';
import { handoffRegistryIcons } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { IconCatalogEntry } from '@/lib/data/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SINGLETON_ID = 'default';

export async function GET(): Promise<Response> {
  let catalog: IconCatalogEntry[];
  try {
    const db = getDb();
    const [row] = await db.select().from(handoffRegistryIcons).where(eq(handoffRegistryIcons.id, SINGLETON_ID)).limit(1);
    catalog = (row?.catalog as IconCatalogEntry[]) ?? [];
  } catch (e) {
    return new Response('Registry error', { status: 500 });
  }

  if (catalog.length === 0) {
    return new Response('No icons found — run push:all from your workspace first.', { status: 404 });
  }

  const zip = await new Promise<Buffer>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.append(JSON.stringify(catalog, null, 2), { name: 'catalog.json' });

    for (const entry of catalog) {
      const { source } = entry;
      if (source.type === 'custom' || source.type === 'fa-pro') {
        const safeName = entry.id.replace(/[^a-z0-9_\-]/gi, '-');
        archive.append(source.svg, { name: `svg/${safeName}.svg` });
      }
    }

    archive.finalize();
  });

  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="icons.zip"',
    },
  });
}
