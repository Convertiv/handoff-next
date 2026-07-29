import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDesignArtifactOwnerId } from '@/lib/db/queries';
import { getActorGrant, resolveShareLink } from '@/lib/db/grant-queries';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { artifactIdFromBlobPathname, readPrivateBlob } from '@/lib/storage/artifact-images';

/**
 * Streams a design artifact's image out of the PRIVATE Blob store.
 *
 * Artifact images are stored privately (see `lib/storage/artifact-images.ts`) and persisted as
 * `/api/handoff/artifact-asset?p=<pathname>` so that `<img src>` keeps working while every read is
 * authorized. Possession of the URL is deliberately NOT sufficient — the whole reason for a private
 * store is that the Library's visibility lanes, grants and share links would otherwise be
 * bypassable by anyone who ever saw an image URL.
 *
 * Two ways to be allowed:
 *  - a signed-in user whose permissions on the owning artifact include `canView`
 *  - a valid, unrevoked, unexpired share link for that artifact (`?t=<token>`), which is how the
 *    public `/s/[token]` page renders images without a session
 *
 * Denials are 404, matching the artifact routes, so this cannot be used to probe which artifacts
 * or blobs exist.
 */
export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.searchParams.get('p')?.trim();
  if (!pathname) {
    return NextResponse.json({ error: 'Missing p' }, { status: 400 });
  }

  const artifactId = artifactIdFromBlobPathname(pathname);
  if (!artifactId) {
    // Not a path this route owns — refuse rather than proxying arbitrary blobs.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const owner = await getDesignArtifactOwnerId(artifactId);
    if (!owner) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    let allowed = false;

    const shareToken = request.nextUrl.searchParams.get('t')?.trim();
    if (shareToken) {
      const link = await resolveShareLink(shareToken);
      allowed = !!link && link.resourceType === 'design_artifact' && link.resourceId === artifactId;
    }

    if (!allowed) {
      const session = await auth();
      if (session?.user?.id) {
        const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
        const grant = await getActorGrant('design_artifact', artifactId, session.user.id);
        const perms = computePermissions(
          actor,
          { ownerUserId: owner.userId, visibility: toVisibility(owner.visibility) },
          grant
        );
        allowed = perms.canView;
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const read = await readPrivateBlob(pathname);
    if (!read) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(read.buffer), {
      status: 200,
      headers: {
        'Content-Type': read.contentType,
        'Content-Length': String(read.buffer.byteLength),
        // Blob pathnames carry a random suffix, so a given URL's bytes never change — but the
        // response is authorized per-viewer, so it must never land in a shared cache.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Read failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
