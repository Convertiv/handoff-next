import { redirect } from 'next/navigation';

const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

/** Icons live under the Foundations section. */
export default function DesignAssetsIconsRedirect() {
  redirect(`${basePath}/foundations/icons`);
}
