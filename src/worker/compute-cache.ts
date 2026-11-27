import {beijingParts} from '../shared/monitor';
import {marketClock} from '../shared/market-clock';
import {previousWeekday} from '../shared/close-schedule';
import {background,etagMatches,type WaitUntil} from './http';

/**
 * Content-addressed edge cache for public compute results; does not consume KV writes or cache
 * private user data. Keys combine the symbol and inputs with a market-phase bucket: short
 * buckets while the market trades, one bucket per closed window afterwards (kept until the next
 * open when the response's own data date shows the closed session's final bar).
 */
export type CachePhase = {bucket: string; ttl: number; closedSince: string | null; live: boolean};
/** Results whose data date lags the closed session (holiday or slow source) are retried soon. */
export const LAGGING_TTL = 120;
const MAX_TTL = 86400;
const DAY_MS = 86400000;

/** Seconds until the next weekday open (09:15 Beijing / 09:25 New York) after `date`. */
function untilNextOpen(now: Date, lastClose: string, us: boolean) {
  let t = Date.parse(lastClose + 'T12:00:00Z') + DAY_MS;
  while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY_MS;
  const day = new Date(t).toISOString().slice(0, 10);
  // New York opens at 09:25 local; approximate the UTC offset from the current clock.
  const open = us ? Date.parse(day + 'T09:25:00Z') + nyOffsetMs(now) : Date.parse(day + 'T09:15:00+08:00');
  return Math.round((open - now.getTime()) / 1000);
}
function nyOffsetMs(now: Date) {
  const clock = marketClock(now, 'AAPL'), local = Date.parse(clock.date + 'T' + String(Math.floor(clock.minute / 60)).padStart(2, '0') + ':' + String(clock.minute % 60).padStart(2, '0') + ':00Z');
  return Math.round((now.getTime() - local) / 60000) * 60000;
}

/** Market-phase cache bucket for A-shares ('cn') or US listings ('us'). */
export function cachePhase(now = new Date(), market: 'cn' | 'us' = 'cn', liveTtl = 15): CachePhase {
  const us = market === 'us';
  const {date, minute} = us ? marketClock(now, 'AAPL') : beijingParts(now);
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  const trading = weekday > 0 && weekday < 6;
  const [open, close] = us ? [565, 965] : [555, 905];
  if (trading && minute >= open && minute < close) return {bucket: 'live:' + date + ':' + Math.floor(now.getTime() / 1000 / liveTtl), ttl: liveTtl, closedSince: null, live: true};
  const lastClose = trading && minute >= close ? date : previousWeekday(date);
  return {bucket: 'closed:' + lastClose, ttl: Math.min(MAX_TTL, Math.max(60, untilNextOpen(now, lastClose, us))), closedSince: lastClose, live: false};
}

/** Best-effort data date (YYYY-MM-DD) of a compute payload, read before serialisation. */
export function dataDateOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, any>;
  const candidates = [p.market?.candles?.at?.(-1)?.time, p.market?.asOf, p.candles?.at?.(-1)?.time, p.trend?.asOf, p.asOf, p.date, p.strategy?.plan?.asOf];
  const found = candidates.find(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v));
  return found ? found.slice(0, 10) : null;
}
export const DATA_DATE_HEADER = 'x-atlas-data-date';

/** Client cache policy for public compute results (hits and misses alike). */
export function clientCacheControl(phase: CachePhase) {
  return phase.live ? `public, max-age=${Math.min(phase.ttl, 15)}, stale-while-revalidate=${phase.ttl}` : 'public, max-age=300, stale-while-revalidate=3600';
}

async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(n => n.toString(16).padStart(2, '0')).join('');
}

/**
 * computeCache(request, identity, ttl, action[, options])
 * - identity: symbol and inputs; the market-phase bucket is appended unless `phase: false`.
 * - ttl: seconds per live bucket.
 * Successful responses are stored via ctx.waitUntil; errors are never stored and leave `no-store`.
 */
export async function computeCache(request: Request, identity: string, ttl: number, action: () => Promise<Response> | Response, options: {ctx?: WaitUntil; market?: 'cn' | 'us'; phase?: boolean; now?: Date; cacheControl?: string} = {}) {
  const edge = typeof caches !== 'undefined' ? (caches as CacheStorage & {default?: Cache}).default : undefined;
  const phase: CachePhase = options.phase === false ? {bucket: 'fixed', ttl, closedSince: null, live: true} : cachePhase(options.now, options.market, ttl);
  const id = await digest(identity + '|' + phase.bucket);
  const key = new Request(new URL('/__compute-cache/v2/' + id, request.url)), start = performance.now();
  if (edge) {
    try {
      const hit = await edge.match(key);
      if (hit) {
        const etag = hit.headers.get('etag');
        const headers = new Headers(hit.headers);
        headers.set('cache-control', options.cacheControl ?? clientCacheControl(phase));
        headers.set('x-atlas-compute-cache', 'hit');
        headers.set('server-timing', 'edge-cache;dur=' + (performance.now() - start).toFixed(1));
        if (etag && etagMatches(request.headers.get('if-none-match'), etag)) return new Response(null, {status: 304, headers});
        return new Response(hit.body, {status: hit.status, headers});
      }
    } catch { /* Cache failures must not prevent computing a valid response. */ }
  }
  const computed = await action();
  if (!computed.ok) {
    const failure = new Response(computed.body, computed);
    failure.headers.set('cache-control', 'no-store');
    failure.headers.set('x-atlas-compute-cache', 'miss');
    return failure;
  }
  const response = new Response(computed.body, computed);
  response.headers.set('x-atlas-compute-cache', 'miss');
  response.headers.set('etag', '"' + id.slice(0, 32) + '-' + Date.now().toString(36) + '"');
  response.headers.set('cache-control', options.cacheControl ?? clientCacheControl(phase));
  response.headers.append('server-timing', 'request;dur=' + (performance.now() - start).toFixed(1));
  if (edge) {
    // Keep the closed-session result until the next open only when its data covers that session.
    const dataDate = response.headers.get(DATA_DATE_HEADER);
    const edgeTtl = phase.closedSince && !(dataDate && dataDate >= phase.closedSince) ? Math.min(LAGGING_TTL, phase.ttl) : phase.ttl;
    const copy = response.clone();
    copy.headers.set('cache-control', 'public, max-age=' + edgeTtl);
    const stored = background(options.ctx, edge.put(key, copy));
    if (stored) await stored;
  }
  return response;
}

export function studySession(now = new Date()) { const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false}).formatToParts(now), part = (k: string) => parts.find(p => p.type === k)?.value || ''; return [part('year'), part('month'), part('day'), Number(part('hour')) < 15 ? 'forming' : 'closed'].join('-'); }
