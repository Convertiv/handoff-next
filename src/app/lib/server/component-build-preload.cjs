// Polyfill esbuild's __name helper so it's available globally before tsx
// transforms any module. Without this, sass/Vite fails when loaded through tsx.
globalThis.__name = globalThis.__name || function (target) { return target; };
