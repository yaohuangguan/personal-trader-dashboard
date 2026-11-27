import {scannerFetch} from './full-market-scanner';
import {apiError,background,etagMatches,type WaitUntil} from './http';
import type {MonitorNamespace} from './signal-monitor';

/** Edge copy lifetime; browsers revalidate with the ETag (keyed by report id). */
const EDGE_TTL = 60;
export const CLOSE_REPORT_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=300';
export const closeReportView = (raw: string | null) => raw === 'list' || raw === 'summary' ? raw : 'full';

function withValidator(response: Response, request: Request, cache: string) {
  const etag = response.headers.get('etag');
  const headers = new Headers({'content-type': 'application/json; charset=utf-8', 'cache-control': CLOSE_REPORT_CACHE_CONTROL, 'x-content-type-options': 'nosniff', 'x-atlas-close-cache': cache, vary: 'accept-encoding'});
  if (etag) headers.set('etag', etag);
  if (etag && etagMatches(request.headers.get('if-none-match'), etag)) return new Response(null, {status: 304, headers});
  return new Response(response.body, {status: 200, headers});
}

/**
 * GET /api/desk/close-report[?view=full|list|summary]. The coordinator serialises the report
 * once per id; the Worker streams its body through without JSON parsing (the 1.1MB payload used
 * to cost ~10ms CPU per request) and keeps a short edge copy. Errors are never cached.
 */
export async function closeReportRoute(request: Request, ns: MonitorNamespace | undefined, ctx?: WaitUntil): Promise<Response> {
  if (!ns) return Response.json({report: null}, {headers: {'cache-control': 'no-store'}});
  const url = new URL(request.url), view = closeReportView(url.searchParams.get('view'));
  const edge = typeof caches !== 'undefined' ? (caches as CacheStorage & {default?: Cache}).default : undefined;
  const key = new Request(new URL('/__close-report/v2/' + view, url.origin));
  if (edge) {
    try { const hit = await edge.match(key); if (hit) return withValidator(hit, request, 'hit'); } catch { /* Fall through to the coordinator. */ }
  }
  let upstream: Response;
  try { upstream = await scannerFetch(ns, 'results?view=' + view); }
  catch { return apiError(503, '收盘报告存储暂不可用', {code: 'CLOSE_REPORT_UNAVAILABLE', retryAfter: 30}); }
  if (!upstream.ok) return apiError(503, '收盘报告存储暂不可用', {code: 'CLOSE_REPORT_UNAVAILABLE', retryAfter: 30});
  if (edge) {
    const copy = new Response(upstream.clone().body, {headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + EDGE_TTL, etag: upstream.headers.get('etag') || ''}});
    const stored = background(ctx, edge.put(key, copy));
    if (stored) await stored;
  }
  return withValidator(upstream, request, 'miss');
}
