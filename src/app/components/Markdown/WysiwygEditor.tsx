'use client';

import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { Bold, Code, Italic, Link as LinkIcon, Table as TableIcon, Columns2, Rows2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import './wysiwyg.css';

interface WysiwygEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export function WysiwygEditor({
  content,
  onChange,
  placeholder = 'Start writing…',
  containerRef,
}: WysiwygEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'underline text-primary cursor-pointer' },
      }),
      Placeholder.configure({ placeholder }),
      Typography,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: false,
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[200px]',
        spellCheck: 'true',
      },
    },
    onUpdate({ editor }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (editor.storage as any).markdown.getMarkdown() as string;
      onChangeRef.current(md);
    },
    immediatelyRender: false,
  });

  // Sync content from outside
  useEffect(() => {
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = (editor.storage as any).markdown.getMarkdown() as string;
    if (content !== current) editor.commands.setContent(content);
  }, [content, editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL', prev ?? '');
    if (url === null) return;
    if (url === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div ref={containerRef} className="wysiwyg-root relative">
      <SelectionToolbar editor={editor} onSetLink={setLink} />
      <EditorContent editor={editor} />
    </div>
  );
}

// ── Selection-based floating toolbar ────────────────────────────────────────

function SelectionToolbar({
  editor,
  onSetLink,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  onSetLink: () => void;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Re-render whenever selection or marks change
  const state = useEditorState({
    editor,
    selector: (ctx) => ({
      isBold: ctx.editor.isActive('bold'),
      isItalic: ctx.editor.isActive('italic'),
      isCode: ctx.editor.isActive('code'),
      isLink: ctx.editor.isActive('link'),
      isInTable: ctx.editor.isActive('table'),
      isEmpty: ctx.editor.state.selection.empty,
    }),
  });

  // Position the toolbar above the current selection (or active table cell)
  useEffect(() => {
    const hasSelection = !state.isEmpty;
    const showForTable = state.isInTable;

    if (!hasSelection && !showForTable) {
      setVisible(false);
      return;
    }

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) {
      setVisible(false);
      return;
    }

    const range = domSelection.getRangeAt(0);
    if (range.collapsed && !showForTable) {
      setVisible(false);
      return;
    }

    setVisible(true);

    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const rect = range.getBoundingClientRect();
    const virtualEl = {
      getBoundingClientRect: () => rect,
      getClientRects: () => [rect],
    };

    void computePosition(virtualEl as unknown as Element, toolbar, {
      placement: 'top-start',
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      toolbar.style.left = `${x}px`;
      toolbar.style.top = `${y}px`;
    });
  }, [state.isEmpty, state.isInTable, state.isBold, state.isItalic, state.isCode, state.isLink]);

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border bg-popover px-1 py-1 shadow-md"
      // Prevent mousedown from stealing focus from editor
      onMouseDown={(e) => e.preventDefault()}
    >
      <ToolbarButton
        active={state.isBold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (⌘B)"
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={state.isItalic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (⌘I)"
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={state.isCode}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline code"
      >
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>
      <div className="mx-0.5 h-4 w-px bg-border" />
      <ToolbarButton active={state.isLink} onClick={onSetLink} title="Link">
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      <div className="mx-0.5 h-4 w-px bg-border" />
      <HeadingPicker editor={editor} />
      <div className="mx-0.5 h-4 w-px bg-border" />
      {state.isInTable ? (
        <TableControls editor={editor} />
      ) : (
        <ToolbarButton
          active={false}
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
          title="Insert table"
        >
          <TableIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
      )}
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'flex h-7 w-7 items-center justify-center rounded text-sm transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function TableControls({
  editor,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
}) {
  return (
    <>
      <div className="group/tc relative">
        <button
          type="button"
          className="flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Column actions"
        >
          <Columns2 className="h-3.5 w-3.5" />
        </button>
        <div className="absolute left-0 top-full z-50 mt-1 hidden min-w-[140px] flex-col rounded-lg border bg-popover shadow-md group-hover/tc:flex group-focus-within/tc:flex">
          {[
            { label: 'Add column before', fn: () => editor.chain().focus().addColumnBefore().run() },
            { label: 'Add column after', fn: () => editor.chain().focus().addColumnAfter().run() },
            { label: 'Delete column', fn: () => editor.chain().focus().deleteColumn().run() },
          ].map(({ label, fn }) => (
            <button
              key={label}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); fn(); }}
              className="px-4 py-1.5 text-left text-sm text-muted-foreground first:rounded-t-lg last:rounded-b-lg hover:bg-muted hover:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="group/tr relative">
        <button
          type="button"
          className="flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Row actions"
        >
          <Rows2 className="h-3.5 w-3.5" />
        </button>
        <div className="absolute left-0 top-full z-50 mt-1 hidden min-w-[140px] flex-col rounded-lg border bg-popover shadow-md group-hover/tr:flex group-focus-within/tr:flex">
          {[
            { label: 'Add row before', fn: () => editor.chain().focus().addRowBefore().run() },
            { label: 'Add row after', fn: () => editor.chain().focus().addRowAfter().run() },
            { label: 'Delete row', fn: () => editor.chain().focus().deleteRow().run() },
          ].map(({ label, fn }) => (
            <button
              key={label}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); fn(); }}
              className="px-4 py-1.5 text-left text-sm text-muted-foreground first:rounded-t-lg last:rounded-b-lg hover:bg-muted hover:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ToolbarButton
        active={false}
        onClick={() => editor.chain().focus().deleteTable().run()}
        title="Delete table"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </ToolbarButton>
    </>
  );
}

function HeadingPicker({
  editor,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
}) {
  const levels = [1, 2, 3] as const;
  const activeLevel = levels.find((l) => editor.isActive('heading', { level: l }));
  const label = activeLevel ? `H${activeLevel}` : 'P';

  return (
    <div className="group/hp relative">
      <button
        type="button"
        className="flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Text style"
      >
        {label}
      </button>
      <div className="absolute left-0 top-full z-50 mt-1 hidden flex-col rounded-lg border bg-popover shadow-md group-hover/hp:flex group-focus-within/hp:flex">
        {(['P', 'H1', 'H2', 'H3'] as const).map((t) => {
          const level = t === 'P' ? null : (Number(t[1]) as 1 | 2 | 3);
          const isActive = level
            ? editor.isActive('heading', { level })
            : editor.isActive('paragraph');
          return (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                if (level) editor.chain().focus().toggleHeading({ level }).run();
                else editor.chain().focus().setParagraph().run();
              }}
              className={[
                'px-4 py-1.5 text-left text-sm first:rounded-t-lg last:rounded-b-lg hover:bg-muted',
                isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
              ].join(' ')}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}
