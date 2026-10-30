export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };
export type MarketPayload = {
  symbol: string; displaySymbol: string; name: string; exchange: string; currency: string;
  candles: Candle[]; last: number | null; previous: number | null; change: number | null; changePercent: number | null;
  asOf: string | null; delayed: true; stale?: boolean; fetchedAt?: string; cacheSource?: string; provider: string; sourceUrl: string; notice: string;
};
export type NewsItem = {
  id: string; title: string; source: string; url: string; publishedAt: string | null;
  category: string; originalTitle: string; summary?:string; important?:boolean;
};
export type NewsPayload = { items: NewsItem[]; fetchedAt: string; category: string; sources: string[]; warnings: string[] };
export type SearchItem = { symbol: string; name: string; exchange: string; sector?: string };
export type FinanceMetric = { year: number; value: number; unit: string };
export type FundamentalsPayload = {
  symbol: string; available: boolean; company?: string; cik?: string;
  revenue?: FinanceMetric[]; netIncome?: FinanceMetric[];
  filings?: { form: string; date: string; accession: string; url: string }[];
  provider: string; notice: string; sourceUrl: string;
};
