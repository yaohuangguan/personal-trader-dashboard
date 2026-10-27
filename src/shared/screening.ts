import type {StockCharacter} from './stock-character';
import type { GuideAnalysis } from './guide-analysis';
import type { SourceStamp, Sector } from './desk-types';
export type UniverseItem = { symbol: string; name: string; price: number | null; changePercent: number | null; amount: number | null; turnover: number | null };
export type UniversePage = SourceStamp & { total: number; page: number; pageSize: number; sourceRows: number; items: UniverseItem[]; tradingDate: null };
export type CandidateBucket = '粘合蓄势' | '启动待确认' | '开花确认' | '回踩观察' | '形态候选';
export type ScreenCandidate = UniverseItem & { bucket: CandidateBucket; stage: string; asOf: string; provider: string; adhesion: number | null; bias60: number | null; volumeRatio: number | null; passed: number; required: number; risks: string[]; reasons: string[]; eventDate: string | null; provisional: boolean; character?:StockCharacter|null;patterns?:import('./pattern-screen').PatternMatch[];marketCap?:number|null;limitUpDates?:string[];limitUpMethod?:string;chip?:{concentration90:number;basis:string;notice:string;days:number;initialWeight:number} };
export function screenCandidate(stock: UniverseItem, guide: GuideAnalysis, provider: string): ScreenCandidate | null {
  if (!guide.ready || !guide.asOf || !guide.latestVolume) return null;
  let bucket: CandidateBucket | null = null;
  if (guide.adhesionPct !== null && guide.adhesionPct < 5 && !['确认失效', '开花后走弱'].includes(guide.stage)) bucket = '粘合蓄势';
  if (['确认观察', '盘中候选'].includes(guide.stage)) bucket = '启动待确认';
  if (guide.stage === '开花确认') bucket = '开花确认';
  if (guide.stage === '趋势延续' && guide.pullback && guide.bias60 !== null && guide.bias60 >= 0 && guide.bias60 < 10) bucket = '回踩观察';
  if (!bucket) return null;
  const requiredRules = guide.rules.filter(r => r.required);
  return { ...stock, bucket, stage: guide.stage, asOf: guide.asOf, provider, adhesion: guide.adhesionPct, bias60: guide.bias60, volumeRatio: guide.volumeRatio, passed: requiredRules.filter(r => r.state === 'pass').length, required: requiredRules.length, risks: guide.risks, reasons: [guide.adhesionLabel + (guide.adhesionPct === null ? '' : ` ${guide.adhesionPct.toFixed(2)}%`), ...guide.rules.filter(r => r.state === 'pass').map(r => r.title + '：' + r.value)].slice(0, 5), eventDate: guide.event?.date ?? null, provisional: guide.provisional };
}
export type SectorMember = { symbol: string; name: string; price: number | null; changePercent: number | null; amount: number | null };
export function sectorBreadth(members: SectorMember[], total: number, sourceEnded = true) {
  const active = members.filter(r => r.price !== null && r.price > 0 && r.changePercent !== null && r.amount !== null && r.amount > 0);
  const changes = active.map(r => r.changePercent!).sort((a, b) => a - b);
  const up = changes.filter(v => v > 0).length, down = changes.filter(v => v < 0).length;
  const positiveShare = active.length ? up / active.length : null;
  const median = changes.length ? changes.length % 2 ? changes[Math.floor(changes.length / 2)] : (changes[changes.length / 2 - 1] + changes[changes.length / 2]) / 2 : null;
  const complete = sourceEnded && total > 0 && members.length === total;
  const leaders = [...active].sort((a, b) => b.changePercent! - a.changePercent!).slice(0, 3);
  const leaderGap = leaders.length && median !== null ? leaders.reduce((sum, r) => sum + r.changePercent!, 0) / leaders.length - median : null;
  let label = '样本不足';
  if (complete && active.length >= 5 && median !== null && positiveShare !== null) label = positiveShare >= 0.65 && median > 0 ? leaderGap !== null && leaderGap > 8 ? '领涨突出 · 扩散待看' : '多数成分走强' : positiveShare <= 0.35 && median < 0 ? '多数成分走弱' : leaderGap !== null && leaderGap > 8 ? '领涨集中 · 内部分歧' : '多空分歧';
  return { sampled: members.length, total, sourceEnded, active: active.length, up, down, flat: active.length - up - down, positiveShare, median, complete, leaderGap, label, amount: active.reduce((sum, r) => sum + (r.amount || 0), 0) };
}
export type SectorScenario = SourceStamp & { code: string; breadth: ReturnType<typeof sectorBreadth>; leaders: SectorMember[]; tradingDate: null; conditions: { continuation: string; invalidation: string; verification: string } };
export type IndustryPayload = SourceStamp & { items: Sector[] };
