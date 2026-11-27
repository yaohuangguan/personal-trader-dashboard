/**
 * Every API call goes through these helpers. The Worker answers errors as JSON {error, code?, retryAfter?},
 * but Cloudflare itself can still answer with plain text ("error code: 1102", HTML 5xx pages); those must become
 * a short localized message instead of a JSON SyntaxError.
 */
export const BUSY_MESSAGE = '服务繁忙，请稍后重试';
export const THROTTLED_MESSAGE = '请求过于频繁，请稍后重试';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly retryAfter?: number) { super(message); this.name = 'ApiError'; }
}

type ErrorBody = { error?: unknown; reason?: unknown; details?: unknown; code?: unknown; retryAfter?: unknown };

function retrySeconds(body: ErrorBody | null, header: string | null): number | undefined {
  const value = Number(body?.retryAfter ?? header);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function statusMessage(status: number) {
  if (status === 429) return THROTTLED_MESSAGE;
  if (status >= 500 || status === 0) return BUSY_MESSAGE;
  return '数据暂不可用（HTTP ' + status + '）';
}

/** Pure: turn a raw response body into data or an ApiError. Exported for tests. */
export function parseApiBody<T>(status: number, text: string, retryAfterHeader: string | null = null): T {
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch {
    // Plain-text platform errors (1102 CPU limit, 502/503 pages) or truncated bodies.
    throw new ApiError(status >= 200 && status < 300 ? '数据源返回异常响应，请稍后重试' : statusMessage(status), status, undefined, retrySeconds(null, retryAfterHeader));
  }
  if (status >= 200 && status < 300) return body as T;
  const error = (body && typeof body === 'object' ? body : {}) as ErrorBody;
  const text0 = typeof error.error === 'string' && error.error ? error.error : typeof error.reason === 'string' && error.reason ? error.reason : statusMessage(status);
  const message = typeof error.details === 'string' && error.details ? text0 + '：' + error.details.slice(0, 240) : text0;
  throw new ApiError(message, status, typeof error.code === 'string' ? error.code : undefined, retrySeconds(error, retryAfterHeader));
}

export async function readJson<T>(response: Response): Promise<T> {
  let text = '';
  try { text = await response.text(); } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError(BUSY_MESSAGE, response.status);
  }
  return parseApiBody<T>(response.status, text, response.headers.get('retry-after'));
}

export async function fetchJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  return readJson<T>(await fetch(input, { ...init, headers }));
}

/** Message for UI; aborts and network failures read as localized text. */
export function errorText(error: unknown, fallback = '连接暂不可用') {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return '网络连接失败，请检查网络后重试';
  return error instanceof Error && error.message ? error.message : fallback;
}
