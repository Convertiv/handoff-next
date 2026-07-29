import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Top-level routes that belong to the Tools area of the app. Everything else
 * is treated as Knowledge content. Shared by MainNav, SideNav, and Layout so
 * the grouping can't drift between the three.
 */
export const TOOLS_PATHS = ['/library', '/design', '/patterns', '/playground'];

export const trimSlashes = (input: string | null | undefined): string => {
  if (typeof input !== 'string') return '';
  return input.replace(/^\/+|\/+$/g, '');
};

export const toAbsolutePath = (input: string | null | undefined): string => {
  return `/${trimSlashes(input)}`;
};

export const normalizePathForMatch = (input: string | null | undefined): string => {
  if (typeof input !== 'string') return '';
  const [pathname] = input.split(/[?#]/);
  return trimSlashes(pathname);
};

/**
 * Filters out null values
 * @param value
 * @returns
 */
export const filterOutNull = <T>(value: T): value is NonNullable<T> => value !== null;
