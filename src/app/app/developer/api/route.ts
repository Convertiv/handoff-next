import { ApiReference } from '@scalar/nextjs-api-reference';

export const GET = ApiReference({
  spec: { url: '/api/openapi' },
  pageTitle: 'Handoff REST API',
  metaData: {
    title: 'Handoff REST API',
    description: 'Interactive API reference for Handoff 2.0 — push, sync, components, tokens, icons, and more.',
  },
  theme: 'default',
  layout: 'modern',
  defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
});
