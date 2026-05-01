import fs from 'fs-extra';
import path from 'path';
import Handoff from '@handoff/index';

/**
 * Gets the working public directory path for a given handoff instance.
 * Checks for both project-specific and default public directories.
 *
 * @param handoff - The handoff instance containing working path and figma project configuration
 * @returns The resolved path to the public directory if it exists, null otherwise
 */
export const getWorkingPublicPath = (handoff: Handoff): string | null => {
  const paths = [path.resolve(handoff.workingPath, `public-${handoff.getProjectId()}`), path.resolve(handoff.workingPath, `public`)];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
};

/**
 * Gets the materialized Next.js app directory (under the client working path).
 * Uses `.handoff/app` so `cleanupAppDirectory` can remove the full tree without touching
 * `.handoff/local.db` (SQLite) at the parent `.handoff/` folder.
 *
 * @param handoff - The handoff instance (workingPath = client / design repo root)
 * @returns Absolute path to the Next app root (e.g. `<workingPath>/.handoff/app`)
 */
export const getAppPath = (handoff: Handoff): string => {
  return path.resolve(handoff.workingPath, '.handoff', 'app');
};

const mirrorDirectory = async (sourcePath: string, destinationPath: string): Promise<void> => {
  if (!(await fs.pathExists(sourcePath))) {
    try {
      await fs.remove(destinationPath);
    } catch {
      /* ignore concurrent removal */
    }
    return;
  }

  try {
    await fs.remove(destinationPath);
  } catch {
    /* ignore concurrent removal */
  }
  await fs.ensureDir(path.dirname(destinationPath));
  try {
    await fs.copy(sourcePath, destinationPath, { overwrite: true });
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT' || code === 'EEXIST') {
      return; // concurrent watcher; next event may retry
    }
    throw e;
  }
};

/**
 * Copy the public dir from the working dir into the materialized Next app (`getAppPath()` / `public/`).
 */
export const syncPublicFiles = async (handoff: Handoff): Promise<void> => {
  const appPath = getAppPath(handoff);
  const workingPublicPath = getWorkingPublicPath(handoff);
  if (workingPublicPath) {
    const destinationPublicPath = path.resolve(appPath, 'public');
    const sourceApiPath = path.resolve(workingPublicPath, 'api');
    const destinationApiPath = path.resolve(destinationPublicPath, 'api');

    await fs.copy(workingPublicPath, destinationPublicPath, {
      overwrite: true,
      filter: (file) => {
        const relativePath = path.relative(workingPublicPath, file);
        return relativePath !== 'api' && !relativePath.startsWith(`api${path.sep}`);
      },
    });

    await mirrorDirectory(sourceApiPath, destinationApiPath);
  }
};
