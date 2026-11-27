/**
 * Device leases on the shared close coordinator. Each lease is its own storage key
 * (`lease:<id>`), so a device wake writes at most one small value instead of
 * rewriting one map that holds every device. The legacy `leases` map migrates once.
 */
export type Lease = {until: number; target?: string};
export type LeaseStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list?<T>(options: {prefix: string; limit?: number; start?: string}): Promise<Map<string, T>>;
};
export const LEGACY_LEASES = 'leases', LEASE_PREFIX = 'lease:';
export const MAX_LEASE_MS = 30 * 86400000;

/** Legacy map values were either an expiry number or {until,target}; expired entries are dropped. */
export function normalizeLegacyLeases(raw: Record<string, number | Lease> | undefined, now = Date.now()): [string, Lease][] {
  return Object.entries(raw || {}).map(([id, v]) => [id, typeof v === 'number' ? {until: v} : v] as [string, Lease]).filter(([, v]) => !!v && Number.isFinite(v.until) && v.until > now);
}
export const sameLease = (a: Lease | undefined, b: Lease) => !!a && a.until === b.until && a.target === b.target;

export class LeaseStore {
  private migrated = false;
  constructor(private storage: LeaseStorage) {}
  private get keyed() { return typeof this.storage.list === 'function'; }

  /** Moves the legacy map to per-lease keys (idempotent; run under the caller's lock). */
  async migrate(now = Date.now()) {
    if (this.migrated || !this.keyed) return;
    const legacy = await this.storage.get<Record<string, number | Lease>>(LEGACY_LEASES);
    if (legacy) {
      for (const [id, lease] of normalizeLegacyLeases(legacy, now)) if (!await this.storage.get(LEASE_PREFIX + id)) await this.storage.put(LEASE_PREFIX + id, lease);
      await this.storage.delete(LEGACY_LEASES);
    }
    this.migrated = true;
  }

  /** Live leases by id. */
  async all(now = Date.now()): Promise<Map<string, Lease>> {
    if (!this.keyed) return new Map(normalizeLegacyLeases(await this.storage.get(LEGACY_LEASES), now));
    await this.migrate(now);
    const out = new Map<string, Lease>();
    let start: string | undefined;
    for (let page = 0; page < 50; page++) {
      const batch = await this.storage.list!<Lease>({prefix: LEASE_PREFIX, limit: 500, ...(start ? {start} : {})});
      let last = '';
      for (const [key, lease] of batch) { last = key; if (key !== start && lease && lease.until > now) out.set(key.slice(LEASE_PREFIX.length), lease); }
      if (batch.size < 500 || !last) break;
      start = last;
    }
    return out;
  }

  async active(now = Date.now()) { return (await this.all(now)).size > 0; }

  /** Creates or extends a lease; writes only when the value actually changes. Returns whether it wrote. */
  async ensure(id: string, until: number, target: string | undefined, now = Date.now()) {
    const capped = Math.min(Number(until) || 0, now + MAX_LEASE_MS);
    if (!this.keyed) {
      const map = Object.fromEntries(normalizeLegacyLeases(await this.storage.get(LEGACY_LEASES), now));
      const next = {until: capped, target: target ?? map[id]?.target};
      if (sameLease(map[id], next)) return false;
      map[id] = next; await this.storage.put(LEGACY_LEASES, map); return true;
    }
    await this.migrate(now);
    const old = await this.storage.get<Lease>(LEASE_PREFIX + id), next = {until: capped, target: target ?? old?.target};
    if (sameLease(old, next)) return false;
    await this.storage.put(LEASE_PREFIX + id, next);
    return true;
  }

  async release(id: string, now = Date.now()) {
    if (!this.keyed) {
      const map = Object.fromEntries(normalizeLegacyLeases(await this.storage.get(LEGACY_LEASES), now));
      if (!(id in map)) return;
      delete map[id]; await this.storage.put(LEGACY_LEASES, map); return;
    }
    await this.migrate(now);
    await this.storage.delete(LEASE_PREFIX + id);
  }

  /** Deletes expired lease keys (bounded). */
  async prune(now = Date.now(), budget = 200) {
    if (!this.keyed) return 0;
    let removed = 0;
    const batch = await this.storage.list!<Lease>({prefix: LEASE_PREFIX, limit: 1000});
    for (const [key, lease] of batch) if (!lease || !(lease.until > now)) { await this.storage.delete(key); if (++removed >= budget) break; }
    return removed;
  }
}
