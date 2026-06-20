import archiver from 'archiver';
import { getRegistryDtcg } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Format = 'dtcg' | 'tailwind' | 'css' | 'scss';

function bufferZip(files: { name: string; content: string }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    for (const { name, content } of files) {
      archive.append(content, { name });
    }
    archive.finalize();
  });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const format = (searchParams.get('format') ?? 'dtcg') as Format;

  let payload: Awaited<ReturnType<typeof getRegistryDtcg>>;
  try {
    payload = await getRegistryDtcg();
  } catch (e) {
    return new Response('Registry error', { status: 500 });
  }

  if (!payload) {
    return new Response('No DTCG tokens found — run push:all from your workspace first.', { status: 404 });
  }

  if (format === 'dtcg') {
    const json = JSON.stringify(payload.dtcg, null, 2);
    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="tokens.dtcg.json"',
      },
    });
  }

  if (format === 'tailwind') {
    return new Response(payload.tailwind, {
      headers: {
        'Content-Type': 'text/css',
        'Content-Disposition': 'attachment; filename="tailwind-theme.css"',
      },
    });
  }

  if (format === 'css') {
    const zip = await bufferZip([{ name: 'tokens.css', content: payload.css }]);
    return new Response(zip, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="tokens-css.zip"',
      },
    });
  }

  if (format === 'scss') {
    const zip = await bufferZip([{ name: '_tokens.scss', content: payload.scss }]);
    return new Response(zip, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="tokens-scss.zip"',
      },
    });
  }

  return new Response('Invalid format. Use ?format=dtcg|tailwind|css|scss', { status: 400 });
}
