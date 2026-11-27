import {t as copyText} from '../preferences';
import CompactSelect from './CompactSelect';
import ProjectionPanel from './ProjectionPanel';
import {useChartHistory} from '../hooks/useChartHistory';
import {projectMarket} from '../../shared/market-projection';
import {indicatorOverlay} from './chart-indicator-overlay';
import {CLASSIC_MA,FIBONACCI_MA} from '../../shared/ma-system';
import {chartPatternOverlay} from './chart-pattern-overlay';
import type {TradeMarker} from '../../shared/guide-action';
import type {PatternMark} from '../../shared/pattern-marks';
import {t as uiText} from '../preferences';
import ChipProfile from './ChipProfile';
import {chartColor,usePreferences} from '../preferences';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Maximize2, Minimize2, RotateCcw, Settings2 } from 'lucide-react';
import { createChart, ColorType, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi, type LogicalRange, type Time, type LineData, type WhitespaceData, type SeriesMarker, type AutoscaleInfo } from 'lightweight-charts';
import * as Dialog from '@radix-ui/react-dialog';
import './MarketChart.css';
import type { Candle } from '../../shared/types';
import type { GuideEvent } from '../../shared/guide-analysis';
import { defaultMAs, migrateMAPreferences, validMAPreferences, type MAPreference, type Point } from '../../shared/chart-indicators';
import { excludedFromAutoscale, useChartData, type ChartDataSnapshot } from './chart-data';

const UP = '#f04a55', DOWN = '#28cdb6';
const SETTINGS_KEY = 'atlas.chart.ma.v2';
const NO_TRADES:TradeMarker[]=[];
type Range = '1M' | '3M' | '6M' | '1Y' | 'ALL';
type Panel = 'VOL' | 'MACD' | 'KDJ' | 'RSI';
export const chartTime=(value:string):Time=>value.length>10?Math.floor(Date.parse(value.replace(' ','T')+':00+08:00')/1000) as Time:value as Time;
type Line = ISeriesApi<'Line'>;
type PaneKind = 'MAIN' | Panel;
type Pane = { kind: PaneKind; chart: IChartApi; anchor: ISeriesApi<'Candlestick'> | ISeriesApi<'Histogram'> | ISeriesApi<'Line'>; values: Map<string, number> };
/** Charts + series created once per structure; data effects only call setData / setMarkers on them. */
type ChartSet = {
  main: IChartApi; prices: ISeriesApi<'Candlestick'>; simulated?: ISeriesApi<'Candlestick'>;
  overlays: { line: Line; future?: Line; pick: (d: ChartDataSnapshot, future: boolean) => Point[] }[];
  sub: { chart: IChartApi; series: (ISeriesApi<'Line'> | ISeriesApi<'Histogram'>)[]; apply: (d: ChartDataSnapshot) => void; marks?: (d: ChartDataSnapshot) => void; markRemover?: () => void }[];
  panes: Pane[]; annotations: { update: (range: LogicalRange | null) => void; destroy: () => void } | null;
  applied: ChartDataSnapshot | null; appliedBars: { length: number; first?: string };
};
const number = (value: number | undefined, digits = 2) => value === undefined ? '—' : value.toFixed(digits);
const volumeNumber = (value: number | undefined) => value === undefined ? '—' : value >= 1e8 ? (value / 1e8).toFixed(2) + '亿' : value >= 1e4 ? (value / 1e4).toFixed(2) + '万' : value.toFixed(0);
function readPreferences() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    return migrateMAPreferences(saved);
  } catch { return defaultMAs(); }
}
function timeKey(time: Time): string {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date((time+28800)*1000).toISOString().slice(0,16).replace('T',' ');
  return time.year + '-' + String(time.month).padStart(2, '0') + '-' + String(time.day).padStart(2, '0');
}
const rangeSize = (range: Range, length: number, unit: string) => range === 'ALL' ? length : (unit==='week'?[4,13,26,52]:unit==='month'?[1,3,6,12]:[22,66,132,264])[['1M','3M','6M','1Y'].indexOf(range)];

/** Crosshair position lives outside React state: only the legend components re-render on hover. */
function createHoverStore() {
  let value: string | null = null, frame = 0, pending: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    /** rAF-throttled; ignores moves within the same bar. */
    set(next: string | null) { pending = next; if (frame) return; frame = requestAnimationFrame(() => { frame = 0; if (pending === value) return; value = pending; listeners.forEach(fn => fn()); }); },
    reset() { cancelAnimationFrame(frame); frame = 0; pending = value = null; listeners.forEach(fn => fn()); },
  };
}
type HoverStore = ReturnType<typeof createHoverStore>;
function useHoverCandle(hover: HoverStore, byTime: Map<string, Candle>, last: Candle | undefined) {
  const time = useSyncExternalStore(hover.subscribe, hover.get);
  return (time && byTime.get(time)) || last;
}

type LegendProps = { hover: HoverStore; byTime: Map<string, Candle>; last: Candle | undefined };
const OhlcReadout = memo(function OhlcReadout({ hover, byTime, last }: LegendProps) {
  const current = useHoverCandle(hover, byTime, last);
  return <div className="terminal-ohlc" aria-live="off"><strong>{current&&last&&current.time>last.time?uiText('推演 · '):''}{uiText(current?.time)}</strong>{current && <><span>{uiText("开")}<b>{number(current.open)}</b></span><span>{uiText("高")}<b className="terminal-up">{number(current.high)}</b></span><span>{uiText("低")}<b className="terminal-down">{number(current.low)}</b></span><span>{uiText("收")}<b className={current.close >= current.open ? 'terminal-up' : 'terminal-down'}>{number(current.close)}</b></span></>}</div>;
});
const MaLegend = memo(function MaLegend({ hover, byTime, last, preferences, maMaps, light, onToggle, hidden }: LegendProps & { preferences: MAPreference[]; maMaps: Record<number, Map<string, number>>; light: boolean; onToggle: (i: number) => void; hidden: boolean }) {
  const current = useHoverCandle(hover, byTime, last);
  return <div style={{display:hidden?'none':undefined}} className="terminal-ma-legend" aria-label={uiText("均线数值")}>{preferences.map((line, i) => <button type="button" key={i} aria-label={uiText((line.enabled ? '隐藏' : '显示') + ' MA' + line.period)} aria-pressed={line.enabled} style={{ color: chartColor(line.color,light) }} className={line.enabled ? '' : 'is-hidden'} onClick={() => onToggle(i)}><i style={{ background: line.color }} /><span>MA{line.period}</span><b>{line.enabled && current ? number(maMaps[line.period]?.get(current.time)) : '—'}</b></button>)}</div>;
});
const PatternReadout = memo(function PatternReadout({ hover, byTime, last, trades, shapes }: LegendProps & { trades: TradeMarker[]; shapes: PatternMark[] }) {
  const current = useHoverCandle(hover, byTime, last);
  const hits = current ? shapes.filter(m => m.time === current.time) : [];
  return <div className="terminal-pattern-readout" aria-label={uiText('当前K线形态')} aria-live="off"><small>{uiText('形态')}</small>{trades.filter(m=>m.time===current?.time).map(m=><span key={'trade-'+m.side} title={m.reason}>{m.label}</span>)}{hits.length?hits.map(m=><span key={m.kind} style={{color:m.direction==='bullish'?'var(--up)':m.direction==='bearish'?'var(--down)':undefined}} title={uiText(m.detail)}>{uiText(m.label)}{m.provisional?' · '+uiText('待收盘'):''}</span>):<span className="pattern-empty">—</span>}</div>;
});
const IndicatorHeading = memo(function IndicatorHeading({ hover, byTime, last, render }: LegendProps & { render: (time: string | undefined, candle: Candle | undefined) => React.ReactNode }) {
  const current = useHoverCandle(hover, byTime, last);
  return <>{render(current?.time, current)}</>;
});
const HoverChips = memo(function HoverChips({ hover, byTime, last, candles, symbol, volumeUnit, floatShares }: LegendProps & { candles: Candle[]; symbol: string; volumeUnit?: string; floatShares?: number }) {
  const current = useHoverCandle(hover, byTime, last);
  return <ChipProfile candles={candles} symbol={symbol} volumeUnit={volumeUnit} floatShares={floatShares} asOf={current?.time}/>;
});

export default function MarketChart({ candles:initialCandles, compact = false, symbol, volumeUnit, historySource, amount,amountDate,guideEvents, tradeMarkers:providedTrades=NO_TRADES,chipFloatShares, unit = 'day' }: { candles: Candle[]; compact?: boolean; symbol?: string; volumeUnit?: string;historySource?:string;amount?:number|null;amountDate?:string; unit?: string;tradeMarkers?:TradeMarker[];patternMarkers?:PatternMark[];chipFloatShares?:number; guideEvents?: GuideEvent[] }) {
  const history=useChartHistory(initialCandles,compact?undefined:symbol,unit,volumeUnit,historySource),candles=history.candles;
  const historyRef=useRef(history);historyRef.current=history;
  const browsedRef=useRef(false),identityRef=useRef(symbol+':'+unit);
  const display=usePreferences(),light=display.theme==='light';
  const chipEligible=!!symbol&&/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)&&!(/^(?:000\d{3}\.SH|399\d{3}\.SZ)$/.test(symbol));
  const [chipsOpen,setChipsOpen]=useState(false);
  const priceRef = useRef<HTMLDivElement>(null), volumeRef = useRef<HTMLDivElement>(null), macdRef = useRef<HTMLDivElement>(null), kdjRef = useRef<HTMLDivElement>(null),rsiRef=useRef<HTMLDivElement>(null);
  const chartSetRef = useRef<ChartSet | null>(null);
  const visibleRef = useRef<LogicalRange | null>(null), visibleBarsRef = useRef(30);
  const hover = useMemo(createHoverStore, []);
  // Show one month by default for daily K; keep a year for weekly/monthly K.
  const [period, setPeriod] = useState<Range>(() => unit === 'week' || unit === 'month' ? '1Y' : '1M');
  const [preferences, setPreferences] = useState<MAPreference[]>(readPreferences);
  const [draft, setDraft] = useState(() => preferences.map(p => ({ ...p, period: String(p.period) })));
  const [settingsOpen, setSettingsOpen] = useState(false), [settingsError, setSettingsError] = useState('');
  const [panels, setPanels] = useState<Record<Panel, boolean>>({ VOL: true, MACD: true, KDJ: true,RSI:false });
  const [overlay,setOverlay]=useState('MA');
  const [projectionOn,setProjectionOn]=useState(false),[projectionHorizon,setProjectionHorizon]=useState(10),[projectionScenario,setProjectionScenario]=useState('base');
  const [markers, setMarkers] = useState(true), [expanded, setExpanded] = useState(false);
  const [shapesVisible,setShapesVisible]=useState(true),[crossMarkers,setCrossMarkers]=useState(false);
  const [indicatorLabels,setIndicatorLabels]=useState(true);
  const [chartError, setChartError] = useState('');
  const projection=useMemo(()=>projectionOn?projectMarket(candles,{unit,symbol,horizon:projectionHorizon,maPeriods:preferences.filter(p=>p.enabled).map(p=>p.period)}):null,[projectionOn,projectionHorizon,candles,preferences,unit,symbol]);
  const futureCandles=useMemo(()=>projection?.available?projection.scenarios.find(s=>s.id===projectionScenario)?.candles||[]:[],[projection,projectionScenario]);
  const data = useChartData({ candles, futureCandles, preferences, symbol, unit, amount, amountDate, providedTrades, compact });
  const { indicators, projectedIndicators, extra, projectedExtra, study } = data;
  const shapes=study.patternMarks,tradeMarkers=data.tradeMarkers;
  const candleByTime = useMemo(() => new Map([...candles,...futureCandles].map(c => [c.time, c])), [candles,futureCandles]);
  const maMaps = useMemo(() => Object.fromEntries(Object.entries(projectedIndicators.ma).map(([p, values]) => [p, new Map(values.map(v => [v.time, v.value]))])) as Record<number, Map<string, number>>, [projectedIndicators]);
  const macdByTime = useMemo(() => new Map(projectedIndicators.macd.map(p => [p.time, p])), [projectedIndicators]);
  const kdjByTime = useMemo(() => new Map(projectedIndicators.kdj.map(p => [p.time, p])), [projectedIndicators]);
  const volume5 = useMemo(() => new Map(projectedIndicators.volume5.map(p => [p.time, p.value])), [projectedIndicators]);
  const volume20 = useMemo(() => new Map(projectedIndicators.volume20.map(p => [p.time, p.value])), [projectedIndicators]);
  const rsiByTime = useMemo(() => new Map(extra.rsi.map(p => [p.time, p.value])), [extra]);
  const lastCandle = candles.at(-1);
  const activePeriods = preferences.filter(p => p.enabled).map(p => p.period).sort((a, b) => a - b);

  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences));window.dispatchEvent(new Event('atlas:ma-changed')); } catch { /* storage can be disabled */ } }, [preferences]);
  useEffect(() => { visibleRef.current = null; hover.reset(); }, [symbol,unit,hover]);

  // Everything the series show; kept in a ref so the structure effect can apply the latest data after (re)building.
  const snapshot = useMemo<ChartDataSnapshot>(() => ({ candles, futureCandles, indicators, projectedIndicators, extra, projectedExtra, study, tradeMarkers, guideEvents, markers, shapesVisible, crossMarkers, indicatorLabels, period, projectionPoints: projection?.available ? projection.points.length : 0 }),
    [candles, futureCandles, indicators, projectedIndicators, extra, projectedExtra, study, tradeMarkers, guideEvents, markers, shapesVisible, crossMarkers, indicatorLabels, period, projection]);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;

  const syncingRef = useRef(false);
  const setRange = useCallback((set: ChartSet, range: LogicalRange) => {
    // Autoscale providers read this synchronously while the range is applied.
    visibleBarsRef.current = Math.max(1, range.to - range.from);
    syncingRef.current = true;
    try { for (const pane of set.panes) pane.chart.timeScale().setVisibleLogicalRange(range); } finally { syncingRef.current = false; }
  }, []);

  /** Push a data snapshot into existing series. No chart is created or removed here. */
  const applyData = useCallback((set: ChartSet, d: ChartDataSnapshot) => {
    if (set.applied === d) return;
    const bars = d.candles, last = bars.at(-1)!, userRange = visibleRef.current;
    // setData may move the time scale; those range events must not overwrite the user's view.
    syncingRef.current = true;
    try {
    const map = (points: Point[]) => new Map(points.map(p => [p.time, p.value]));
    const padded = (points: Point[]): (LineData<Time> | WhitespaceData<Time>)[] => { const values = map(points); return bars.map(c => values.has(c.time) ? { time: chartTime(c.time), value: values.get(c.time)! } : { time: chartTime(c.time) }); };
    const future = (points: Point[]) => points.filter(p => p.time >= last.time).map(p => ({ time: chartTime(p.time), value: p.value }));
    set.prices.setData(bars.map(c => ({ time: chartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    set.simulated?.setData(d.futureCandles.map(c => ({ time: chartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    for (const o of set.overlays) { o.line.setData(padded(o.pick(d, false))); o.future?.setData(d.futureCandles.length ? future(o.pick(d, true)) : []); }
    for (const pane of set.sub) { pane.apply(d); pane.markRemover?.(); pane.markRemover = undefined; pane.marks?.(d); }
    if (!compact) {
      // Narrow charts keep marker shapes but drop their text so labels do not pile onto the candles.
      const narrow = (priceRef.current?.clientWidth || 0) < 600;
      const points: SeriesMarker<Time>[] = d.crossMarkers ? d.indicators.signals.map(signal => ({
        time: chartTime(signal.time), position: signal.kind === 'death' ? 'aboveBar' : 'belowBar',
        shape: signal.kind === 'bloom' ? 'circle' : signal.kind === 'golden' ? 'arrowUp' : 'arrowDown',
        color: signal.kind === 'bloom' ? '#f6cb70' : signal.kind === 'golden' ? UP : DOWN,
        text: narrow ? '' : signal.kind === 'bloom' ? uiText('均线展开') : uiText(signal.kind==='golden'?'金叉':'死叉'), size: signal.kind === 'bloom' ? 1 : 0.7,
      })) : [];
      if (d.shapesVisible) for (const event of d.guideEvents || []) {
        points.push({ time: chartTime(event.date), position: 'belowBar', shape: 'circle', color: '#d9c89f', text: narrow ? '' : uiText('指南启动'), size: 1 });
        if (event.state === 'confirmed' && event.confirmationDate) points.push({ time: chartTime(event.confirmationDate), position: 'belowBar', shape: 'arrowUp', color: '#b6d6ca', text: narrow ? '' : uiText('开花确认'), size: 1 });
        if (event.invalidationDate) points.push({ time: chartTime(event.invalidationDate), position: 'aboveBar', shape: 'arrowDown', color: '#c99a9a', text: narrow ? '' : uiText('确认失效'), size: 1 });
      }
      if (d.markers) for (const p of d.tradeMarkers) points.push({ time: chartTime(p.time), position: p.side === 'buy' ? 'belowBar' : 'aboveBar', shape: p.side === 'buy' ? 'arrowUp' : 'arrowDown', color: p.confirmed === false ? '#cfad6e' : p.side === 'buy' ? UP : DOWN, text: uiText(p.confirmed === false ? p.label : p.side === 'buy' ? '买' : '卖'), size: 1 });
      points.sort((a, b) => timeKey(a.time).localeCompare(timeKey(b.time)));
      set.prices.setMarkers(points);
      set.annotations?.destroy();
      set.annotations = chartPatternOverlay(priceRef.current!, set.main, set.prices, bars, d.shapesVisible ? d.study.patternMarks : [], new Set(d.markers ? d.tradeMarkers.map(t => t.time) : []), light, uiText);
    }
    } finally { syncingRef.current = false; }
    // Crosshair sync reads these per pane.
    for (const pane of set.panes) pane.values = paneValues(pane.kind, d);
    // Visible range: keep the user's view; shift it when older bars were prepended; reset on symbol/period change.
    const identity = symbol + ':' + unit, before = set.appliedBars, first = bars[0]?.time;
    if (identityRef.current !== identity) { visibleRef.current = null; browsedRef.current = false; identityRef.current = identity; }
    else if (userRange && before.first && before.first !== first) {
      const shift = bars.findIndex(c => c.time === before.first);
      visibleRef.current = shift < 0 ? null : { from: userRange.from + shift, to: userRange.to + shift } as LogicalRange;
    }
    const changedShape = !set.applied || before.length !== bars.length || before.first !== first || set.applied.period !== d.period || set.applied.projectionPoints !== d.projectionPoints;
    if (changedShape || visibleRef.current) {
      const count = rangeSize(d.period as Range, bars.length, unit);
      setRange(set, visibleRef.current || { from: Math.max(-1, bars.length - count - 1), to: bars.length + d.projectionPoints + 3 } as LogicalRange);
    }
    set.applied = d; set.appliedBars = { length: bars.length, first };
    set.annotations?.update(set.main.timeScale().getVisibleLogicalRange());
  }, [compact, light, symbol, unit, setRange]);

  const maKey = preferences.map(p => p.period + ':' + p.enabled + ':' + p.color).join('|'), panelKey = (['VOL','MACD','KDJ','RSI'] as const).filter(p => panels[p]).join(','), hasFuture = futureCandles.length > 0;
  // Structure effect: create charts and empty series once per (symbol, unit, theme, panels, overlay, MA set, size).
  useEffect(() => {
    if (!priceRef.current || !candles.length) return;
    const instances: IChartApi[] = [], observers: ResizeObserver[] = [], removers: (() => void)[] = [];
    const resizeTargets: { chart: IChartApi; element: HTMLDivElement; height: number }[] = [];
    const paneHeight = (width: number, height: number) => !compact && width < 600 ? (height > 300 ? 280 : Math.round(height * 0.82)) : height;
    setChartError('');
    const visiblePanels = compact ? [] : (['VOL', 'MACD', 'KDJ','RSI'] as const).filter(p => panels[p]);
    const lastPanel = visiblePanels.at(-1);
    const grid = light ? '#e8ebef' : '#222225', guide = light ? '#d5d9df' : '#35373b';
    const makeChart = (el: HTMLDivElement, height: number, bottomAxis: boolean) => {
      const chart = createChart(el, {
        width: el.clientWidth, height: paneHeight(el.clientWidth, height),
        // The TradingView attribution is shown as a visible text link under the chart instead of an in-pane logo.
        layout: { attributionLogo: false, background: { type: ColorType.Solid, color: light?'#ffffff':'#0c0c0d' }, textColor:light?'#555e6c':'#adb1b8', fontFamily: 'Inter, Microsoft YaHei, sans-serif', fontSize: Math.round(display.rootPx*.82) },
        grid: { vertLines: { visible: false }, horzLines: { color: grid } },
        leftPriceScale: { visible: true, borderVisible: false, entireTextOnly: true, minimumWidth: compact ? 55 : 68, scaleMargins: { top: 0.12, bottom: 0.08 } },
        rightPriceScale: { visible: false },
        timeScale: { visible: bottomAxis, borderVisible: false, tickMarkFormatter:(time:Time)=>typeof time==='number'?timeKey(time).slice(11):null, timeVisible: unit.startsWith('m')&&unit!=='month', lockVisibleTimeRangeOnResize: true, rightOffset: 4, barSpacing: 9, minBarSpacing: 2, fixLeftEdge: false },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#878b92', labelBackgroundColor: '#3e4146' }, horzLine: { color: '#878b92', labelBackgroundColor: '#3e4146' } },
        handleScroll: { mouseWheel: !compact, pressedMouseMove: !compact, horzTouchDrag: !compact, vertTouchDrag: false },
        handleScale: { mouseWheel: !compact, pinch: !compact, axisPressedMouseMove: !compact },
        localization: { locale: display.locale,timeFormatter:timeKey },
      });
      instances.push(chart); resizeTargets.push({ chart, element: el, height });
      return chart;
    };
    const line = (chart: IChartApi, color: string, options: Record<string, unknown> = {}) => chart.addLineSeries({ priceScaleId: 'left', color: chartColor(color, light), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...options });
    const futureLine = (chart: IChartApi, color: string, dots = false, options: Record<string, unknown> = {}) => line(chart, color, { lineStyle: LineStyle.Dashed, lineVisible: !dots, pointMarkersVisible: dots, pointMarkersRadius: 2, ...options });
    const longAverage = (periodValue: number) => ({ autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => excludedFromAutoscale(periodValue, visibleBarsRef.current) ? null : original() });
    let set: ChartSet;
    try {
      const main = makeChart(priceRef.current, compact ? 210 : expanded ? 480 : 390, !lastPanel);
      const prices = main.addCandlestickSeries({ priceScaleId: 'left', upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceLineVisible: false, lastValueVisible: false });
      const simulated = hasFuture ? main.addCandlestickSeries({priceScaleId:'left',upColor:'#f04a5540',downColor:'#28cdb640',borderUpColor:'#f04a55aa',borderDownColor:'#28cdb6aa',wickUpColor:'#f04a55aa',wickDownColor:'#28cdb6aa',priceLineVisible:false,lastValueVisible:false}) : undefined;
      const overlays: ChartSet['overlays'] = [];
      if (!compact && overlay === 'MA') for (const ma of preferences.filter(p => p.enabled)) {
        const opts = longAverage(ma.period);
        overlays.push({ line: line(main, ma.color, opts), future: hasFuture ? futureLine(main, ma.color, false, opts) : undefined, pick: (d, f) => (f ? d.projectedIndicators : d.indicators).ma[ma.period] || [] });
      }
      if (!compact && overlay === 'BOLL') for (const [key, color] of [['mid', '#eeeeee'], ['upper', '#f7cf65'], ['lower', '#ed89bf']] as const)
        overlays.push({ line: line(main, color), future: hasFuture ? futureLine(main, color) : undefined, pick: (d, f) => (f ? d.projectedExtra : d.extra).boll.map(p => ({ time: p.time, value: p[key] })) });
      if (!compact && overlay === 'SAR') overlays.push({ line: line(main, '#f7cf65', { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 }), future: hasFuture ? futureLine(main, '#f7cf65', true) : undefined, pick: (d, f) => (f ? d.projectedExtra : d.extra).sar });
      const panes: Pane[] = [{ kind: 'MAIN', chart: main, anchor: prices, values: new Map() }];
      const sub: ChartSet['sub'] = [];
      const lookup = <T extends { time: string }>(rows: T[]) => new Map(rows.map(r => [r.time, r]));
      if (!compact && panels.VOL && volumeRef.current) {
        const chart = makeChart(volumeRef.current, 106, lastPanel === 'VOL'), el = volumeRef.current;
        chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });
        const bars = chart.addHistogramSeries({ priceScaleId: 'left', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
        const projected = hasFuture ? chart.addHistogramSeries({ priceScaleId: 'left', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }) : undefined;
        const v5 = line(chart, '#f1d55c'), v20 = line(chart, '#d968e8'), f5 = hasFuture ? futureLine(chart, '#f1d55c') : undefined, f20 = hasFuture ? futureLine(chart, '#d968e8') : undefined;
        const index = sub.length;
        sub.push({ chart, series: [bars], apply: d => {
          const last = d.candles.at(-1)!.time, pad = (points: Point[]) => { const m = new Map(points.map(p => [p.time, p.value])); return d.candles.map(c => m.has(c.time) ? { time: chartTime(c.time), value: m.get(c.time)! } : { time: chartTime(c.time) }); };
          bars.setData(d.candles.map(c => ({ time: chartTime(c.time), value: c.volume, color: c.close >= c.open ? UP : DOWN })));
          projected?.setData(d.futureCandles.map(c => ({ time: chartTime(c.time), value: c.volume, color: c.close >= c.open ? '#f04a5550' : '#28cdb650' })));
          v5.setData(pad(d.indicators.volume5)); v20.setData(pad(d.indicators.volume20));
          f5?.setData(d.projectedIndicators.volume5.filter(p => p.time >= last).map(p => ({ time: chartTime(p.time), value: p.value })));
          f20?.setData(d.projectedIndicators.volume20.filter(p => p.time >= last).map(p => ({ time: chartTime(p.time), value: p.value })));
        }, marks: d => { if (d.indicatorLabels) sub[index].markRemover = indicatorOverlay(el, chart, bars, d.study.indicatorMarks.filter(m => m.pane === 'VOL'), chartTime); } });
        panes.push({ kind: 'VOL', chart, anchor: bars, values: new Map() });
      }
      if (!compact && panels.MACD && macdRef.current) {
        const chart = makeChart(macdRef.current, 122, lastPanel === 'MACD'), el = macdRef.current;
        const bars = chart.addHistogramSeries({ priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false });
        const projected = hasFuture ? chart.addHistogramSeries({ priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false }) : undefined;
        bars.createPriceLine({ price: 0, color: light ? '#b9bec6' : '#505256', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
        const dif = line(chart, '#ebedf1'), dea = line(chart, '#f1d55c'), fdif = hasFuture ? futureLine(chart, '#ebedf1') : undefined, fdea = hasFuture ? futureLine(chart, '#f1d55c') : undefined;
        const index = sub.length;
        sub.push({ chart, series: [dif], apply: d => {
          const last = d.candles.at(-1)!.time, rows = lookup(d.projectedIndicators.macd), own = lookup(d.indicators.macd);
          bars.setData(d.candles.map(c => { const p = rows.get(c.time); return p ? { time: chartTime(c.time), value: p.histogram, color: p.histogram >= 0 ? UP : DOWN } : { time: chartTime(c.time) }; }));
          projected?.setData(d.projectedIndicators.macd.filter(p => p.time > last).map(p => ({ time: chartTime(p.time), value: p.histogram, color: p.histogram >= 0 ? '#f04a5550' : '#28cdb650' })));
          dif.setData(d.candles.map(c => { const p = own.get(c.time); return p ? { time: chartTime(c.time), value: p.dif } : { time: chartTime(c.time) }; }));
          dea.setData(d.candles.map(c => { const p = own.get(c.time); return p ? { time: chartTime(c.time), value: p.dea } : { time: chartTime(c.time) }; }));
          fdif?.setData(d.projectedIndicators.macd.filter(p => p.time >= last).map(p => ({ time: chartTime(p.time), value: p.dif })));
          fdea?.setData(d.projectedIndicators.macd.filter(p => p.time >= last).map(p => ({ time: chartTime(p.time), value: p.dea })));
        }, marks: d => { if (d.indicatorLabels) sub[index].markRemover = indicatorOverlay(el, chart, dif, d.study.indicatorMarks.filter(m => m.pane === 'MACD'), chartTime); } });
        panes.push({ kind: 'MACD', chart, anchor: dif, values: new Map() });
      }
      if (!compact && panels.KDJ && kdjRef.current) {
        const chart = makeChart(kdjRef.current, 140, lastPanel === 'KDJ'), el = kdjRef.current;
        const keep0to100 = { autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => { const base = original(); return base ? { ...base, priceRange: { minValue: Math.min(0, base.priceRange.minValue), maxValue: Math.max(100, base.priceRange.maxValue) } } : null; } };
        const lines = (['k', 'd', 'j'] as const).map((key, i) => ({ key, series: line(chart, ['#ebedf1', '#f1d55c', '#d968e8'][i], keep0to100), future: hasFuture ? futureLine(chart, ['#ebedf1', '#f1d55c', '#d968e8'][i]) : undefined }));
        for (const level of [20, 80]) lines[0].series.createPriceLine({ price: level, color: guide, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
        const index = sub.length;
        sub.push({ chart, series: [lines[0].series], apply: d => {
          const last = d.candles.at(-1)!.time, own = lookup(d.indicators.kdj);
          for (const l of lines) {
            l.series.setData(d.candles.map(c => { const p = own.get(c.time); return p ? { time: chartTime(c.time), value: p[l.key] } : { time: chartTime(c.time) }; }));
            l.future?.setData(d.projectedIndicators.kdj.filter(p => p.time >= last).map(p => ({ time: chartTime(p.time), value: p[l.key] })));
          }
        }, marks: d => { if (d.indicatorLabels) sub[index].markRemover = indicatorOverlay(el, chart, lines[0].series, d.study.indicatorMarks.filter(m => m.pane === 'KDJ'), chartTime); } });
        panes.push({ kind: 'KDJ', chart, anchor: lines[0].series, values: new Map() });
      }
      if (!compact && panels.RSI && rsiRef.current) {
        const chart = makeChart(rsiRef.current, 130, lastPanel === 'RSI'), rsiLine = line(chart, '#f7cf65'), future = hasFuture ? futureLine(chart, '#f7cf65') : undefined;
        for (const level of [30, 70]) rsiLine.createPriceLine({ price: level, color: guide, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
        sub.push({ chart, series: [rsiLine], apply: d => {
          const last = d.candles.at(-1)!.time, own = new Map(d.extra.rsi.map(p => [p.time, p.value]));
          rsiLine.setData(d.candles.map(c => own.has(c.time) ? { time: chartTime(c.time), value: own.get(c.time)! } : { time: chartTime(c.time) }));
          future?.setData(d.projectedExtra.rsi.filter(p => p.time >= last).map(p => ({ time: chartTime(p.time), value: p.value })));
        } });
        panes.push({ kind: 'RSI', chart, anchor: rsiLine, values: new Map() });
      }
      set = { main, prices, simulated, overlays, sub, panes, annotations: null, applied: null, appliedBars: { length: 0 } };
      chartSetRef.current = set;
      for (const pane of panes) {
        const onRange = (range: LogicalRange | null) => {
          if (!range || syncingRef.current) return;
          if(pane===panes[0]&&range.from<24&&browsedRef.current&&!historyRef.current.error)void historyRef.current.loadOlder();
          visibleRef.current = range; visibleBarsRef.current = Math.max(1, range.to - range.from);
          if (pane === panes[0]) set.annotations?.update(range);
          for (const target of panes) {
            if (target === pane) continue;
            const existing = target.chart.timeScale().getVisibleLogicalRange();
            if (!existing || Math.abs(existing.from - range.from) > 0.001 || Math.abs(existing.to - range.to) > 0.001) target.chart.timeScale().setVisibleLogicalRange(range);
          }
        };
        pane.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
        removers.push(() => pane.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange));
        let syncingCrosshair = false;
        const onCrosshair: Parameters<IChartApi['subscribeCrosshairMove']>[0] = param => {
          if (syncingCrosshair) return;
          syncingCrosshair = true;
          try {
            const key = param.time ? timeKey(param.time) : null;
            hover.set(key);
            for (const target of panes) {
              if (target === pane) continue;
              const value = key ? target.values.get(key) : undefined;
              if (param.time && value !== undefined) target.chart.setCrosshairPosition(value, param.time, target.anchor);
              else target.chart.clearCrosshairPosition();
            }
          } finally { syncingCrosshair = false; }
        };
        pane.chart.subscribeCrosshairMove(onCrosshair);
        removers.push(() => pane.chart.unsubscribeCrosshairMove(onCrosshair));
      }
      const observer = new ResizeObserver(() => {
        const range = visibleRef.current || panes[0]?.chart.timeScale().getVisibleLogicalRange();
        syncingRef.current = true;
        try {
          for (const target of resizeTargets) target.chart.applyOptions({ width: target.element.clientWidth, height: paneHeight(target.element.clientWidth, target.height) });
          if (range) for (const pane of panes) pane.chart.timeScale().setVisibleLogicalRange(range);
        } finally { syncingRef.current = false; }
        set.annotations?.update(range);
      });
      observer.observe(priceRef.current);
      observers.push(observer);
      applyData(set, snapshotRef.current);
    } catch (error) { setChartError(error instanceof Error ? error.message : '图表加载失败'); }
    return () => {
      const current = chartSetRef.current;
      if (current) { current.annotations?.destroy(); current.sub.forEach(s => s.markRemover?.()); }
      removers.forEach(remove => remove()); observers.forEach(observer => observer.disconnect());
      instances.forEach(chart => chart.remove()); chartSetRef.current = null;
    };
    // Data-only changes are handled by the effect below; this list is the chart *structure*.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light, display.rootPx, display.locale, compact, expanded, panelKey, overlay, maKey, unit, symbol, hasFuture, !!candles.length]);

  // Data effect: quote polls, history pages and toggles only update the existing series.
  useEffect(() => { const set = chartSetRef.current; if (set) { try { applyData(set, snapshot); } catch (error) { setChartError(error instanceof Error ? error.message : '图表加载失败'); } } }, [snapshot, applyData]);

  const closeExpanded = useCallback(() => setExpanded(false), []);
  function chooseRange(value: Range) { visibleRef.current = null; setPeriod(value); }
  function resetView() {
    const set = chartSetRef.current; if (!set) return;
    const range = { from: Math.max(-1, candles.length - rangeSize(period, candles.length, unit) - 1), to: candles.length + (projection?.available?projection.points.length:0) + 3 } as LogicalRange;
    visibleRef.current = range; setRange(set, range); set.annotations?.update(range);
  }
  function openSettings() {
    setDraft(preferences.map(p => ({ ...p, period: String(p.period) })));
    setSettingsError(''); setSettingsOpen(value => !value);
  }
  const toggleMA = useCallback((i: number) => setPreferences(old => { const next = old.map((p, n) => n === i ? { ...p, enabled: !p.enabled } : p); return validMAPreferences(next) ? next : old; }), []);
  if (!candles.length) return <div className="chart-empty">{uiText("暂无可绘制的真实 K 线")}</div>;
  const legend = { hover, byTime: candleByTime, last: lastCandle };
  const body = <div className={'terminal-chart ' + (compact ? 'terminal-compact ' : '') + (expanded ? 'terminal-expanded' : '')} onPointerDownCapture={()=>{browsedRef.current=true;}} onWheelCapture={()=>{browsedRef.current=true;}}>
    {!compact && <>
      <div className="terminal-toolbar">
        <div className="terminal-range" aria-label={uiText("图表显示范围")}>{([['1M', '1个月'], ['3M', '3个月'], ['6M', '6个月'], ['1Y', '1年'], ['ALL', '全部']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} className={period === value ? 'active' : ''} onClick={() => chooseRange(value)}>{uiText(unit.startsWith('m')&&unit!=='month'&&value!=='ALL'?({'1M':'22根','3M':'66根','6M':'132根','1Y':'264根'}[value]):label)}</button>)}</div>
        <div className="terminal-tools"><CompactSelect label={uiText('主图指标')} value={overlay} onChange={setOverlay} options={['MA','BOLL','SAR'].map(v=>({value:v,label:v}))}/><span className="terminal-frequency">{uiText(unit === 'week' ? '周 K' : unit === 'month' ? '月 K' : unit.startsWith('m')?unit.slice(1)+'分钟':'日 K')}{symbol ? ' · ' + symbol : ''}</span>
          <button type="button" aria-pressed={chipsOpen} onClick={()=>setChipsOpen(v=>!v)} disabled={unit!=='day'||!chipEligible}>{uiText("筹码峰")}</button><button type="button" onClick={openSettings} aria-expanded={settingsOpen}><Settings2 size={14} />{uiText("均线参数")}</button>
          <button type="button" onClick={resetView} aria-label={uiText("重置缩放")}><RotateCcw size={14} /></button>
          <button type="button" aria-pressed={projectionOn} onClick={()=>{visibleRef.current=null;setProjectionOn(v=>!v);}}>{uiText('行情推演')}</button>
          <button type="button" onClick={() => setExpanded(value => !value)} aria-label={uiText(expanded ? '收起图表' : '展开图表')}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        </div>
      </div>
      {history.enabled&&(history.loading||history.error)&&<div className="terminal-history" role="status"><span>{uiText(history.loading?'正在加载更早K线…':history.error)}</span>{!history.loading&&history.hasMore&&<button onClick={()=>void history.loadOlder()}>{uiText('重试')}</button>}</div>}
      {settingsOpen && <form className="terminal-settings" aria-label={uiText("均线参数设置")} onSubmit={event => {
        event.preventDefault();
        const next = draft.map(p => ({ ...p, period: Number(p.period) }));
        if (!validMAPreferences(next)) { setSettingsError('周期须为 1–500 的整数，已启用的周期不能重复。'); return; }
        setPreferences(next); setSettingsOpen(false);
      }}>
        <div className="terminal-settings-heading"><b>{uiText("自定义均线")}</b><span>{uiText("按交易日计算 · 参数保存在本机")}</span></div>
        <div className="terminal-settings-actions">{[['经典',CLASSIC_MA],['斐波那契',FIBONACCI_MA]].map(([label,periods])=><button type="button" key={String(label)} onClick={()=>setDraft(old=>old.map((p,i)=>({...p,period:String((periods as number[])[i]),enabled:true})))}>{uiText(String(label))}</button>)}</div><div className="terminal-settings-grid">{draft.map((line, i) => <div className="terminal-ma-setting" key={i}>
          <input type="checkbox" aria-label={uiText('启用第' + (i + 1) + '条均线')} checked={line.enabled} onChange={event => setDraft(old => old.map((p, n) => n === i ? { ...p, enabled: event.target.checked } : p))} />
          <label htmlFor={'ma-period-' + i}>MA</label><input id={'ma-period-' + i} aria-label={uiText('第' + (i + 1) + '条均线周期')} type="number" min="1" max="500" step="1" required value={line.period} onChange={event => setDraft(old => old.map((p, n) => n === i ? { ...p, period: event.target.value } : p))} />
          <input type="color" aria-label={uiText('第' + (i + 1) + '条均线颜色')} value={line.color} onChange={event => setDraft(old => old.map((p, n) => n === i ? { ...p, color: event.target.value } : p))} />
        </div>)}</div>
        <div className="terminal-settings-actions"><span role="alert">{uiText(settingsError)}</span><button type="button" onClick={() => setDraft(defaultMAs().map(p => ({ ...p, period: String(p.period) })))}>{uiText("恢复默认")}</button><button className="terminal-apply" type="submit">{uiText("应用参数")}</button></div>
      </form>}
      {overlay!=='MA'&&<div className="terminal-ma-legend"><b>{overlay==='BOLL'?'BOLL (20,2)':'SAR (0.02,0.2)'}</b></div>}
      <MaLegend {...legend} preferences={preferences} maMaps={maMaps} light={light} onToggle={toggleMA} hidden={overlay!=='MA'}/>
      <div className="terminal-readouts"><OhlcReadout {...legend}/><PatternReadout {...legend} trades={tradeMarkers} shapes={shapes}/></div>
    </>}
    {chartError && <div className="terminal-error" role="alert">{uiText("图表无法显示：")}{uiText(chartError)}</div>}
    {projectionOn&&<ProjectionPanel projection={projection} unit={unit} horizon={projectionHorizon} scenario={projectionScenario} onScenario={setProjectionScenario} onHorizon={n=>{visibleRef.current=null;setProjectionHorizon(n);}}/>}
    <div className="terminal-price-pane" data-testid="price-pane" ref={priceRef} aria-label={uiText("K线与可调整均线主图")}>{futureCandles.length>0&&<span className="terminal-projection-badge">{uiText("推演K线 · ")}{projection?.scenarios.find(s=>s.id===projectionScenario)?.label}{uiText(" · 指标为假设延伸")}</span>}</div>
    {!compact && chipsOpen && chipEligible && symbol && unit==='day' && <HoverChips {...legend} candles={candles} symbol={symbol} volumeUnit={volumeUnit} floatShares={chipFloatShares}/>}
    {!compact && <>
      <div className="terminal-panel-controls"><div>{(['VOL', 'MACD', 'KDJ','RSI'] as const).map(panel => <button type="button" key={panel} aria-label={uiText('显示 ' + panel)} aria-pressed={panels[panel]} className={panels[panel] ? 'active' : ''} onClick={() => setPanels(old => ({ ...old, [panel]: !old[panel] }))}>{panel}</button>)}</div><label><input type="checkbox" checked={shapesVisible} onChange={event=>setShapesVisible(event.target.checked)}/>{uiText("形态标注")}</label><label><input type="checkbox" checked={markers} onChange={event => setMarkers(event.target.checked)} />{uiText("买卖点")}</label><label><input type="checkbox" checked={crossMarkers} onChange={event=>setCrossMarkers(event.target.checked)}/>{uiText("MA交叉")}</label><label><input type="checkbox" checked={indicatorLabels} onChange={e=>setIndicatorLabels(e.target.checked)}/>{copyText('指标标注')}</label></div>
      {panels.VOL && <section className="terminal-indicator" aria-label={uiText("VOL 成交量副图")}>
        <IndicatorHeading {...legend} render={(time,current)=><div className="terminal-indicator-heading"><b>VOL <small>{volumeUnit ? '(' + uiText(volumeUnit) + ')' : ''}</small></b><span>VOLUME <em>{uiText(volumeNumber(current?.volume))}</em></span><span style={{color:chartColor('#f1d55c',light)}}>MA5 <em>{uiText(volumeNumber(time ? volume5.get(time) : undefined))}</em></span><span style={{color:chartColor('#d968e8',light)}}>MA20 <em>{uiText(volumeNumber(time ? volume20.get(time) : undefined))}</em></span></div>}/><div ref={volumeRef} data-testid="vol-pane" />
      </section>}
      {panels.MACD && <section className="terminal-indicator" aria-label={uiText("MACD 指标副图")}>
        <IndicatorHeading {...legend} render={time=>{const m=time?macdByTime.get(time):undefined;return <div className="terminal-indicator-heading"><b>MACD <small>(12,26,9)</small></b><span style={{color:chartColor('#ebedf1',light)}}>DIF <em>{number(m?.dif)}</em></span><span style={{color:chartColor('#f1d55c',light)}}>DEA <em>{number(m?.dea)}</em></span><span className={(m?.histogram ?? 0) >= 0 ? 'terminal-up' : 'terminal-down'}>MACD <em>{number(m?.histogram)}</em></span></div>;}}/><div ref={macdRef} data-testid="macd-pane" />
      </section>}
      {panels.KDJ && <section className="terminal-indicator" aria-label={uiText("KDJ 指标副图")}>
        <IndicatorHeading {...legend} render={time=>{const k=time?kdjByTime.get(time):undefined;return <div className="terminal-indicator-heading"><b>KDJ <small>(9,3,3)</small></b><span style={{color:chartColor('#ebedf1',light)}}>K <em>{number(k?.k)}</em></span><span style={{color:chartColor('#f1d55c',light)}}>D <em>{number(k?.d)}</em></span><span style={{color:chartColor('#d968e8',light)}}>J <em>{number(k?.j)}</em></span></div>;}}/><div ref={kdjRef} data-testid="kdj-pane" />
      </section>}
      {panels.RSI&&<section className="terminal-indicator" aria-label="RSI"><IndicatorHeading {...legend} render={time=><div className="terminal-indicator-heading"><b>RSI (14)</b><span>{number(time?rsiByTime.get(time):undefined)}</span></div>}/><div ref={rsiRef} data-testid="rsi-pane"/></section>}
      <div className="terminal-status" title={study.method}><span>{uiText("形态与买卖点依据当前 MA")}{activePeriods.join('/')}{uiText(" · MACD/KDJ固定参数")}</span>{study.trendRegimes.map(r=><span key={r.scale} title={r.detail} style={{color:r.direction==='up'?'var(--up)':r.direction==='down'?'var(--down)':undefined}}>{uiText('最新')} · {uiText(r.label)} · {uiText(r.direction==='up'?'上涨':r.direction==='down'?'下跌':r.direction==='range'?'震荡':'待确认')}{r.provisional?' · '+uiText('盘中'):''}</span>)}<span>{candles.length} {uiText("根K线 · 拖动平移 / 滚轮缩放")}</span>{history.enabled&&!history.loading&&!history.error&&(history.hasMore?<button type="button" className="terminal-older" title={uiText('向左查看，自动加载更早K线')} onClick={()=>void history.loadOlder()}>{uiText('加载更早')}</button>:<span>{uiText('已到数据源最早历史')}</span>)}</div>
      <details className="terminal-method"><summary>{uiText("交叉和展开标记的口径")}</summary><p>{uiText("金叉 / 死叉：已启用均线中周期最短的两条发生交叉。均线展开：已启用均线按周期从短到长多头排列、全部高于 5 根K线以前的均值、收盘高于最短均线，且 MACD 柱大于 0；仅在首次满足时标点。这里随自定义均线变化；“指南启动 / 开花确认”标记另按姚记指南固定MA5/10/20/30/60、粘合、放量穿线及后续3–5根确认计算，不随图表参数改变。MACD 柱 = 2 × (DIF − DEA)。KDJ 使用 9/3/3 递推，J 保留超出 0–100 的实际数值。")}</p></details>
    </>}
    <a className="chart-attribution" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">{uiText('图表引擎')}: TradingView Lightweight Charts™</a>
  </div>;
  // Expanded view is a real modal dialog: initial focus, focus trap, Esc to close, page scroll locked (Radix).
  // Rendered in place (no portal) so the chart containers exist when the structure effect runs.
  if (!expanded) return body;
  return <Dialog.Root open onOpenChange={open => { if (!open) closeExpanded(); }}><Dialog.Overlay className="terminal-expanded-overlay"/><Dialog.Content className="terminal-expanded-dialog" aria-describedby={undefined}><Dialog.Title className="sr-only">{uiText('展开的 K 线图表')}</Dialog.Title>{body}</Dialog.Content></Dialog.Root>;
}

/** Value each pane's crosshair should sit on for a given bar time. */
function paneValues(kind: PaneKind, d: ChartDataSnapshot): Map<string, number> {
  if (kind === 'VOL') return new Map([...d.candles, ...d.futureCandles].map(c => [c.time, c.volume]));
  if (kind === 'MACD') return new Map(d.projectedIndicators.macd.map(p => [p.time, p.dif]));
  if (kind === 'KDJ') return new Map(d.projectedIndicators.kdj.map(p => [p.time, p.k]));
  if (kind === 'RSI') return new Map(d.projectedExtra.rsi.map(p => [p.time, p.value]));
  return new Map([...d.candles, ...d.futureCandles].map(c => [c.time, c.close]));
}
