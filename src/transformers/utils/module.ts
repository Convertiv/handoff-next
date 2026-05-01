import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { ModuleEvaluationResult } from '@handoff/transformers/types';
import { DEFAULT_SSR_BUILD_CONFIG } from './build.js';

const requireFromHere = createRequire(import.meta.url);

function createModuleBuildConfig(entryPath: string, handoff: any): esbuild.BuildOptions {
  const defaultBuildConfig: esbuild.BuildOptions = {
    ...DEFAULT_SSR_BUILD_CONFIG,
    entryPoints: [entryPath],
  };

  return handoff.config?.hooks?.ssrBuildConfig
    ? handoff.config.hooks.ssrBuildConfig(defaultBuildConfig)
    : defaultBuildConfig;
}

function evaluateBuiltModule(code: string): ModuleEvaluationResult {
  const mod: any = { exports: {} };
  const func = new Function('require', 'module', 'exports', code);
  func(requireFromHere, mod, mod.exports);
  return mod;
}

/**
 * Builds and evaluates a module using esbuild
 * @param entryPath - Path to the module entry point
 * @param handoff - Handoff instance for configuration
 * @returns Module evaluation result with exports
 */
export async function buildAndEvaluateModule(
  entryPath: string, 
  handoff: any
): Promise<ModuleEvaluationResult> {
  const buildConfig = createModuleBuildConfig(entryPath, handoff);
  const build = await esbuild.build(buildConfig);
  const { text: code } = build.outputFiles[0];
  return evaluateBuiltModule(code);
}

/**
 * Builds and evaluates a module synchronously using esbuild.
 * Used by config/runtime code paths that must remain synchronous.
 */
export function buildAndEvaluateModuleSync(
  entryPath: string,
  handoff: any
): ModuleEvaluationResult {
  const buildConfig = createModuleBuildConfig(entryPath, handoff);
  const build = esbuild.buildSync(buildConfig);
  const { text: code } = build.outputFiles[0];
  return evaluateBuiltModule(code);
}
