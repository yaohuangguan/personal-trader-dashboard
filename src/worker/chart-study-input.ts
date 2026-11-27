import type {Candle} from '../shared/types';
/** Bounds for the public POST /api/chart-study endpoint. */
export const MAX_CHART_STUDY_BARS = 1000;
export const MAX_CHART_STUDY_BODY = 600000;
export type ChartStudyInput = {task?: string; horizon?: number; candles: Candle[]; ma: number[]; unit?: string; symbol?: string; name?: string; amount?: number | null};
/** Parses and validates the body; bad JSON and malformed bars are 400s, not 500s. */
export function parseChartStudy(raw: string): {body: ChartStudyInput} | {error: string; status: 400 | 413} {
  if (raw.length > MAX_CHART_STUDY_BODY) return {error: '图表样本过大', status: 413};
  let body: ChartStudyInput;
  try { body = JSON.parse(raw); } catch { return {error: '无效 JSON', status: 400}; }
  if (!body || typeof body !== 'object' || !Array.isArray(body.candles) || !Array.isArray(body.ma)) return {error: '无效图表参数', status: 400};
  if (body.candles.length > MAX_CHART_STUDY_BARS) return {error: `图表样本过大（最多${MAX_CHART_STUDY_BARS}根K线）`, status: 413};
  if (body.candles.some(b => !b || typeof b.time !== 'string' || b.time.length > 32 || ![b.open, b.close, b.high, b.low, b.volume].every(Number.isFinite))) return {error: '无效图表参数', status: 400};
  if (body.ma.length > 16 || body.ma.some(v => !Number.isFinite(Number(v)))) return {error: '无效均线参数', status: 400};
  if (body.symbol !== undefined && (typeof body.symbol !== 'string' || body.symbol.length > 18)) return {error: '无效证券代码', status: 400};
  return {body};
}
