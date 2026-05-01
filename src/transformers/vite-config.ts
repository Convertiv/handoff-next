import type { InlineConfig } from 'vite';
import { createViteLogger } from './utils/vite-logger.js';

const viteBaseConfig: InlineConfig = {
  customLogger: createViteLogger(),
  publicDir: false,
  build: {
    lib: {
      entry: '',
      formats: ['es'],
      fileName: (_, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: [],
    },
    emptyOutDir: false,
    minify: true,
  },
};

export default viteBaseConfig;
