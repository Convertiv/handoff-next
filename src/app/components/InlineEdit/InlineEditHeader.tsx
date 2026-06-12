'use client';

import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { useAuthUi } from '../context/AuthUiContext';
import { InlineEditField } from './InlineEditField';

interface InlineEditHeaderProps {
  slug: string;
  initialTitle: string;
  initialDescription: string;
  initialFrontmatter: Record<string, unknown>;
  markdown: string;
  /** Children rendered after the description (e.g. download buttons) */
  children?: React.ReactNode;
}

/**
 * Drop-in replacement for the static title + description block at the top of
 * any page. Authenticated users see hover-reveal pencil icons on both fields;
 * clicking enters an inline input that saves to the `handoff_page` table.
 *
 * Uses `useSession()` internally so it works equally from client and server
 * component parents without needing an explicit `canEdit` prop.
 */
export function InlineEditHeader({
  slug,
  initialTitle,
  initialDescription,
  initialFrontmatter,
  markdown,
  children,
}: InlineEditHeaderProps) {
  const { authEnabled } = useAuthUi();
  const { data: session, status } = useSession();

  const canEdit = authEnabled && status === 'authenticated' && Boolean(session?.user);

  // Track local state so saves reflect immediately without needing router.refresh()
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [frontmatter, setFrontmatter] = useState(initialFrontmatter);

  const editorHref = `/admin/pages/edit?slug=${encodeURIComponent(slug)}`;

  return (
    <div className="flex flex-col gap-2 pb-7">
      <div className="flex items-start justify-between gap-4">
        <InlineEditField
          value={title}
          slug={slug}
          frontmatterKey="title"
          allFrontmatter={frontmatter}
          markdown={markdown}
          as="h1"
          className="scroll-m-20 text-4xl font-bold tracking-tight"
          canEdit={canEdit}
          onSaved={(v) => {
            setTitle(v);
            setFrontmatter((prev) => ({ ...prev, title: v }));
          }}
        />
        {canEdit && (
          <Link
            href={editorHref}
            className="mt-1 flex shrink-0 items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100 focus:opacity-100"
            title="Open full editor"
            style={{ opacity: undefined }}
          >
            <ExternalLink className="h-3 w-3" />
            <span className="sr-only">Full editor</span>
          </Link>
        )}
      </div>

      {(description || canEdit) && (
        <InlineEditField
          value={description}
          slug={slug}
          frontmatterKey="description"
          allFrontmatter={frontmatter}
          markdown={markdown}
          as="p"
          className="text-lg leading-relaxed text-gray-600 dark:text-gray-300"
          canEdit={canEdit}
          onSaved={(v) => {
            setDescription(v);
            setFrontmatter((prev) => ({ ...prev, description: v }));
          }}
        />
      )}

      {children}
    </div>
  );
}
