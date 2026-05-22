'use client';

type Props = {
  componentId: string;
  onBuildComplete?: () => void;
};

/** Server-side preview builds are retired — previews sync via CLI push. */
export function BuildStatusBanner(_props: Props) {
  return (
    <p className="text-xs text-gray-600 dark:text-gray-400">
      Hosted previews update via <code className="text-[11px]">handoff-app push --build</code> from your local repo.
    </p>
  );
}
