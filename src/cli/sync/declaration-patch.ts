/**
 * Patch `.handoff.ts` declaration sources by replacing the config object inside define* calls.
 */

const DEFINE_REACT = 'defineReactComponent';
const DEFINE_HB = 'defineHandlebarsComponent';
const DEFINE_CSF = 'defineCsfComponent';
const DEFINE_PATTERN = 'definePattern';

function skipWhitespace(source: string, i: number): number {
  while (i < source.length && /\s/.test(source[i]!)) i++;
  return i;
}

function findBalancedBraceEnd(source: string, openIndex: number): number {
  let depth = 0;
  let inString: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipCallArgument(source: string, start: number): number {
  let i = skipWhitespace(source, start);
  if (source[i] === ')') return i;

  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let inString: '"' | "'" | '`' | null = null;
  let escaped = false;
  let angle = 0;

  for (; i < source.length; i++) {
    const ch = source[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '<') angle++;
    if (ch === '>' && angle > 0) angle--;
    if (angle > 0) continue;
    if (ch === '(') paren++;
    if (ch === ')') {
      if (paren === 0 && brace === 0 && bracket === 0) return i;
      paren--;
    }
    if (ch === '{') brace++;
    if (ch === '}') brace--;
    if (ch === '[') bracket++;
    if (ch === ']') bracket--;
    if (ch === ',' && paren === 0 && brace === 0 && bracket === 0) return i;
  }
  return i;
}

function formatConfigLiteral(config: Record<string, unknown>): string {
  return JSON.stringify(config, null, 2);
}

function patchTwoArgDefine(source: string, defineName: string, config: Record<string, unknown>): string | null {
  const idx = source.indexOf(`${defineName}(`);
  if (idx < 0) return null;
  let i = idx + defineName.length + 1;
  i = skipCallArgument(source, i);
  if (source[i] !== ',') return null;
  i++;
  i = skipWhitespace(source, i);
  if (source[i] !== '{') return null;
  const end = findBalancedBraceEnd(source, i);
  if (end < 0) return null;
  return source.slice(0, i) + formatConfigLiteral(config) + source.slice(end + 1);
}

function patchOneArgDefine(source: string, defineName: string, config: Record<string, unknown>): string | null {
  const idx = source.indexOf(`${defineName}(`);
  if (idx < 0) return null;
  let i = idx + defineName.length + 1;
  i = skipWhitespace(source, i);
  if (source[i] !== '{') return null;
  const end = findBalancedBraceEnd(source, i);
  if (end < 0) return null;
  return source.slice(0, i) + formatConfigLiteral(config) + source.slice(end + 1);
}

export function mergeRemoteMetadataIntoLocalConfig(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  opts?: { preserveEntries?: boolean; preserveRenderer?: boolean }
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...local };
  const keys = [
    'id',
    'name',
    'title',
    'description',
    'group',
    'type',
    'image',
    'tags',
    'categories',
    'properties',
    'previews',
    'figma',
    'shouldDo',
    'shouldNotDo',
    'should_do',
    'should_not_do',
  ];
  for (const key of keys) {
    if (remote[key] !== undefined) merged[key] = remote[key];
  }
  if (!opts?.preserveRenderer && remote.renderer !== undefined) {
    merged.renderer = remote.renderer;
  }
  if (!opts?.preserveEntries && remote.entries !== undefined) {
    merged.entries = remote.entries;
  }
  if (typeof merged.name !== 'string' && typeof merged.title === 'string') {
    merged.name = merged.title;
  }
  return merged;
}

export function patchHandoffDeclarationSource(
  source: string,
  mergedConfig: Record<string, unknown>
): string | null {
  if (source.includes(`${DEFINE_REACT}(`)) {
    return patchTwoArgDefine(source, DEFINE_REACT, mergedConfig);
  }
  if (source.includes(`${DEFINE_HB}(`)) {
    return patchOneArgDefine(source, DEFINE_HB, mergedConfig);
  }
  if (source.includes(`${DEFINE_CSF}(`)) {
    return patchOneArgDefine(source, DEFINE_CSF, mergedConfig);
  }
  if (source.includes(`${DEFINE_PATTERN}(`)) {
    return patchOneArgDefine(source, DEFINE_PATTERN, mergedConfig);
  }
  return null;
}

export function remotePayloadToHandoffConfig(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.handoffConfig && typeof payload.handoffConfig === 'object') {
    return { ...(payload.handoffConfig as Record<string, unknown>) };
  }
  const data = payload.data;
  if (data && typeof data === 'object') {
    const hc = (data as Record<string, unknown>).handoffConfig;
    if (hc && typeof hc === 'object') {
      return { ...(hc as Record<string, unknown>) };
    }
  }
  return { ...payload };
}
