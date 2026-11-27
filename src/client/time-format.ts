/**
 * One place for every displayed timestamp. Market data is shown in exchange time:
 * A-share / news / desk data in Asia/Shanghai, US-session specific values in America/New_York.
 * Invalid or partial values (for example a bare "+08:00" suffix) never reach Intl.format, which would throw.
 */
export type MarketZone = 'cn' | 'us';
export type TimeStyle = 'clock' | 'dateClock' | 'dateTime' | 'date' | 'weekdayClock';

export const ZONE_IDS: Record<MarketZone, string> = { cn: 'Asia/Shanghai', us: 'America/New_York' };
/** Chinese source strings; callers pass them through t() for English. */
export const ZONE_LABELS: Record<MarketZone, string> = { cn: '北京时间', us: '美东时间' };
const ZONE_SHORT: Record<MarketZone, string> = { cn: '北京', us: '纽约' };
const WEEKDAYS_ZH: Record<string, string> = { Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六', Sun: '周日' };

export function validDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, zone: MarketZone) {
  const id = ZONE_IDS[zone];
  let formatter = formatters.get(id);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: id, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    formatters.set(id, formatter);
  }
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) map[part.type] = part.value;
  return map;
}

/** Locale-independent, stable output: "14:30", "11-26 14:30", "2026-11-26 14:30", "2026-11-26". */
export function formatMarketTime(value: string | number | Date | null | undefined, style: TimeStyle = 'dateClock', options: { zone?: MarketZone; fallback?: string; locale?: string } = {}): string {
  const date = validDate(value);
  if (!date) return options.fallback ?? '—';
  const p = parts(date, options.zone ?? 'cn');
  const clock = p.hour + ':' + p.minute, monthDay = p.month + '-' + p.day, day = p.year + '-' + monthDay;
  if (style === 'clock') return clock;
  if (style === 'date') return day;
  if (style === 'dateTime') return day + ' ' + clock;
  if (style === 'weekdayClock') return monthDay + ' ' + (options.locale === 'en' ? p.weekday : WEEKDAYS_ZH[p.weekday] ?? p.weekday) + ' ' + clock;
  return monthDay + ' ' + clock;
}

/** Topbar style label, e.g. "北京 11-26 周四 14:30". */
export function zoneClock(now: Date, zone: MarketZone, locale = 'zh-CN') {
  const short = locale === 'en' ? (zone === 'cn' ? 'Beijing' : 'New York') : ZONE_SHORT[zone];
  return short + ' ' + formatMarketTime(now, zone === 'cn' ? 'weekdayClock' : 'clock', { zone, locale });
}

export const zoneForSymbol = (symbol = ''): MarketZone => /^\d{6}\.(SH|SZ|BJ)$/.test(symbol) || !/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/.test(symbol) ? 'cn' : 'us';

/** Coarse relative age for news lists; invalid input yields the fallback instead of NaN. */
export function relativeAge(value: string | null | undefined, now = Date.now()): { unit: 'now' | 'minute' | 'hour' | 'day' | 'unknown'; count: number } {
  const date = validDate(value);
  if (!date) return { unit: 'unknown', count: 0 };
  const minutes = Math.floor(Math.max(0, now - date.getTime()) / 60000);
  if (minutes < 1) return { unit: 'now', count: 0 };
  if (minutes < 60) return { unit: 'minute', count: minutes };
  if (minutes < 1440) return { unit: 'hour', count: Math.floor(minutes / 60) };
  return { unit: 'day', count: Math.floor(minutes / 1440) };
}
