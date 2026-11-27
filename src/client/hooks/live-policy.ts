/** Pure polling decisions shared by useLiveEndpoint and the quote store (unit-tested). */

/**
 * Coming back to the tab (or online) refetches only when the last result is stale.
 * One-shot endpoints (interval 0: F10, history, reports, earnings) refetch only if they never succeeded.
 */
export function shouldRefetchOnResume(input: { intervalMs: number; updatedAt: number; hasData: boolean; hasError: boolean; now: number }): boolean {
  if (!input.hasData) return true;
  if (input.intervalMs <= 0) return false;
  return input.hasError || input.now - input.updatedAt >= input.intervalMs;
}

type SessionItem = { session?: string };
/** Quote polling: 5s while any market trades, 15s during the lunch break, 60s once everything has closed. */
export function quotePollDelay(items: SessionItem[] | undefined, baseMs = 5000): number {
  if (!items?.length) return baseMs;
  if (items.some(item => item.session === 'trading')) return baseMs;
  if (items.some(item => item.session === 'break')) return Math.max(baseMs, 15000);
  return Math.max(baseMs, 60000);
}

/** Generic endpoints: short-interval feeds that report closed sessions slow down like quotes. */
export function nextEndpointDelay(intervalMs: number, body: unknown): number {
  const items = (body as { items?: unknown })?.items;
  if (intervalMs > 0 && intervalMs <= 5000 && Array.isArray(items) && items.length && items.every((q: SessionItem) => q?.session === 'closed')) return Math.max(intervalMs, 30000);
  return intervalMs;
}

/** Failure backoff for background refreshes: 30s, 60s, 120s … capped at 10 minutes. */
export const failureBackoff = (failures: number) => Math.min(600000, 30000 * 2 ** Math.max(0, failures - 1));
