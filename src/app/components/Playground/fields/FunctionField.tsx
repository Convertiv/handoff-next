/**
 * Function prop (e.g. 8x8's `onClick`). Not authorable in a content form —
 * behavior is wired in code, not preview data. We render a read-only chip
 * showing the signature so the field is legible instead of being dumped as
 * JSON (the old `default` case) or hidden entirely.
 */
export function FunctionField({ value }: { identifier: string[]; value: any; data: any }) {
  const signature = value?.generic || value?.sourceType || 'function';
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-input bg-muted/30 px-3 py-2">
      <code className="truncate font-mono text-xs text-muted-foreground" title={String(signature)}>
        {String(signature)}
      </code>
      <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
        set in code
      </span>
    </div>
  );
}
