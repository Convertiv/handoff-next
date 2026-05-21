import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { requireHostedDatabase } from '@/lib/handoff-capabilities';
import { getDesignWorkspace, upsertDesignWorkspace } from '@/lib/server/design-workspace';
import type { DesignWorkspacePatch } from '@/lib/db/queries';
import { COMPONENT_REFERENCE_SETTINGS } from '@/app/design/settings/settings-constants';

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type PutBody = {
  designMd?: string;
  brandVoice?: Record<string, string>;
  includeFoundations?: boolean;
  customFoundationImageUrl?: string | null;
  componentReferences?: Record<string, { imageUrl: string; updatedAt?: string } | null>;
  /** Clear a component reference slot when true */
  clearComponentReference?: string;
};

export async function GET() {
  const dbErr = requireHostedDatabase();
  if (dbErr) return dbErr;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspace = await getDesignWorkspace();
  return NextResponse.json({ workspace });
}

export async function PUT(request: NextRequest) {
  const dbErr = requireHostedDatabase();
  if (dbErr) return dbErr;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 });
  }

  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const patch: DesignWorkspacePatch = {};

    const designMd = form.get('designMd');
    if (typeof designMd === 'string') patch.designMd = designMd;

    const brandVoiceRaw = form.get('brandVoice');
    if (typeof brandVoiceRaw === 'string' && brandVoiceRaw.trim()) {
      try {
        patch.brandVoice = JSON.parse(brandVoiceRaw) as Record<string, string>;
      } catch {
        return NextResponse.json({ error: 'Invalid brandVoice JSON' }, { status: 400 });
      }
    }

    const includeFoundations = form.get('includeFoundations');
    if (includeFoundations === 'true' || includeFoundations === 'false') {
      patch.includeFoundations = includeFoundations === 'true';
    }

    const clearFoundation = form.get('clearCustomFoundation');
    if (clearFoundation === 'true') {
      patch.customFoundationImageUrl = '';
    } else {
      const foundationFile = form.get('customFoundationImage');
      if (foundationFile instanceof File && ALLOWED_IMAGE_TYPES.has(foundationFile.type)) {
        const buf = Buffer.from(await foundationFile.arrayBuffer());
        patch.customFoundationImageUrl = `data:${foundationFile.type};base64,${buf.toString('base64')}`;
      }
    }

    const existing = await getDesignWorkspace();
    const refs = { ...existing.componentReferences };

    for (const setting of COMPONENT_REFERENCE_SETTINGS) {
      const clearKey = `clearComponentReference_${setting.id}`;
      if (form.get(clearKey) === 'true') {
        delete refs[setting.id];
        continue;
      }
      const file = form.get(`componentReference_${setting.id}`);
      if (file instanceof File && ALLOWED_IMAGE_TYPES.has(file.type)) {
        const buf = Buffer.from(await file.arrayBuffer());
        refs[setting.id] = {
          imageUrl: `data:${file.type};base64,${buf.toString('base64')}`,
          updatedAt: new Date().toISOString(),
        };
      }
    }
    patch.componentReferences = refs;

    const workspace = await upsertDesignWorkspace(patch, session.user.id);
    return NextResponse.json({ workspace });
  }

  const body = (await request.json().catch(() => ({}))) as PutBody;
  const patch: DesignWorkspacePatch = {};

  if (body.designMd !== undefined) patch.designMd = String(body.designMd);
  if (body.brandVoice !== undefined) patch.brandVoice = body.brandVoice;
  if (body.includeFoundations !== undefined) patch.includeFoundations = Boolean(body.includeFoundations);

  if (body.customFoundationImageUrl === null || body.customFoundationImageUrl === '') {
    patch.customFoundationImageUrl = '';
  } else if (typeof body.customFoundationImageUrl === 'string') {
    patch.customFoundationImageUrl = body.customFoundationImageUrl;
  }

  if (body.componentReferences !== undefined || body.clearComponentReference) {
    const existing = await getDesignWorkspace();
    const refs = { ...existing.componentReferences, ...body.componentReferences };
    if (body.clearComponentReference) {
      delete refs[body.clearComponentReference];
    }
    for (const [slot, val] of Object.entries(refs)) {
      if (val === null) delete refs[slot];
    }
    patch.componentReferences = refs as Record<string, { imageUrl: string; updatedAt?: string }>;
  }

  const workspace = await upsertDesignWorkspace(patch, session.user.id);
  return NextResponse.json({ workspace });
}
