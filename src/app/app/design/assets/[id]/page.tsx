import { redirect } from 'next/navigation';

const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

type Props = { params: Promise<{ id: string }> };

/** Asset detail now lives under /foundations/assets/[id]. */
export default async function DesignAssetDetailRedirect({ params }: Props) {
  const { id } = await params;
  redirect(`${basePath}/foundations/assets/${id}`);
}
