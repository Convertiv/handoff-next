const DESIGN_LLM_KEY_STORAGE = 'handoff-design-llm-key';

export const DESIGN_IMAGE_MODEL = 'gpt-image-2';

export function getApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(DESIGN_LLM_KEY_STORAGE);
}

export function setApiKey(key: string): void {
  localStorage.setItem(DESIGN_LLM_KEY_STORAGE, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(DESIGN_LLM_KEY_STORAGE);
}

export function getImageModel(): string {
  return DESIGN_IMAGE_MODEL;
}
