import {beijingParts} from './monitor';
import {isClosingSnapshot} from './close-report';
import type {Snapshot} from './desk-types';
import type {UniverseItem} from './screening';

/**
 * Pure scheduling rules for the shared closing report. GitHub scheduled runs can
 * start many hours late (after Beijing midnight), so the job publishes the latest
 * *closed* session that has no report yet instead of requiring "Beijing today".
 */

const DAY_MS = 86400000;
/** 15:20 Beijing: the closing auction and quote finalisation are complete. */
export const CLOSE_READY_MINUTE = 920;
/** 16:30 Beijing: a report for today's session is overdue after this. */
export const REPORT_DUE_MINUTE = 990;
/** A benchmark session older than this means the source is broken, not a holiday. */
export const MAX_SESSION_AGE_DAYS = 14;

const dayNumber = (date: string) => Math.round(Date.parse(date + 'T00:00:00Z') / DAY_MS);
const validDate = (date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z'));

/** Calendar weekday before `date` (holidays are not known here). */
export function previousWeekday(date: string): string {
  let t = Date.parse(date + 'T12:00:00Z') - DAY_MS;
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}
export const isWeekend = (now = new Date()) => ['Sat', 'Sun'].includes(beijingParts(now).weekday);

export type CloseRunDecision = {
  action: 'run' | 'skip' | 'fail';
  /** Trade date the run would publish (benchmark session date), when known. */
  date: string | null;
  reason: string;
  /** How loudly the workflow should report it. */
  level: 'notice' | 'warning' | 'error';
};

/**
 * Decides whether the closing job should build and publish a report.
 * - benchmark: latest Shanghai index snapshot.
 * - publishedDate: date of the report currently served by the Worker (null when none or unknown).
 */
export function decideCloseRun(input: {benchmark?: Pick<Snapshot, 'asOf' | 'stale'> | null; now?: Date; publishedDate?: string | null; force?: boolean}): CloseRunDecision {
  const now = input.now ?? new Date(), {date: today, minute} = beijingParts(now), published = validDate(input.publishedDate) ? input.publishedDate : null;
  const benchmark = input.benchmark;
  if (!benchmark || !validDate(benchmark.asOf?.slice(0, 10))) return {action: 'fail', date: null, reason: 'Benchmark index snapshot is unavailable; cannot determine the latest trade date.', level: 'error'};
  const date = benchmark.asOf.slice(0, 10), time = benchmark.asOf.slice(11, 16);
  if (date > today) return {action: 'fail', date, reason: `Benchmark date ${date} is ahead of Beijing date ${today}.`, level: 'error'};
  if (date === today && (time < '15:00' || minute < CLOSE_READY_MINUTE)) {
    // The current session is still forming. The previous session should already have a report.
    const expected = previousWeekday(today), missing = !published || published < expected;
    return {action: 'skip', date, reason: missing ? `Market is still open; latest published report (${published ?? 'none'}) is older than ${expected}.` : 'Market is still open. No closing report published.', level: missing ? 'warning' : 'notice'};
  }
  if (dayNumber(today) - dayNumber(date) > MAX_SESSION_AGE_DAYS) return {action: 'fail', date, reason: `Benchmark session ${date} is more than ${MAX_SESSION_AGE_DAYS} days old; source looks stale.`, level: 'error'};
  if (!isClosingSnapshot(benchmark as Snapshot, date)) return {action: 'fail', date, reason: `Index close for ${date} has not been verified (snapshot ${benchmark.asOf}${benchmark.stale ? ', stale' : ''}).`, level: 'error'};
  if (!input.force && published && published >= date) return {action: 'skip', date, reason: `A closing report for ${published} is already published.`, level: 'notice'};
  return {action: 'run', date, reason: date === today ? `Publishing today's close ${date}.` : `Publishing the latest closed session ${date} (Beijing date ${today}).`, level: 'notice'};
}

/** Sina's registered count can drift from the paged rows by a few listings during the day. */
export function universeTolerance(registered: number) { return Math.max(25, Math.ceil(registered * 0.005)); }
export type UniverseReconciliation = {items: UniverseItem[]; registered: number; actual: number; gap: number; tolerance: number; ok: boolean};
/** De-duplicates paged rows and accepts a small registered/actual gap, which is recorded in the report. */
export function reconcileUniverse(registered: number, rows: UniverseItem[]): UniverseReconciliation {
  const items = [...new Map(rows.map(s => [s.symbol, s])).values()], actual = items.length, gap = actual - registered, tolerance = universeTolerance(registered);
  return {items, registered, actual, gap, tolerance, ok: registered > 0 && actual > 0 && Math.abs(gap) <= tolerance};
}

/** Benchmark sessions as seen from a cheap index daily request. */
export type SessionInfo = {quoteDate: string | null; sessions: string[]};
/**
 * The latest trade date that should have a published closing report.
 * dueMinute: Beijing minute after which today's session counts (REPORT_DUE_MINUTE for staleness,
 * 900 for devices deciding whether an older report is still the latest session).
 */
export function expectedReportDate(info: SessionInfo | null | undefined, now = new Date(), dueMinute = REPORT_DUE_MINUTE): string | null {
  if (!info) return null;
  const {date: today, minute} = beijingParts(now), sessions = info.sessions.filter(validDate).sort();
  const latest = validDate(info.quoteDate) ? info.quoteDate : sessions.at(-1);
  if (!latest || latest > today || dayNumber(today) - dayNumber(latest) > MAX_SESSION_AGE_DAYS) return null;
  if (latest < today) return latest;
  if (minute >= dueMinute) return today;
  return sessions.filter(d => d < today).at(-1) ?? null;
}
/** A report is stale when an expected session is known and the report is older than it. */
export function reportIsStale(reportDate: string | null | undefined, expected: string | null) {
  return expected !== null && (!reportDate || reportDate < expected);
}
/**
 * Whether a device should treat `reportDate` as the current session's report.
 * With session info: the report covers the session expected once today's market has closed.
 * Without it: today's report after close, otherwise the previous weekday's or newer.
 */
export function reportIsCurrent(reportDate: string | null | undefined, now = new Date(), expected?: string | null) {
  if (!validDate(reportDate)) return false;
  const {date: today, minute, weekday} = beijingParts(now);
  if (reportDate > today) return false;
  if (expected) return reportDate >= expected;
  const weekend = ['Sat', 'Sun'].includes(weekday);
  if (!weekend && minute >= 900) return reportDate === today;
  return reportDate >= previousWeekday(today);
}
