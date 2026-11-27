import type {MonitorNamespace} from './signal-monitor';
import type {WaitUntil} from './http';

/**
 * Heavy public analysis (chart studies, strategy, daily trend, pattern marks, screens) costs tens
 * of milliseconds of CPU, above the Workers Free plan's 10 ms per request (error 1102). Cache
 * misses are forwarded to Durable Objects, which get a 30 s CPU budget per request. The objects
 * are extra instances of the existing CloseCoordinator class (`compute:<shard>`), so no new
 * migration is needed. If the objects are unavailable (for example the daily free quota is used
 * up), the request is computed inline as before.
 */
export const COMPUTE_SHARDS = 8;
export const COMPUTE_HOST = 'compute.internal';
const FORWARD_HEADER = 'x-atlas-forward-url';
type InlineHandler = (request: Request, env: unknown, ctx?: WaitUntil) => Promise<Response>;
let inlineHandler: InlineHandler | null = null;

/** index.ts registers the route that computes without forwarding (used inside the object). */
export function registerInlineHandler(handler: InlineHandler) { inlineHandler = handler; }

/** Stable shard for a symbol/input key (FNV-1a), so one symbol's requests share an object's memory caches. */
export function computeShard(key: string, shards = COMPUTE_SHARDS) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash % shards;
}

const FORWARDED = ['content-type', 'accept', 'if-none-match', 'cf-connecting-ip', 'user-agent'];
export function computeRequest(request: Request, body?: string) {
  const headers = new Headers({[FORWARD_HEADER]: request.url});
  for (const name of FORWARDED) { const v = request.headers.get(name); if (v) headers.set(name, v); }
  return new Request('https://' + COMPUTE_HOST + '/', {method: request.method, headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body});
}
/** Rebuilds the original public request inside the Durable Object. */
export async function originalRequest(internal: Request) {
  const url = internal.headers.get(FORWARD_HEADER);
  if (!url) return null;
  const headers = new Headers(internal.headers);
  headers.delete(FORWARD_HEADER);
  return new Request(url, {method: internal.method, headers, body: internal.method === 'GET' || internal.method === 'HEAD' ? undefined : await internal.text()});
}

/** Worker side: compute in a Durable Object; fall back to `inline` when objects are unavailable. */
export async function offload(request: Request, ns: MonitorNamespace | undefined, shardKey: string, inline: () => Promise<Response> | Response, body?: string): Promise<Response> {
  if (!ns) return inline();
  let response: Response;
  try {
    response = await ns.get(ns.idFromName('compute:' + computeShard(shardKey))).fetch(computeRequest(request, body));
  } catch (error) {
    console.warn('Compute object unavailable, computing inline:', error instanceof Error ? error.message : String(error));
    return inline();
  }
  if (response.headers.get('x-atlas-compute') === 'unavailable') return inline();
  return response;
}

/** Durable Object side. */
export async function runCompute(internal: Request, env: unknown, ctx?: WaitUntil): Promise<Response> {
  const request = await originalRequest(internal);
  if (!request || !inlineHandler) return new Response(JSON.stringify({error: '计算服务未就绪', code: 'COMPUTE_UNAVAILABLE'}), {status: 503, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-atlas-compute': 'unavailable'}});
  const response = await inlineHandler(request, env, ctx), marked = new Response(response.body, response);
  marked.headers.set('x-atlas-compute', 'object');
  return marked;
}
