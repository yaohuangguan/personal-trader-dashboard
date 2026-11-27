import type {ResearchJob} from './research-screen';
import {beijingParts} from '../shared/monitor';

/**
 * Contract for POST /api/desk/screen-job (clients are coded against it):
 * - a NEW full-market job needs `Authorization: Bearer <SCREEN_JOB_TOKEN>` or an account session
 *   token; otherwise 401 {"error":"登录后可发起全市场扫描","code":"AUTH_REQUIRED"};
 * - a running job, or one started within 30 minutes in the same trading session, is returned
 *   instead of starting another one (authorized or not);
 * - {"retry": true | string[]} re-checks failed stocks of the existing job without auth, rate
 *   limited and bounded; it never starts a full-market scan.
 */
export const REUSE_WINDOW_MS = 30 * 60000;
export const RETRY_INTERVAL_MS = 60000;
export const MAX_RETRY_SYMBOLS = 300;
export const MAX_SCREEN_JOB_BODY = 8000;
const ACTIVE = ['universe', 'quotes', 'cache', 'history', 'screening'];

export type ScreenJobDecision =
  | {kind: 'existing'}
  | {kind: 'start'}
  | {kind: 'resume'}
  | {kind: 'retry'; symbols?: string[]}
  | {kind: 'unauthorized'}
  | {kind: 'rate-limited'; retryAfter: number};

/** Trading-session bucket in Beijing time: pre-open, trading day, or after the close. */
export function sessionBucket(at: number) {
  const {date, minute, weekday} = beijingParts(new Date(at));
  return date + ':' + (['Sat', 'Sun'].includes(weekday) ? 'weekend' : minute < 570 ? 'pre' : minute < 900 ? 'forming' : 'closed');
}

/** Parses the POST body: `retry` may be a boolean or a bounded list of A-share symbols. */
export function parseScreenJobBody(raw: string): {retry: boolean; symbols?: string[]} | {error: string} {
  if (raw.length > MAX_SCREEN_JOB_BODY) return {error: '请求过大'};
  let body: unknown = {};
  if (raw.trim()) { try { body = JSON.parse(raw); } catch { return {error: '无效 JSON'}; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {error: '无效请求'};
  const retry = (body as {retry?: unknown}).retry;
  if (retry === undefined || retry === false || retry === null) return {retry: false};
  if (retry === true) return {retry: true};
  if (Array.isArray(retry)) {
    if (!retry.length) return {retry: false};
    if (retry.length > MAX_RETRY_SYMBOLS || retry.some(s => typeof s !== 'string' || !/^\d{6}\.(SH|SZ|BJ)$/.test(s))) return {error: `retry 需为1至${MAX_RETRY_SYMBOLS}个沪深北证券代码`};
    return {retry: true, symbols: [...new Set(retry as string[])]};
  }
  return {error: 'retry 需为布尔值或证券代码列表'};
}

export function screenJobDecision(job: ResearchJob | undefined, request: {authorized: boolean; retry: boolean; symbols?: string[]}, now = Date.now(), lastRetryAt?: number): ScreenJobDecision {
  const running = !!job && job.algorithm === 2 && ACTIVE.includes(job.phase);
  if (running) return {kind: 'existing'};
  if (request.retry) {
    const retryable = !!job && ['complete', 'paused'].includes(job.phase) && !!(job.failed || job.historyTotal);
    if (!retryable) return {kind: 'existing'};
    const wait = lastRetryAt ? RETRY_INTERVAL_MS - (now - lastRetryAt) : 0;
    if (wait > 0) return {kind: 'rate-limited', retryAfter: Math.ceil(wait / 1000)};
    return request.symbols ? {kind: 'retry', symbols: request.symbols} : {kind: 'retry'};
  }
  const recent = !!job && now - job.startedAt >= 0 && now - job.startedAt < REUSE_WINDOW_MS && sessionBucket(job.startedAt) === sessionBucket(now);
  if (recent) return job!.phase === 'paused' && job!.algorithm === 2 ? {kind: 'resume'} : {kind: 'existing'};
  if (!request.authorized) return {kind: 'unauthorized'};
  return job?.phase === 'paused' && job.algorithm === 2 ? {kind: 'resume'} : {kind: 'start'};
}
