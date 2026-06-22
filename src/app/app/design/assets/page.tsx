import { redirect } from 'next/navigation';

const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

/** The asset library now lives under /foundations/assets. */
export default function DesignAssetsRedirect() {
  redirect(`${basePath}/foundations/assets`);
}
