'use client';

/** Persisted snapshot of the workbench session for localStorage restore. */
export type WorkbenchSession = {
  /** Schema version — bump when the shape changes to discard stale data. */
  v: 1;
  savedAt: string;
  /** Draft artifact ID written back to DB after each successful generation. */
  draftArtifactId: string | null;
  /** Last canvas image src (data URL or HTTP URL). */
  imageSrc: string | null;
  /** Component IDs currently selected as guides. */
  selectedIds: string[];
  /** Conversation history (role/prompt/imageUrl/timestamp tuples). */
  conversationHistory: unknown[];
  /** Last five generated image thumbnails only — full data URLs truncated to save space. */
  recentImages: { id: string; src: string; prompt: string; ts: string }[];
  /** Active job IDs to restore on mount. */
  activeJobIds: number[];
};

const SESSION_KEY = 'handoff_design_session';
const MAX_RECENT = 5;

export function saveWorkbenchSession(session: Omit<WorkbenchSession, 'v' | 'savedAt'>): void {
  try {
    const payload: WorkbenchSession = { v: 1, savedAt: new Date().toISOString(), ...session };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or unavailable — silently ignore.
  }
}

export function loadWorkbenchSession(): WorkbenchSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkbenchSession;
    if (parsed.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearWorkbenchSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore.
  }
}

export { MAX_RECENT };
