import {fetchScreenDaily} from './pattern-screen';
import type {SessionInfo} from '../shared/close-schedule';

type Storage = {get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void>};
type Saved = {at: number; info: SessionInfo};
const KEY = 'close:session-info', FRESH_MS = 5 * 60000, USABLE_MS = 12 * 3600000;
let memory: Saved | null = null;

/** One small index request: the last few benchmark sessions (Tencent appends the forming one) plus its quote. */
export async function fetchSessionInfo(signal?: AbortSignal): Promise<SessionInfo> {
  const daily = await fetchScreenDaily('000001.SH', false, 5, signal);
  return {quoteDate: daily.quote?.asOf.slice(0, 10) ?? null, sessions: daily.candles.map(c => c.time)};
}

/**
 * Cached benchmark sessions for close-report staleness and device delivery.
 * `network: false` never fetches (used while publishing, so a slow source cannot block it).
 */
export async function sessionInfo(storage: Storage, options: {network?: boolean; now?: number; load?: () => Promise<SessionInfo>} = {}): Promise<SessionInfo | null> {
  const now = options.now ?? Date.now();
  const fresh = (saved: Saved | null | undefined) => !!saved && now >= saved.at && now - saved.at < FRESH_MS;
  if (fresh(memory)) return memory!.info;
  const saved = await storage.get<Saved>(KEY).catch(() => undefined);
  if (fresh(saved)) { memory = saved!; return saved!.info; }
  if (options.network !== false) {
    try {
      const info = await (options.load ?? (() => fetchSessionInfo(AbortSignal.timeout(4000))))();
      memory = {at: now, info};
      await storage.put(KEY, memory);
      return info;
    } catch { /* Fall back to the last observation below. */ }
  }
  const last = memory && (!saved || memory.at >= saved.at) ? memory : saved;
  return last && now >= last.at && now - last.at < USABLE_MS ? last.info : null;
}
export function resetSessionMemory() { memory = null; }
