import type {MonitorNamespace} from './signal-monitor';

/**
 * Small shared rate limiter: counters live in memory of one Durable Object instance
 * (`ratelimit:v1`, another CloseCoordinator instance), so every isolate sees the same counts
 * without storage writes. If the object is unreachable the request is allowed (fail open).
 */
export const RATE_LIMIT_HOST = 'ratelimit.internal';
type Window = {count: number; start: number};
const windows = new Map<string, Window>();

/** Pure fixed-window counter; returns seconds to wait, 0 when allowed. */
export function countRequest(store: Map<string, Window>, key: string, max: number, windowMs: number, now = Date.now()) {
  const old = store.get(key), current = old && now - old.start < windowMs ? old : {count: 0, start: now};
  if (current.count >= max) return Math.max(1, Math.ceil((current.start + windowMs - now) / 1000));
  current.count++;
  if (store.size > 5000) for (const [k, v] of store) if (now - v.start >= windowMs) store.delete(k);
  store.set(key, current);
  return 0;
}
/** Durable Object side. */
export async function rateLimitObject(request: Request) {
  const {key, max, windowMs} = await request.json() as {key: string; max: number; windowMs: number};
  return Response.json({retryAfter: countRequest(windows, String(key).slice(0, 200), Math.max(1, Number(max) || 1), Math.max(1000, Number(windowMs) || 60000))});
}
/** Worker side. */
export async function rateLimited(ns: MonitorNamespace | undefined, key: string, max: number, windowMs: number): Promise<number> {
  if (!ns) return 0;
  try {
    const r = await ns.get(ns.idFromName('ratelimit:v1')).fetch(new Request('https://' + RATE_LIMIT_HOST + '/', {method: 'POST', body: JSON.stringify({key, max, windowMs})}));
    return r.ok ? Number((await r.json() as {retryAfter?: number}).retryAfter) || 0 : 0;
  } catch { return 0; }
}
