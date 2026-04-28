import type Handoff from '../../index';

/**
 * Absolute path to the declaration file (`*.handoff.*` / legacy) for a component or pattern id.
 */
export function getDeclarationAbsPathForEntity(
  handoff: Handoff,
  kind: 'component' | 'pattern',
  entityId: string
): string | null {
  for (const p of handoff.getConfigFilePaths()) {
    const e = handoff.getConfigFileEntry(p);
    if (e?.kind === kind && e.entityId === entityId) {
      return p;
    }
  }
  return null;
}
