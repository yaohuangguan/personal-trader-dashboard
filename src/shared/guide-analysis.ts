import type { Candle } from './types';
import { sma, macd, kdj } from './chart-indicators';

export const GUIDE_URL = 'https://trade.ps6.space/';
export const GUIDE_VERSION = '姚记五线开花 v10.4';
export const GUIDE_PERIODS = [5, 10, 20, 30, 60] as const;
export const GUIDE_DEFAULTS = {
  adhesionPct: 2, minAdhesionBars: 5, maxAdhesionBars: 20,
  launchGainPct: 5, launchVolumeRatio: 2, slopeBars: 5,
  flatTolerancePct: 0.1, closeLocation: 0.9, middleTolerance: 0.25,
  confirmationStart: 3, confirmationEnd: 5,
};
export type GuideSettings = typeof GUIDE_DEFAULTS;
export type RuleState = 'pass' | 'fail' | 'unknown';
export type GuideRule = { id: string; title: string; state: RuleState; value: string; rule: string; chapter: string; required: boolean };
export type GuideEvent = { date: string; index: number; low: number; high: number; close: number; midpoint: number; observedBars: number; state: 'pending' | 'confirmed' | 'failed'; confirmationDate: string | null; invalidationDate: string | null; reason: string };
export type GuideAnalysis = {
  currentLaunch:boolean; ready: boolean; available: number; required: number; asOf: string | null; provisional: boolean;
  stage: string; rules: GuideRule[]; events: GuideEvent[]; event: GuideEvent | null;
  ma: Record<number, number | null>; adhesionPct: number | null; adhesionLabel: string;
  priorAdhesionBars: number; volumeRatio: number | null; bias60: number | null;
  launchGainPct: number | null; latestVolume: number | null; pullback: boolean; crossedLines: number; sevenLineCrosses: number | null;
  risks: string[]; supporting: { title: string; state: RuleState; detail: string }[];
  dimensions: {title:string;value:string;detail:string}[]; settings: GuideSettings; warnings: string[];
};
const fmt = (n: number | null, digits = 2) => n === null ? '—' : n.toFixed(digits);
const mean = (n: number[]) => n.reduce((s, v) => s + v, 0) / n.length;
export function adhesionCoefficient(values: number[]): number | null {
  if (values.length < 2 || values.some(v => !Number.isFinite(v) || v <= 0)) return null;
  return Number(((Math.max(...values) - Math.min(...values)) / Math.min(...values) * 100).toFixed(10));
}
export function adhesionLabel(value: number | null) {
  return value === null ? '历史不足' : value < 2 ? '极致粘合' : value < 5 ? '紧密粘合' : value < 10 ? '松散粘合' : '发散状态';
}
function beijing(at: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}
function validCandles(input: Candle[]) {
  const rows = input.slice().sort((a, b) => a.time.localeCompare(b.time));
  return rows.every((c, i) => /^\d{4}-\d{2}-\d{2}$/.test(c.time) && Number.isFinite(Date.parse(c.time + 'T00:00:00Z')) && (!i || c.time !== rows[i - 1].time) && [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) && Math.min(c.open, c.low, c.close) > 0 && c.volume >= 0 && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close)) ? rows : [];
}

/** A causal checklist implementing the user's guide; never a calibrated win probability. */
export function analyzeGuide(input: Candle[], options: { now?: Date; settings?: Partial<GuideSettings> } = {}): GuideAnalysis {
  const clock = beijing(options.now ?? new Date());
  const settings = { ...GUIDE_DEFAULTS, ...options.settings }, candles = validCandles(input).filter(c => c.time <= clock.date), n = candles.length;
  const allPeriods = [3, 5, 6, 10, 12, 20, 24, 30, 60, 90, 120, 250];
  const series = Object.fromEntries(allPeriods.map(p => [p, new Map(sma(candles, p).map(v => [v.time, v.value]))])) as Record<number, Map<string, number>>;
  const at = (p: number, i: number) => i >= 0 ? series[p].get(candles[i]?.time) ?? null : null;
  const coefficient = (i: number) => { const values = GUIDE_PERIODS.map(p => at(p, i)); return values.every(v => v !== null) ? adhesionCoefficient(values as number[]) : null; };
  const ordered = (i: number) => GUIDE_PERIODS.every((p, k) => k === 4 || at(p, i) !== null && at(GUIDE_PERIODS[k + 1], i) !== null && at(p, i)! > at(GUIDE_PERIODS[k + 1], i)!);
  const rule = (id: string, title: string, value: string, passed: boolean | null, text: string, chapter = '02', required = true): GuideRule => ({ id, title, value, state: passed === null ? 'unknown' : passed ? 'pass' : 'fail', rule: text, chapter, required });
  function inspect(i: number) {
    const c = candles[i];
    let count = 0;
    for (let j = i - 1; j >= 0 && count < settings.maxAdhesionBars; j--) {
      const v = coefficient(j); if (v === null || v >= settings.adhesionPct) break; count++;
    }
    const baseline = count >= settings.minAdhesionBars ? candles.slice(i - count, i).map(v => v.volume) : [];
    const ratio = baseline.length && baseline.every(v => v > 0) && c.volume > 0 ? Number((c.volume / mean(baseline)).toFixed(8)) : null;
    const gain = i > 0 ? Number(((c.close / candles[i - 1].close - 1) * 100).toFixed(8)) : null;
    const mas = GUIDE_PERIODS.map(p => at(p, i));
    const complete = mas.every(v => v !== null);
    const crosses = mas.filter(v => v !== null && c.open <= v && c.close >= v).length;
    const body = c.close - c.open, midpoint = (c.close + c.open) / 2;
    const middle = complete && body > 0 ? Math.abs(mean(mas as number[]) - midpoint) / body : null;
    const location = c.high > c.low ? (c.close - c.low) / (c.high - c.low) : null;
    const slopes = [30, 60].map(p => at(p, i) !== null && at(p, i - settings.slopeBars) !== null ? (at(p, i)! / at(p, i - settings.slopeBars)! - 1) * 100 : null);
    const rules = [
      rule('adhesion', '先有粘合', `${count} 根 · 前一日 ${fmt(coefficient(i - 1))}%`, i >= 60 ? count >= settings.minAdhesionBars : null, `前序连续至少 ${settings.minAdhesionBars} 根粘合系数 <${settings.adhesionPct}%；最多回看${settings.maxAdhesionBars}根`, '03'),
      rule('strength', '放量大阳', `${fmt(gain)}% · ${fmt(ratio)}×`, gain === null || ratio === null ? null : c.close > c.open && gain > settings.launchGainPct && ratio > settings.launchVolumeRatio, `相对昨收涨幅 >${settings.launchGainPct}%，阳线，成交量 > 粘合期均量${settings.launchVolumeRatio}倍`, '02 / 08'),
      rule('decision', '站稳 MA60', `收 ${fmt(c.close)} / MA60 ${fmt(at(60, i))}`, at(60, i) === null ? null : c.close > at(60, i)!, '收盘高于60日决策线'),
      rule('slopes', '30 / 60 日止跌', slopes.map(v => fmt(v) + '%').join(' / '), slopes.some(v => v === null) ? null : slopes.every(v => v! >= -settings.flatTolerancePct), `${settings.slopeBars}根斜率均 ≥ −${settings.flatTolerancePct}%（走平容差）`),
      rule('cross', '实体贯穿五线', `${crosses} / 5`, complete ? c.close > c.open && crosses === 5 : null, '阳线实体覆盖当日 MA5/10/20/30/60'),
      rule('close', '收近全天高点', location === null ? '—' : (location * 100).toFixed(1) + '%', location === null ? null : location >= settings.closeLocation, `收盘在日内振幅的上方${((1 - settings.closeLocation) * 100).toFixed(0)}%区域`),
      rule('middle', '中轴穿线', middle === null ? '—' : (middle * 100).toFixed(1) + '% 偏移', middle === null ? null : middle <= settings.middleTolerance, `五线均值距实体中点 ≤ 实体高度${settings.middleTolerance * 100}%；指南为优选条件`, '02', false),
    ];
    return { count, ratio, gain, crosses, rules, launch: rules.filter(r => r.required).every(r => r.state === 'pass') };
  }
  const time = clock, last = candles.at(-1);
  const provisional = !!last && last.time === time.date && time.minute < 900;
  const lastClosed = n - 1 - Number(provisional), events: GuideEvent[] = [];
  for (let i = 64; i <= lastClosed; i++) {
    if (!inspect(i).launch) continue;
    const c = candles[i], midpoint = (c.open + c.close) / 2;
    const event: GuideEvent = { date: c.time, index: i, low: c.low, high: c.high, close: c.close, midpoint, observedBars: Math.min(settings.confirmationEnd, lastClosed - i), state: 'pending', confirmationDate: null, invalidationDate: null, reason: '等待3–5根后续已收盘日线' };
    for (let j = i + 1; j <= Math.min(lastClosed, i + settings.confirmationEnd); j++) {
      if (candles[j].low < midpoint) { event.state = 'failed'; event.invalidationDate = candles[j].time; event.reason = '后续最低价跌破启动阳线实体中点'; break; }
      if (j - i >= settings.confirmationStart && ordered(j)) { event.state = 'confirmed'; event.confirmationDate ??= candles[j].time; event.reason = '已观察至少3根，实体半位守住且5>10>20>30>60'; }
    }
    if (event.state === 'pending' && lastClosed - i >= settings.confirmationEnd) { event.state = 'failed'; event.reason = '5根确认窗口内未形成标准多头排列'; }
    events.push(event);
  }
  const event = [...events].reverse().find(e => n - 1 - e.index <= 20) ?? null;
  const current = n ? inspect(n - 1) : null, focus = event ? inspect(event.index) : current;
  const ma = Object.fromEntries(allPeriods.map(p => [p, at(p, n - 1)]));
  const bias60 = last && ma[60] ? (last.close / ma[60]! - 1) * 100 : null;
  const risks: string[] = [];
  if (bias60 !== null && bias60 > 20) risks.push(`BIAS60 ${bias60.toFixed(1)}% >20%，长期乖离偏大`);
  if (last && ma[5] !== null && last.close < ma[5]!) risks.push('收盘低于MA5，短期动能需复核');
  if (last && ma[20] !== null && last.close < ma[20]!) risks.push('收盘低于MA20，趋势支撑需复核');
  if (last && event && last.close < event.low) risks.push('收盘跌破启动阳线最低价，启动逻辑破坏');
  if (last && event && n - 1 - event.index >= 7 && last.close <= event.close) risks.push(`启动后${n - 1 - event.index}根仍未脱离启动收盘价，进入7–10根时间复核区`);
  const momentum = macd(candles), oscillator = kdj(candles), m = momentum.at(-1), pm = momentum.at(-2), k = oscillator.at(-1), pk = oscillator.at(-2);
  if (k && pk && pk.j >= 80 && k.j < 80) risks.push('KDJ J值从高位跌破80，按指南复核止盈条件');
  const bbiValues = [3, 6, 12, 24].map(p => ma[p]), bbi = bbiValues.every(v => v !== null) ? mean(bbiValues as number[]) : null;
  const supporting: GuideAnalysis['supporting'] = [
    { title: 'MACD 水上结构', state: !m ? 'unknown' : m.dif > 0 && m.dea > 0 && m.dif > m.dea ? 'pass' : 'fail', detail: m ? `DIF ${fmt(m.dif)} / DEA ${fmt(m.dea)}；${m.histogram > 0 && pm && m.histogram > pm.histogram ? '红柱增强' : '未见红柱增强'}` : 'MACD预热不足' },
    { title: 'KDJ 强势钝化', state: !k ? 'unknown' : k.j >= 100 ? 'pass' : 'fail', detail: k ? `J ${fmt(k.j)}；高位钝化单独出现不作为卖出信号` : 'KDJ历史不足' },
    { title: 'BBI 多空分界', state: !last || bbi === null ? 'unknown' : last.close > bbi ? 'pass' : 'fail', detail: `BBI(3/6/12/24等权均值) ${fmt(bbi)}` },
    { title: '筹码与盘口验证', state: 'unknown', detail: '筹码峰与集中度可查看量价模型估算；真实持仓、逐笔委托和队列保持待核验' },
    { title: '消息与板块风口', state: 'unknown', detail: '结合市场、行业和原始消息人工复核；标题不自动等同于业绩或订单' },
  ];
  const pullback = n >= 65 && ordered(n - 1) && [n - 2, n - 1].every(i => candles[i].close <= candles[i - 1].close && candles[i].volume > 0 && candles[i].volume < candles[i - 1].volume && at(10, i) !== null && candles[i].low >= at(10, i)!) && at(5, n - 1)! >= at(5, n - 3)! && at(10, n - 1)! >= at(10, n - 3)!;
  const vol20 = n >= 21 ? mean(candles.slice(-21,-1).map(c=>c.volume)) : null;
  const currentRelativeVolume = last && vol20 && last.volume > 0 ? last.volume / vol20 : null;
  const dayGain = current?.gain ?? null;
  const volumeDNA = dayGain === null || currentRelativeVolume === null ? '量价待核验' : Math.abs(dayGain) < 0.5 && currentRelativeVolume >= 2 ? '量大滞涨' : Math.abs(dayGain) < 0.5 && currentRelativeVolume <= 0.8 ? '量缩价平' : dayGain > 0 ? currentRelativeVolume >= 1 ? '量增价涨' : '量缩价涨' : currentRelativeVolume >= 1 ? '量增价跌' : '量缩价跌';
  if(volumeDNA==='量大滞涨')risks.push('当前量大滞涨，需结合位置和原始资金证据复核，不能仅凭此认定出货');
  let above20Bars=0;for(let i=n-1;i>=19;i--){if(candles[i].close>at(20,i)!)above20Bars++;else break;}
  const priorRange=n>=121?candles.slice(-121,-1):[],rangeHigh=priorRange.length?Math.max(...priorRange.map(c=>c.high)):null,rangeLow=priorRange.length?Math.min(...priorRange.map(c=>c.low)):null;
  const anchor=events.at(-1),anchorBars=anchor?n-1-anchor.index:null;
  const dimensions=[
    {title:'量 · 量能关系',value:volumeDNA,detail:'当前量/前20根均量 '+fmt(currentRelativeVolume)+'×；涨幅 '+fmt(dayGain)+'%。量价是现象，不直接断言主力身份。'},
    {title:'价 · 成本结构',value:ordered(n-1)?'5>10>20>30>60':'尚未标准多头',detail:'MA60 '+fmt(ma[60])+'；收盘 '+fmt(last?.close??null)+'；BIAS60 '+fmt(bias60)+'%。'},
    {title:'时 · 持续与窗口',value:'连续高于MA20 '+above20Bars+'根',detail:anchorBars===null?'尚无已核验启动锚点，不推定斐波那契变盘时间。':'距最近启动 '+anchorBars+'根'+([13,21,34].includes(anchorBars)?'，触及指南时间观察窗；窗口不是变盘预测。':'；3–5根用于确认，7–10根用于时间复核。')},
    {title:'空 · 前序区间',value:rangeHigh&&last?'距前120根高点 '+((last.close/rangeHigh-1)*100).toFixed(1)+'%':'长期空间样本不足',detail:'前120根高/低 '+fmt(rangeHigh)+' / '+fmt(rangeLow)+'；当日不回填进此前阻力区间。'},
  ];
  const ready = n >= 65;
  let stage = !ready ? '数据不足' : event?.state === 'failed' ? '确认失效' : event?.state === 'confirmed' ? '开花确认' : event ? '确认观察' : current?.launch ? '盘中候选' : coefficient(n - 1) !== null && coefficient(n - 1)! < settings.adhesionPct ? '粘合蓄势' : ordered(n - 1) ? '趋势延续' : '尚未成形';
  if (last && event?.state === 'confirmed' && ma[20] !== null && last.close < ma[20]!) stage = '开花后走弱';
  if (last && event?.state === 'confirmed' && last.close < event.low) stage = '确认失效';
  return { currentLaunch:!!current?.launch, ready, available: n, required: 65, asOf: last?.time ?? null, provisional, stage, rules: focus?.rules ?? [], events: events.slice(-12), event, ma, adhesionPct: coefficient(n - 1), adhesionLabel: adhesionLabel(coefficient(n - 1)), priorAdhesionBars: current?.count ?? 0, volumeRatio: current?.ratio ?? null, bias60, launchGainPct: current?.gain ?? null, latestVolume: last?.volume ?? null, pullback, crossedLines: current?.crosses ?? 0, sevenLineCrosses: last && [5, 10, 20, 30, 60, 120, 250].every(p => ma[p] !== null) ? [5, 10, 20, 30, 60, 120, 250].filter(p => last.open <= ma[p]! && last.close >= ma[p]!).length : null, risks, supporting, dimensions, settings, warnings: [ ...(input.length && !n ? ['存在无效或重复OHLCV，停止判断'] : []), ...(!ready ? ['核心至少需65根有效日线；长周期背景另需250根'] : []), ...(provisional ? ['最后一根日线未收盘，盘中形态不计为已确认信号'] : []), '条件命中不代表回测胜率；不把主力意图从价格形态推定为事实。' ] };
}

export function closedPeriodCandles(input: Candle[], unit: 'week' | 'month', now = new Date()) {
  const t = beijing(now), date = new Date(t.date + 'T00:00:00Z');
  return validCandles(input).filter(c => {
    if (c.time > t.date) return false;
    const d = new Date(c.time + 'T00:00:00Z');
    if (unit === 'month') return c.time.slice(0, 7) < t.date.slice(0, 7);
    const monday = (v: Date) => v.getTime() - ((v.getUTCDay() + 6) % 7) * 86400000;
    return monday(d) < monday(date) || monday(d) === monday(date) && (date.getUTCDay() === 6 || date.getUTCDay() === 0 || date.getUTCDay() === 5 && t.minute >= 900);
  });
}

export function analyzeGuideResonance(weekly: Candle[], monthly: Candle[], now = new Date()) {
  const w = closedPeriodCandles(weekly, 'week', now), m = closedPeriodCandles(monthly, 'month', now);
  const averageAt = (rows: Candle[], p: number, back = 0) => rows.length - back >= p ? mean(rows.slice(rows.length - back - p, rows.length - back).map(c => c.close)) : null;
  const w5 = averageAt(w, 5), w10 = averageAt(w, 10), w30 = averageAt(w, 30), w60 = averageAt(w, 60), pw30 = averageAt(w, 30, 5), pw60 = averageAt(w, 60, 5);
  const crossed = w.length >= 65 && Array.from({ length: 5 }, (_, back) => averageAt(w, 5, back)! > averageAt(w, 10, back)! && averageAt(w, 5, back + 1)! <= averageAt(w, 10, back + 1)!).some(Boolean);
  const weeklyMatch = w.length >= 65 && crossed && w5! > w10! && adhesionCoefficient([w30!, w60!])! < 2 && w30! / pw30! >= 0.999 && w60! / pw60! >= 0.999;
  const ma30 = averageAt(m, 30), prev30 = averageAt(m, 30, 1), before30 = averageAt(m, 30, 2), last = m.at(-1), prev = m.at(-2), before = m.at(-3);
  const monthlyMatch = m.length >= 32 && !!last && !!prev && !!before && before.close <= before30! && prev.close > prev30! && prev.volume > before.volume && last.low >= ma30! && last.close >= ma30! && last.volume < prev.volume;
  return { weekly: { ready: w.length >= 65, matched: weeklyMatch, bars: w.length, asOf: w.at(-1)?.time ?? null, detail: `MA5 ${fmt(w5)} / MA10 ${fmt(w10)}；MA30/60粘合 ${fmt(w30 && w60 ? adhesionCoefficient([w30, w60]) : null)}%` }, monthly: { ready: m.length >= 32, matched: monthlyMatch, bars: m.length, asOf: last?.time ?? null, detail: `MA30月 ${fmt(ma30)}；验证前月放量突破、次月缩量回踩不破` } };
}
