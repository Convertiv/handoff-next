export type { ConfigDiffStrategy, FinalizeContext, RebuildHandle } from './types.js';
export { type MapSnapshot, diffMapSnapshots, stableStringify } from './snapshot.js';
export { patternDiffStrategy } from './strategies/pattern.js';
export { getAllStrategies, getStrategy, runAllFinalizers } from './registry.js';
