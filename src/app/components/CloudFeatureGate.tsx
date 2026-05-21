import Link from 'next/link';

type Props = {
  feature: string;
  children: React.ReactNode;
  enabled: boolean;
};

/** Renders children when cloud/hosted features are available; otherwise setup instructions. */
export default function CloudFeatureGate({ feature, children, enabled }: Props) {
  if (enabled) return <>{children}</>;

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-muted/30 p-8 text-center">
      <h2 className="text-lg font-semibold">{feature} requires team Handoff</h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Local mode serves docs and components from your repo. Connect to a hosted Handoff instance for design library, AI,
        and sync.
      </p>
      <p className="mt-4">
        <Link href="/dev/local-setup" className="text-primary underline underline-offset-4">
          Set up HANDOFF_CLOUD_URL
        </Link>
      </p>
    </div>
  );
}
