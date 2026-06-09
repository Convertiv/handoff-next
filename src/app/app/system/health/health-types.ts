/**
 * Re-export from @/lib/health-types so page-collocated UI components can
 * import from './health-types' as before, while API routes and lib modules
 * import from '@/lib/health-types' — avoiding cross-app-directory relative
 * imports that Next.js's bundler disallows.
 */
export * from '@/lib/health-types';
