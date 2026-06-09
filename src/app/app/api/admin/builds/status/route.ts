import { NextResponse } from 'next/server';

/**
 * Lightweight build-status probe used by the header BuildBadge.
 * Returns { active: boolean, count: number } without requiring auth —
 * the header can show a spinner without exposing any details.
 */
export async function GET() {
  try {
    const { getMergedAdminBuildTasks } = await import('@/lib/db/queries');
    const tasks = await getMergedAdminBuildTasks(40, 40, 20);

    const ACTIVE_COMPONENT = new Set(['queued', 'building', 'validating', 'iterating', 'generating']);
    const ACTIVE_ASSET = new Set(['pending', 'extracting']);

    const active = tasks.some((t) => {
      if (t.kind === 'component_build') return ACTIVE_COMPONENT.has(t.status);
      if (t.kind === 'design_asset_extraction') return ACTIVE_ASSET.has(t.status);
      if (t.kind === 'component_generation') return ACTIVE_COMPONENT.has(t.status);
      return false;
    });

    const count = tasks.filter((t) => {
      if (t.kind === 'component_build') return ACTIVE_COMPONENT.has(t.status);
      if (t.kind === 'design_asset_extraction') return ACTIVE_ASSET.has(t.status);
      if (t.kind === 'component_generation') return ACTIVE_COMPONENT.has(t.status);
      return false;
    }).length;

    return NextResponse.json({ active, count });
  } catch {
    return NextResponse.json({ active: false, count: 0 });
  }
}
