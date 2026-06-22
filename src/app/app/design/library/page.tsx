import { redirect } from 'next/navigation';

const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

/**
 * The standalone "saved designs" list has moved into the Design workbench's
 * Library sidebar tab. This route now redirects there; individual saved designs
 * still live at /design/library/[id].
 */
export default function DesignsLibraryRedirect() {
  redirect(`${basePath}/design`);
}
