import fs from 'fs-extra';
import path from 'path';
import Handoff from '@handoff/index';
import { TransformComponentTokensResult } from '@handoff/transformers/preview/types';
import { getDocumentedPreviews } from './previews';
import { getComponentDistPath, sanitizeComponentApiData } from './api';

const getComponentPreviewKeys = async (handoff: Handoff, componentId: string): Promise<Set<string>> => {
  const runtimeComponent = handoff.runtimeConfig?.entries?.components?.[componentId];
  const previewKeys = new Set<string>();

  const distDir = getComponentDistPath(handoff, componentId);
  const jsonPath = path.resolve(distDir, `${componentId}.json`);
  if (fs.existsSync(jsonPath)) {
    try {
      const existingJson = await fs.readFile(jsonPath, 'utf8');
      if (existingJson) {
        const existingData = sanitizeComponentApiData(JSON.parse(existingJson) as TransformComponentTokensResult);
        for (const previewKey of Object.keys(existingData?.previews || {})) {
          previewKeys.add(previewKey);
        }
      }
    } catch {
      // Fall back to runtime config below.
    }
  }

  for (const previewKey of Object.keys(getDocumentedPreviews(runtimeComponent?.previews) || {})) {
    previewKeys.add(previewKey);
  }

  for (const previewKey of Object.keys(runtimeComponent?.internalPatternPreviews || {})) {
    previewKeys.add(previewKey);
  }

  return previewKeys;
};

export const removeComponentApi = async (handoff: Handoff, id: string): Promise<void> => {
  const distDir = getComponentDistPath(handoff, id);
  const jsonPath = path.resolve(distDir, `${id}.json`);
  if (await fs.pathExists(jsonPath)) {
    await fs.remove(jsonPath);
  }
};

export const syncComponentArtifacts = async (handoff: Handoff): Promise<void> => {
  const runtimeComponents = handoff.runtimeConfig?.entries?.components ?? {};
  const runtimeIds = new Set(Object.keys(runtimeComponents));
  const componentsRoot = path.resolve(handoff.workingPath, 'components');

  // Remove dist dirs for components that no longer exist in runtime config
  if (await fs.pathExists(componentsRoot)) {
    const existing = await fs.readdir(componentsRoot);
    for (const entry of existing) {
      if (runtimeIds.has(entry)) continue;
      const orphanDist = path.resolve(componentsRoot, entry, 'dist');
      if (await fs.pathExists(orphanDist)) {
        await fs.remove(orphanDist);
      }
    }
  }

  // For each active component, remove stale artifact files within its dist dir
  for (const componentId of runtimeIds) {
    const distDir = getComponentDistPath(handoff, componentId);
    if (!(await fs.pathExists(distDir))) continue;

    const previewKeys = await getComponentPreviewKeys(handoff, componentId);
    const validFiles = new Set<string>();
    validFiles.add(`${componentId}.json`);

    if (await fs.pathExists(path.resolve(distDir, `${componentId}.js`))) {
      validFiles.add(`${componentId}.js`);
    }
    if (await fs.pathExists(path.resolve(distDir, `${componentId}.css`))) {
      validFiles.add(`${componentId}.css`);
    }
    for (const previewKey of previewKeys) {
      validFiles.add(`${componentId}-${previewKey}.html`);
      validFiles.add(`${componentId}-${previewKey}-inspect.html`);
    }

    const distEntries = await fs.readdir(distDir);
    for (const entry of distEntries) {
      if (entry.startsWith('.')) continue; // skip temp dirs from Vite
      const ext = path.extname(entry);
      if (['.json', '.js', '.css', '.html'].includes(ext) && !validFiles.has(entry)) {
        await fs.remove(path.resolve(distDir, entry));
      }
    }
  }
};
