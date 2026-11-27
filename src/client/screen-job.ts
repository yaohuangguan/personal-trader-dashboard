/** Pure helpers for the shared full-market job and the closing report (unit-tested). */

/**
 * Merge a /api/desk/screen-job poll into the candidates received so far.
 * - `since` mode: {candidates from index `since`, since, next} → keep the prefix, append the delta.
 * - running job without a `candidates` key → nothing new; keep the previous list.
 * - otherwise (old servers, finished jobs, another job id) → the full list replaces it.
 */
export function mergeJobCandidates<T>(previous: T[], response: { candidates?: T[] | null; since?: unknown }): T[] {
  if (!Array.isArray(response.candidates)) return previous;
  if (typeof response.since === 'number' && Number.isInteger(response.since) && response.since >= 0) {
    // A server-side reset (since beyond what we hold) cannot be stitched; take what was sent.
    if (response.since > previous.length) return response.candidates;
    return response.candidates.length || response.since < previous.length ? [...previous.slice(0, response.since), ...response.candidates] : previous;
  }
  return response.candidates;
}

/** Banner text for a stale closing report, or null when it is current / the server is old. */
export function staleReportNotice(body: { stale?: unknown; expectedDate?: unknown; report?: { date?: string | null; stale?: unknown; expectedDate?: unknown } | null } | null | undefined): { latest: string; expected: string } | null {
  if (!body) return null;
  const stale = body.stale ?? body.report?.stale;
  if (stale !== true) return null;
  const expected = body.expectedDate ?? body.report?.expectedDate;
  return { latest: body.report?.date || '—', expected: typeof expected === 'string' && expected ? expected : '—' };
}
