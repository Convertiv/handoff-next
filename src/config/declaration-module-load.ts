import { createRequire } from 'node:module';
import path from 'path';

type Esbuild = typeof import('esbuild');

const requireFromHere = createRequire(import.meta.url);

function getEsbuild(): Esbuild {
  // Lazy + runtime require so Next/Turbopack does not statically trace `esbuild` optional
  // platform packages (native binaries, README) into the bundle graph.
  return requireFromHere('esbuild') as Esbuild;
}

/**
 * Bundle and evaluate a `.handoff.ts` declaration (same strategy as runtime `loadDeclarationFile`).
 * `handoffModulePath` must be the directory that contains `handoff-app`'s `package.json`
 * (usually the Handoff package root / repo root).
 */
export function evaluateTypeScriptDeclaration(filePath: string, handoffModulePath: string): unknown {
  const esbuild = getEsbuild();
  let buildResult: import('esbuild').BuildResult;
  try {
    buildResult = esbuild.buildSync({
      entryPoints: [filePath],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      target: 'node16',
      logLevel: 'silent',
      jsx: 'automatic',
      external: ['react', 'react-dom', 'handoff-app'],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`esbuild failed for declaration "${filePath}": ${msg}`);
  }
  if (buildResult.errors?.length) {
    throw new Error(
      `esbuild failed for declaration "${filePath}": ${buildResult.errors.map((x) => x.text).join('; ')}`
    );
  }

  const code = buildResult.outputFiles?.[0]?.text;
  if (!code) {
    throw new Error(`Unable to compile declaration file "${filePath}"`);
  }

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const localRequire = createRequire(filePath);
  const handoffRequire = createRequire(path.resolve(handoffModulePath, 'package.json'));
  const runtimeRequire = (id: string) => {
    // Always load the Handoff package that owns this loader. Resolving `handoff-app` from
    // `createRequire(componentDeclarationPath)` walks from the component folder and can pick
    // the wrong install, an incomplete workspace link, or fail before reaching the real package.
    if (id === 'handoff-app') {
      return handoffRequire(id);
    }
    try {
      return localRequire(id);
    } catch {
      return handoffRequire(id);
    }
  };
  const evaluator = new Function('require', 'module', 'exports', '__filename', '__dirname', code);
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    evaluator(runtimeRequire, mod, mod.exports, filePath, path.dirname(filePath));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Declaration evaluation failed for "${filePath}": ${msg}`);
  }
  return mod.exports;
}
