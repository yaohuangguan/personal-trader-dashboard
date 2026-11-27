/**
 * Ordered provider fallback with hedging and an overall deadline.
 * Providers are tried in priority order. A failure starts the next one immediately; a provider
 * that has not answered within `hedgeAfterMs` gets the next one started alongside it (at most
 * `maxInFlight` at a time). A result from a lower-priority provider is held for up to
 * `preferHigherMs` while a higher-priority provider is still running, so a merely slow primary
 * source keeps priority and the chosen source stays the same as the sequential chain whenever
 * possible. After `deadlineMs` the best result so far is used, or the chain fails with every
 * provider's reason.
 */
export type ProviderAttempt<T> = {name: string; run: () => Promise<T>};
export type ChainResult<T> = {value: T; index: number; failures: string[]};

export function firstSuccess<T>(attempts: ProviderAttempt<T>[], options: {hedgeAfterMs?: number; deadlineMs?: number; maxInFlight?: number; preferHigherMs?: number; valid?: (value: T) => boolean} = {}): Promise<ChainResult<T>> {
  const hedgeAfter = options.hedgeAfterMs ?? 1500, deadline = options.deadlineMs ?? 20000, maxInFlight = options.maxInFlight ?? 2, preferHigher = options.preferHigherMs ?? 4000, valid = options.valid ?? (() => true);
  return new Promise((resolve, reject) => {
    const failures: string[] = [], running = new Set<number>();
    let next = 0, done = false, best: {value: T; index: number} | null = null;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined, graceTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => { if (done) return; done = true; clearTimeout(hedgeTimer); clearTimeout(graceTimer); clearTimeout(deadlineTimer); fn(); };
    const settleBest = () => { if (best) { const chosen = best; finish(() => resolve({...chosen, failures})); } };
    const higherRunning = (index: number) => [...running].some(i => i < index);
    const deadlineTimer = setTimeout(() => best ? settleBest() : finish(() => reject(new Error('Providers exceeded ' + deadline + 'ms:' + failures.map(f => ' ' + f).join('') + (running.size ? ' (' + running.size + ' still pending)' : '')))), deadline);
    const scheduleHedge = () => { clearTimeout(hedgeTimer); if (next < attempts.length && !best) hedgeTimer = setTimeout(() => { if (!done && running.size < maxInFlight) start(); }, hedgeAfter); };
    const check = () => {
      if (done) return;
      if (best && !higherRunning(best.index)) return settleBest();
      if (!best && running.size === 0 && next >= attempts.length) finish(() => reject(new Error(failures.join('; ') || 'No provider configured')));
    };
    function start() {
      if (done || next >= attempts.length) return;
      const index = next++, attempt = attempts[index];
      running.add(index);
      scheduleHedge();
      Promise.resolve().then(attempt.run).then(value => {
        running.delete(index);
        if (valid(value)) {
          if (!best || index < best.index) best = {value, index};
          if (higherRunning(best.index) && !graceTimer) graceTimer = setTimeout(settleBest, preferHigher);
        } else { failures.push(attempt.name + ': empty result'); if (!best && running.size < maxInFlight) start(); }
        check();
      }, (error: unknown) => {
        running.delete(index);
        failures.push(attempt.name + ': ' + (error instanceof Error ? error.message : String(error)));
        if (!best && running.size < maxInFlight) start();
        check();
      });
    }
    if (!attempts.length) { finish(() => reject(new Error('No provider configured'))); return; }
    start();
  });
}
