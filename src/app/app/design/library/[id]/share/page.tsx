import type { Metadata } from 'next';
import SharePublicClient from './SharePublicClient';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Shared design — ${(id ?? '').slice(0, 8)}…`,
    description: 'Shared design from Handoff.',
  };
}

export default async function DesignSharePage({ params }: PageProps) {
  const { id } = await params;
  const artifactId = (id ?? '').trim();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SharePublicClient artifactId={artifactId} />
    </div>
  );
}
