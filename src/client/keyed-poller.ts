import {failureBackoff} from './hooks/live-policy';

/**
 * One timer for many keyed resources (per-symbol insight, per-symbol intraday sparkline) instead of one
 * interval per list row. Rows subscribe while visible; each key refreshes only when its value went stale,
 * failures back off (30s → 10min) instead of retrying every few seconds, and nothing runs while hidden.
 */
export type PollerEntry = { staleAt: number; retryAt: number; inflight: boolean; hasValue: boolean };

/** Pure: keys that need a request now, and when the timer should wake next. */
export function pollPlan(entries: Map<string, PollerEntry>, now: number, bounds = { min: 5000, max: 300000 }) {
  const due: string[] = [];let wake = Infinity;
  for (const [key, entry] of entries) {
    if (entry.inflight) continue;
    const at = Math.max(entry.hasValue ? entry.staleAt : 0, entry.retryAt);
    if (at <= now) due.push(key); else wake = Math.min(wake, at);
  }
  const delay = due.length ? bounds.min : Number.isFinite(wake) ? Math.min(bounds.max, Math.max(bounds.min, wake - now)) : bounds.max;
  return { due, delay };
}

type Options<T> = { load: (key: string) => Promise<T>; staleAt: (value: T, now: number) => number; concurrency?: number };

export class KeyedPoller<T> {
  private values = new Map<string, { value: T; staleAt: number }>();
  private refs = new Map<string, number>();
  private failures = new Map<string, { count: number; retryAt: number }>();
  private inflight = new Set<string>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  version = 0;
  constructor(private options: Options<T>) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });
      window.addEventListener('online', () => this.kick());
      window.addEventListener('atlas:refresh', () => { for (const key of this.refs.keys()) { const v = this.values.get(key); if (v) v.staleAt = 0; this.failures.delete(key); } this.kick(); });
    }
  }
  peek(key: string): T | undefined { return this.values.get(key)?.value; }
  /** The last attempt for this key failed (the value, if any, is from an earlier success). */
  failed(key: string) { return this.failures.has(key); }
  onChange = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  subscribe(keys: string[]): () => void {
    for (const key of keys) this.refs.set(key, (this.refs.get(key) || 0) + 1);
    this.kick();
    return () => { for (const key of keys) { const n = (this.refs.get(key) || 1) - 1; if (n > 0) this.refs.set(key, n); else this.refs.delete(key); } };
  }
  private kick() { clearTimeout(this.timer); this.timer = setTimeout(() => void this.tick(), 0); }
  private async tick() {
    if (this.running) return;
    if (typeof document !== 'undefined' && (document.hidden || !navigator.onLine)) return; // resumes on visibility/online
    const now = Date.now(), entries = new Map<string, PollerEntry>();
    for (const key of this.refs.keys()) {
      const value = this.values.get(key), failure = this.failures.get(key);
      entries.set(key, { staleAt: value?.staleAt ?? 0, retryAt: failure?.retryAt ?? 0, inflight: this.inflight.has(key), hasValue: !!value });
    }
    const plan = pollPlan(entries, now);
    this.running = true;
    try {
      const queue = [...plan.due];
      await Promise.all(Array.from({ length: Math.min(this.options.concurrency ?? 3, queue.length) }, async () => {
        for (let key = queue.shift(); key; key = queue.shift()) {
          this.inflight.add(key);
          try {
            const value = await this.options.load(key);
            // Never treat a fresh answer as already stale (server clock skew would loop requests).
            this.values.set(key, { value, staleAt: Math.max(Date.now() + 15000, this.options.staleAt(value, Date.now())) });
            if (this.values.size > 150) this.values.delete(this.values.keys().next().value!);
            this.failures.delete(key); this.version++; this.listeners.forEach(fn => fn());
          } catch {
            const count = (this.failures.get(key)?.count || 0) + 1;
            this.failures.set(key, { count, retryAt: Date.now() + failureBackoff(count) });
            if (count === 1) { this.version++; this.listeners.forEach(fn => fn()); }
          } finally { this.inflight.delete(key); }
        }
      }));
    } finally { this.running = false; }
    if (!this.refs.size) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), plan.due.length ? 0 : plan.delay);
  }
}
