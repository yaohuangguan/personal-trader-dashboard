import type { Candle } from './types';

export const DEFAULT_MA_PERIODS = [5, 13, 20, 30, 60, 120, 144, 250] as const;
export const MA_COLORS = ['#f4f5f7', '#f7cf65', '#ed89bf', '#52c6e5', '#8a99ff', '#ff9b60', '#71cfb5', '#bf9ce5'];
export type MAPreference = { period: number; enabled: boolean; color: string };
export type Point = { time: string; value: number };
export type MACDPoint = { time: string; dif: number; dea: number; histogram: number };
export type KDJPoint = { time: string; k: number; d: number; j: number };
export type ChartSignal = { time: string; kind: 'golden' | 'death' | 'bloom'; text: string };

export function defaultMAs(): MAPreference[] {
  return DEFAULT_MA_PERIODS.map((period, i) => ({ period, enabled: true, color: MA_COLORS[i] }));
}

export function validMAPreferences(value: unknown): value is MAPreference[] {
  return Array.isArray(value) && value.length === 8 && value.every(line =>
    line && Number.isInteger(line.period) && line.period >= 1 && line.period <= 500 &&
    typeof line.enabled === 'boolean' && /^#[0-9a-f]{6}$/i.test(line.color)
  ) && new Set(value.filter(line => line.enabled).map(line => line.period)).size === value.filter(line => line.enabled).length;
}

/** Compute on the complete input, before selecting a visible date range. */
export function sma(candles: Candle[], period: number, field: 'close' | 'volume' = 'close'): Point[] {
  if (!Number.isInteger(period) || period < 1) throw new Error('MA period must be a positive integer');
  const points: Point[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i][field];
    if (i >= period) sum -= candles[i - period][field];
    if (i >= period - 1) points.push({ time: candles[i].time, value: sum / period });
  }
  return points;
}

/** MACD(12,26,9); domestic chart convention: bars = 2 * (DIF - DEA). */
export function macd(candles: Candle[]): MACDPoint[] {
  if (!candles.length) return [];
  let fast = candles[0].close, slow = fast, dea = 0;
  const points: MACDPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    fast += 2 / 13 * (candles[i].close - fast);
    slow += 2 / 27 * (candles[i].close - slow);
    const dif = fast - slow;
    dea += 2 / 10 * (dif - dea);
    // Suppress the initial 26 + 9 - 2 warm-up bars.
    if (i >= 33) points.push({ time: candles[i].time, dif, dea, histogram: 2 * (dif - dea) });
  }
  return points;
}

/** KDJ(9,3,3): K = (2*Kprev + RSV)/3; D = (2*Dprev + K)/3; J = 3K - 2D. */
export function kdj(candles: Candle[]): KDJPoint[] {
  const points: KDJPoint[] = [];
  let k = 50, d = 50;
  for (let i = 8; i < candles.length; i++) {
    const window = candles.slice(i - 8, i + 1);
    const high = Math.max(...window.map(c => c.high));
    const low = Math.min(...window.map(c => c.low));
    const rsv = high === low ? 50 : 100 * (candles[i].close - low) / (high - low);
    k = (2 * k + rsv) / 3;
    d = (2 * d + k) / 3;
    points.push({ time: candles[i].time, k, d, j: 3 * k - 2 * d });
  }
  return points;
}

export function chartIndicators(candles: Candle[], preferences: MAPreference[]) {
  const periods = [...new Set(preferences.filter(p => p.enabled).map(p => p.period))].sort((a, b) => a - b);
  const ma = Object.fromEntries(periods.map(p => [p, sma(candles, p)])) as Record<number, Point[]>;
  const maps = Object.fromEntries(periods.map(p => [p, new Map(ma[p].map(v => [v.time, v.value]))])) as Record<number, Map<string, number>>;
  const macdPoints = macd(candles), kdjPoints = kdj(candles);
  const momentum = new Map(macdPoints.map(p => [p.time, p.histogram]));
  const signals: ChartSignal[] = [];
  let expanded = false;
  for (let i = 1; i < candles.length; i++) {
    const time = candles[i].time, previous = candles[i - 1].time;
    if (periods.length >= 2) {
      const [fast, slow] = periods;
      const a = maps[fast].get(time), b = maps[slow].get(time);
      const prevA = maps[fast].get(previous), prevB = maps[slow].get(previous);
      if (a !== undefined && b !== undefined && prevA !== undefined && prevB !== undefined) {
        if (prevA <= prevB && a > b) signals.push({ time, kind: 'golden', text: `金叉 ${fast}/${slow}` });
        if (prevA >= prevB && a < b) signals.push({ time, kind: 'death', text: `死叉 ${fast}/${slow}` });
      }
    }
    const values = periods.map(p => maps[p].get(time));
    const complete = periods.length >= 2 && values.every(v => v !== undefined);
    const ordered = complete && values.every((v, n) => n === values.length - 1 || v! > values[n + 1]!);
    const rising = i >= 5 && complete && periods.every(p => {
      const prior = maps[p].get(candles[i - 5].time);
      return prior !== undefined && maps[p].get(time)! > prior;
    });
    const nowExpanded = ordered && rising && candles[i].close > values[0]! && (momentum.get(time) ?? 0) > 0;
    if (nowExpanded && !expanded) signals.push({ time, kind: 'bloom', text: '均线展开' });
    expanded = nowExpanded;
  }
  return { ma, macd: macdPoints, kdj: kdjPoints, volume5: sma(candles, 5, 'volume'), volume20: sma(candles, 20, 'volume'), signals, expanded };
}
