import type { NewsItem } from './types';

export type SourceStamp = { source: string; sourceUrl: string; fetchedAt: string; available: boolean; reason?: string };
export type BookLevel = { price: number | null; volume: number | null };
export type Snapshot = {
  symbol: string; name: string; price: number; previous: number; open: number | null; high: number | null; low: number | null;
  change: number | null; changePercent: number | null; volume: number | null; amount: number | null; turnover: number | null;
  pe: number | null; pb: number | null; marketCap: number | null; floatCap: number | null; volumeRatio: number | null;
  limitUp: number | null; limitDown: number | null; asOf: string; bids: BookLevel[]; asks: BookLevel[];
  session: 'trading' | 'break' | 'closed'; stale: boolean; volumeUnit: '股' | '手';
};
export type QuotesPayload = SourceStamp & { items: Snapshot[]; unavailable: string[]; level2: false; depth: 5 };
export type IntradayPoint = { time: number; clock: string; price: number; volume: number; cumulativeVolume: number; amount: number | null };
export type IntradayPayload = SourceStamp & { symbol: string; date: string | null; previous: number | null; points: IntradayPoint[] };
export type Tick = { sequence: number; time: string; price: number; volume: number; amount: number; side: 'B' | 'S' | 'M' };
export type TickPayload = SourceStamp & { symbol: string; date: string | null; items: Tick[]; partial: true; level2: false; volumeUnit: '手' };
export type Sector = { code: string; name: string; changePercent: number | null; leader: string; leaderSymbol: string | null; mainNet?: number | null };
export type Peer = { symbol: string; name: string; price: number | null; changePercent: number | null; mainNet: number | null };
export type SectorsPayload = SourceStamp & { symbol: string; boards: Sector[] };
export type PeersPayload = SourceStamp & { code: string; items: Peer[] };
export type SectorRanks = SourceStamp & { items: Sector[] };
export type FlowPoint = { time: string; main: number | null; small: number | null; medium: number | null; large: number | null; superLarge: number | null };
export type FlowPayload = SourceStamp & { symbol: string; points: FlowPoint[] };
export type FlashItem = NewsItem & { important?: boolean };
export type FlashPayload = SourceStamp & { items: FlashItem[]; warnings: string[]; sources: string[] };
export type ReportsPayload = SourceStamp & { items: { title: string; date: string; organization: string; rating: string; url: string }[] };
export type WatchRule = { id: string; symbol: string; direction: 'above' | 'below'; value: number; firedAt?: string };

export function marketSession(at = new Date()): 'trading' | 'break' | 'closed' {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
  const get = (key: string) => parts.find(p => p.type === key)?.value;
  if (['Sat', 'Sun'].includes(get('weekday') || '')) return 'closed';
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  if ((minute >= 570 && minute <= 690) || (minute >= 780 && minute <= 900)) return 'trading';
  return minute > 690 && minute < 780 ? 'break' : 'closed';
}

export function evaluateWatchRules(rules: WatchRule[], quotes: Snapshot[], now = new Date()): WatchRule[] {
  return rules.filter(rule => {
    const q = quotes.find(item => item.symbol === rule.symbol);
    if (rule.firedAt || !q || q.stale || q.session !== 'trading' || now.getTime() - Date.parse(q.asOf) > 120000) return false;
    return rule.direction === 'above' ? q.price >= rule.value : q.price <= rule.value;
  });
}
