/**
 * localStorage access that never throws (Safari private mode, quota exceeded, disabled storage)
 * and never trusts the stored shape: a stored "null" or object must not crash `[...watchlist]`.
 */
export type Guard<T> = (value: unknown) => value is T;

export function parseStored<T>(raw: string | null, fallback: T, guard: Guard<T>): T {
  if (raw === null) return fallback;
  try { const value: unknown = JSON.parse(raw); return guard(value) ? value : fallback; } catch { return fallback; }
}

export function readStored<T>(key: string, fallback: T, guard: Guard<T>): T {
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { return fallback; }
  return parseStored(raw, fallback, guard);
}

export function writeStored(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); return true; } catch { return false; }
}

export function removeStored(key: string) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } }

export const isBoolean: Guard<boolean> = (v): v is boolean => typeof v === 'boolean';
export const isString: Guard<string> = (v): v is string => typeof v === 'string';
export const isStringArray: Guard<string[]> = (v): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
export function isArrayOf<T>(item: Guard<T>): Guard<T[]> { return (v): v is T[] => Array.isArray(v) && v.every(item); }
/** Saved news bookmarks: url/title are the minimum a row needs to render. */
export const isBookmark = (v: unknown): v is { url: string; title: string; id: string } => !!v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string' && typeof (v as { title?: unknown }).title === 'string';
