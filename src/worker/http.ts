/**
 * Shared HTTP helpers for the Worker API.
 * Error envelope: {"error": string, "code"?: string, "retryAfter"?: number} plus any
 * route-specific fields kept for older clients. Errors are never publicly cacheable.
 */
export type ErrorEnvelope = {error: string; code?: string; retryAfter?: number; [key: string]: unknown};
const JSON_TYPE = 'application/json; charset=utf-8';
/** Default Retry-After (seconds) for 503 responses that do not name one. */
export const DEFAULT_RETRY_AFTER = 30;

const defaultCode = (status: number) => status === 400 ? 'BAD_REQUEST' : status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 405 ? 'METHOD_NOT_ALLOWED' : status === 409 ? 'CONFLICT' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' : status === 503 ? 'UNAVAILABLE' : status >= 500 ? 'UPSTREAM_ERROR' : undefined;

/**
 * Normalises any JSON error body to the envelope without dropping existing fields:
 * `reason`/`message` become `error` when it is missing, and a numeric `retryAfter`
 * is derived from `retryAt` when only a timestamp is present.
 */
export function normalizeErrorBody(body: unknown, status: number, now = Date.now()): ErrorEnvelope {
  const value = body && typeof body === 'object' && !Array.isArray(body) ? {...body as Record<string, unknown>} : {};
  const text = [value.error, value.reason, value.message].find(v => typeof v === 'string' && v.trim());
  const envelope: ErrorEnvelope = {...value, error: typeof text === 'string' ? text : status >= 500 ? '服务暂不可用，请稍后重试' : '请求无效'};
  const code = typeof value.code === 'string' && value.code ? value.code : defaultCode(status);
  if (code) envelope.code = code;
  let retryAfter = typeof value.retryAfter === 'number' && Number.isFinite(value.retryAfter) ? Math.max(1, Math.ceil(value.retryAfter)) : undefined;
  if (retryAfter === undefined && typeof value.retryAt === 'string' && Number.isFinite(Date.parse(value.retryAt))) retryAfter = Math.max(1, Math.ceil((Date.parse(value.retryAt) - now) / 1000));
  if (retryAfter === undefined && status === 503) retryAfter = DEFAULT_RETRY_AFTER;
  if (retryAfter !== undefined && (status === 429 || status === 503)) envelope.retryAfter = retryAfter;
  return envelope;
}

export function errorHeaders(status: number, retryAfter?: number, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set('content-type', JSON_TYPE);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  if (retryAfter !== undefined && (status === 429 || status === 503)) headers.set('retry-after', String(retryAfter));
  return headers;
}

/** Builds an error response in the shared envelope. */
export function apiError(status: number, error: string, options: {code?: string; retryAfter?: number; extra?: Record<string, unknown>; headers?: HeadersInit} = {}) {
  const body = normalizeErrorBody({...options.extra, error, code: options.code, retryAfter: options.retryAfter}, status);
  return new Response(JSON.stringify(body), {status, headers: errorHeaders(status, body.retryAfter, options.headers)});
}

/**
 * Applied to every /api/* response: error statuses get the envelope, `no-store`
 * and Retry-After; plain-text errors become JSON. Successful responses pass through untouched.
 */
export async function finalizeApiResponse(response: Response): Promise<Response> {
  if (response.status < 400) return response;
  let parsed: unknown = null;
  const type = response.headers.get('content-type') || '';
  const text = await response.text().catch(() => '');
  if (type.includes('json')) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
  else if (text.trim()) parsed = {error: text.trim().slice(0, 300)};
  const body = normalizeErrorBody(parsed, response.status);
  const headers = errorHeaders(response.status, body.retryAfter, response.headers);
  return new Response(JSON.stringify(body), {status: response.status, statusText: response.statusText, headers});
}

/** Constant-time string comparison (digest based, so length differences do not leak either). */
export async function timingSafeEqual(given: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(given)), crypto.subtle.digest('SHA-256', encoder.encode(expected))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
export const bearer = (request: Request) => { const value = request.headers.get('authorization') || ''; return /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '').trim() : ''; };

/** Weak validator match for If-None-Match (supports lists and *). */
export function etagMatches(header: string | null, etag: string) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const strip = (v: string) => v.trim().replace(/^W\//, '');
  return header.split(',').some(v => strip(v) === strip(etag));
}
export type WaitUntil = {waitUntil(task: Promise<unknown>): void};
/** Runs cache writes after the response when an execution context is available. */
export function background(ctx: WaitUntil | undefined, task: Promise<unknown>) {
  const safe = task.catch(() => {/* Cache writes are best effort. */});
  if (ctx) ctx.waitUntil(safe); else return safe;
}
