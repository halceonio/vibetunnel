/**
 * Provides a stable per-browser-instance identifier.
 *
 * Uses localStorage to persist the identifier so multiple tabs on the same
 * device share the same value. Falls back to a random UUID per session when
 * localStorage is unavailable (e.g., private browsing with disabled storage).
 */
const STORAGE_KEY = 'vibetunnel_client_instance_id';
let cachedClientId: string | null = null;

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback UUID v4 generator
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function getClientInstanceId(): string {
  if (cachedClientId) {
    return cachedClientId;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && typeof stored === 'string') {
      cachedClientId = stored;
      return stored;
    }

    const generated = generateId();
    localStorage.setItem(STORAGE_KEY, generated);
    cachedClientId = generated;
    return generated;
  } catch (_error) {
    // localStorage may be unavailable (e.g., disabled cookies)
    const generated = generateId();
    cachedClientId = generated;
    return generated;
  }
}
