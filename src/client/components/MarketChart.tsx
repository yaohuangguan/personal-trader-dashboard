import type {TradeMarker} from '../../shared/guide-action';
import {t as uiText} from '../preferences';
import ChipProfile from './ChipProfile';
import {chartColor,usePreferences} from '../preferences';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw, Settings2 } from 'lucide-react';
import { createChart, ColorType, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi, type LogicalRange, type Time, type LineData, type WhitespaceData, type SeriesMarker, type AutoscaleInfo } from 'lightweight-charts';
import './MarketChart.css';
import type { Candle } from '../../shared/types';
import type { GuideEvent } from '../../shared/guide-analysis';
import { bollinger,rsi,parabolicSar,chartIndicators, defaultMAs, migrateMAPreferences, validMAPreferences, type MAPreference, type Point } from '../../shared/chart-indicators';

const UP = '#f04a55', DOWN = '#28cdb6';
const SETTINGS_KEY = 'atlas.chart.ma.v2';
type Range = '1M' | '3M' | '6M' | '1Y' | 'ALL';
type Panel = 'VOL' | 'MACD' | 'KDJ' | 'RSI';
const chartTime=(value:string):Time=>value.length>10?Math.floor(Date.parse(value.replace(' ','T')+':00+08:00')/1000) as Time:value as Time;
type Pane = { chart: IChartApi; anchor: ISeriesApi<'Candlestick'> | ISeriesApi<'Histogram'> | ISeriesApi<'Line'>; values: Map<string, number> };
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

export default function MarketChart({ candles, compact = false, symbol, volumeUnit, guideEvents, tradeMarkers=[], chipFloatShares, unit = 'day' }: { candles: Candle[]; compact?: boolean; symbol?: string; volumeUnit?: string; unit?: string;tradeMarkers?:TradeMarker[]; chipFloatShares?:number; guideEvents?: GuideEvent[] }) {
  const display=usePreferences(),light=display.theme==='light';
  const chipEligible=!!symbol&&/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)&&!(/^(?:000\d{3}\.SH|399\d{3}\.SZ)$/.test(symbol));
  const [chipsOpen,setChipsOpen]=useState(false);
  const priceRef = useRef<HTMLDivElement>(null), volumeRef = useRef<HTMLDivElement>(null), macdRef = useRef<HTMLDivElement>(null), kdjRef = useRef<HTMLDivElement>(null),rsiRef=useRef<HTMLDivElement>(null);
  const chartsRef = useRef<IChartApi[]>([]);
  const visibleRef = useRef<LogicalRange | null>(null);
  const [period, setPeriod] = useState<Range>('3M');
  const [preferences, setPreferences] = useState<MAPreference[]>(readPreferences);
  const [draft, setDraft] = useState(() => preferences.map(p => ({ ...p, period: String(p.period) })));
  const [settingsOpen, setSettingsOpen] = useState(false), [settingsError, setSettingsError] = useState('');
  const [panels, setPanels] = useState<Record<Panel, boolean>>({ VOL: true, MACD: true, KDJ: true,RSI:false });
  const [overlay,setOverlay]=useState('MA');
  const extra=useMemo(()=>({boll:bollinger(candles),rsi:rsi(candles),sar:parabolicSar(candles)}),[candles]);
  const [markers, setMarkers] = useState(true), [expanded, setExpanded] = useState(false);
  const [hoverTime, setHoverTime] = useState<string | null>(null), [chartError, setChartError] = useState('');
  const indicators = useMemo(() => chartIndicators(candles, preferences), [candles, preferences]);
  const candleByTime = useMemo(() => new Map(candles.map(c => [c.time, c])), [candles]);
  const maMaps = useMemo(() => Object.fromEntries(Object.entries(indicators.ma).map(([p, values]) => [p, new Map(values.map(v => [v.time, v.value]))])) as Record<number, Map<string, number>>, [indicators]);
  const macdByTime = useMemo(() => new Map(indicators.macd.map(p => [p.time, p])), [indicators]);
  const kdjByTime = useMemo(() => new Map(indicators.kdj.map(p => [p.time, p])), [indicators]);
  const volume5 = useMemo(() => new Map(indicators.volume5.map(p => [p.time, p.value])), [indicators]);
  const volume20 = useMemo(() => new Map(indicators.volume20.map(p => [p.time, p.value])), [indicators]);
  const current = (hoverTime && candleByTime.get(hoverTime)) || candles.at(-1);
  const currentMACD = current && macdByTime.get(current.time), currentKDJ = current && kdjByTime.get(current.time);
  const activePeriods = preferences.filter(p => p.enabled).map(p => p.period).sort((a, b) => a - b);
  const maxPeriod = Math.max(0, ...activePeriods);

  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences)); } catch { /* storage can be disabled */ } }, [preferences]);
  useEffect(() => { visibleRef.current = null; setHoverTime(null); }, [symbol, candles]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape); };
  }, [expanded]);

  useEffect(() => {
    if (!priceRef.current || !candles.length) return;
    const panes: Pane[] = [], instances: IChartApi[] = [], observers: ResizeObserver[] = [], removers: (() => void)[] = [];
    let syncingCrosshair = false, syncingRange = false;
    const resizeTargets: { chart: IChartApi; element: HTMLDivElement; height: number }[] = [];
    const paneHeight = (width: number, height: number) => !compact && width < 600 ? (height > 300 ? 280 : Math.round(height * 0.82)) : height;
    setChartError('');
    const visiblePanels = compact ? [] : (['VOL', 'MACD', 'KDJ','RSI'] as const).filter(p => panels[p]);
    const lastPanel = visiblePanels.at(-1);
    const makeChart = (el: HTMLDivElement, height: number, bottomAxis: boolean) => {
      const chart = createChart(el, {
        width: el.clientWidth, height: paneHeight(el.clientWidth, height),
        layout: { attributionLogo: el === priceRef.current, background: { type: ColorType.Solid, color: light?'#ffffff':'#0c0c0d' }, textColor:light?'#555e6c':'#adb1b8', fontFamily: 'Inter, Microsoft YaHei, sans-serif', fontSize: Math.round(display.fontSize*.82) },
        grid: { vertLines: { visible: false }, horzLines: { color:light?'#e8ebef':'#222225' } },
        leftPriceScale: { visible: true, borderVisible: false, entireTextOnly: true, minimumWidth: compact ? 55 : 68, scaleMargins: { top: 0.12, bottom: 0.08 } },
        rightPriceScale: { visible: false },
        timeScale: { visible: bottomAxis, borderVisible: false, tickMarkFormatter:(time:Time)=>typeof time==='number'?timeKey(time).slice(11):null, timeVisible: unit.startsWith('m')&&unit!=='month', lockVisibleTimeRangeOnResize: true, rightOffset: 4, barSpacing: 9, minBarSpacing: 2, fixLeftEdge: false },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#878b92', labelBackgroundColor: '#3e4146' }, horzLine: { color: '#878b92', labelBackgroundColor: '#3e4146' } },
        handleScroll: { mouseWheel: !compact, pressedMouseMove: !compact, horzTouchDrag: !compact, vertTouchDrag: false },
        handleScale: { mouseWheel: !compact, pinch: !compact, axisPressedMouseMove: !compact },
        localization: { locale: display.locale,timeFormatter:timeKey },
      });
      instances.push(chart);
      resizeTargets.push({ chart, element: el, height });
      return chart;
    };
    const padded = (points: Point[]): (LineData<Time> | WhitespaceData<Time>)[] => {
      const map = new Map(points.map(p => [p.time, p.value]));
      return candles.map(c => map.has(c.time) ? { time: chartTime(c.time), value: map.get(c.time)! } : { time: chartTime(c.time) });
    };
    const addLine = (chart: IChartApi, points: Point[], color: string, width: 1 | 2 = 1) => {
      const line = chart.addLineSeries({ priceScaleId: 'left', color:chartColor(color,light), lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      line.setData(padded(points));
      return line;
    };
    try {
      const main = makeChart(priceRef.current, compact ? 210 : expanded ? 480 : 390, !lastPanel);
      const prices = main.addCandlestickSeries({ priceScaleId: 'left', upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceLineVisible: false, lastValueVisible: false });
      prices.setData(candles.map(c => ({ time: chartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
      if (!compact) {
        for (const line of preferences.filter(p => p.enabled && overlay==='MA')) addLine(main, indicators.ma[line.period] || [], line.color);
        if(overlay==='BOLL')for(const [key,color] of [['mid','#eeeeee'],['upper','#f7cf65'],['lower','#ed89bf']] as const)addLine(main,extra.boll.map(p=>({time:p.time,value:p[key]})),color);
        if(overlay==='SAR'){const line=addLine(main,extra.sar,'#f7cf65');line.applyOptions({lineVisible:false,pointMarkersVisible:true,pointMarkersRadius:2});}
        if (markers) {
          const points: SeriesMarker<Time>[] = indicators.signals.map(signal => ({
            time: chartTime(signal.time), position: signal.kind === 'death' ? 'aboveBar' : 'belowBar',
            shape: signal.kind === 'bloom' ? 'circle' : signal.kind === 'golden' ? 'arrowUp' : 'arrowDown',
            color: signal.kind === 'bloom' ? '#f6cb70' : signal.kind === 'golden' ? UP : DOWN,
            text: signal.kind === 'bloom' ? uiText('均线展开') : '', size: signal.kind === 'bloom' ? 1 : 0.7,
          }));
          for (const event of guideEvents || []) {
            points.push({ time: chartTime(event.date), position: 'belowBar', shape: 'circle', color: '#d9c89f', text: uiText('指南启动'), size: 1 });
            if (event.state === 'confirmed' && event.confirmationDate) points.push({ time: chartTime(event.confirmationDate), position: 'belowBar', shape: 'arrowUp', color: '#b6d6ca', text: uiText('开花确认'), size: 1 });
            if (event.invalidationDate) points.push({ time: chartTime(event.invalidationDate), position: 'aboveBar', shape: 'arrowDown', color: '#c99a9a', text: uiText('确认失效'), size: 1 });
          }
          points.sort((a, b) => String(a.time).localeCompare(String(b.time)));
          for(const p of tradeMarkers)points.push({time:chartTime(p.time),position:p.side==='buy'?'belowBar':'aboveBar',shape:p.side==='buy'?'arrowUp':'arrowDown',color:p.side==='buy'?UP:DOWN,text:p.label,size:1});
          points.sort((a,b)=>timeKey(a.time).localeCompare(timeKey(b.time)));
          prices.setMarkers(points);
        }
      }
      panes.push({ chart: main, anchor: prices, values: new Map(candles.map(c => [c.time, c.close])) });
      if (!compact && panels.VOL && volumeRef.current) {
        const chart = makeChart(volumeRef.current, 106, lastPanel === 'VOL');
        chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });
        const bars = chart.addHistogramSeries({ priceScaleId: 'left', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
        bars.setData(candles.map(c => ({ time: chartTime(c.time), value: c.volume, color: c.close >= c.open ? UP : DOWN })));
        addLine(chart, indicators.volume5, '#f1d55c'); addLine(chart, indicators.volume20, '#d968e8');
        panes.push({ chart, anchor: bars, values: new Map(candles.map(c => [c.time, c.volume])) });
      }
      if (!compact && panels.MACD && macdRef.current) {
        const chart = makeChart(macdRef.current, 122, lastPanel === 'MACD');
        const bars = chart.addHistogramSeries({ priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false });
        const lookup = new Map(indicators.macd.map(p => [p.time, p]));
        bars.setData(candles.map(c => {
          const p = lookup.get(c.time);
          return p ? { time: chartTime(c.time), value: p.histogram, color: p.histogram >= 0 ? UP : DOWN } : { time: chartTime(c.time) };
        }));
        bars.createPriceLine({ price: 0, color: '#505256', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
        const line = addLine(chart, indicators.macd.map(p => ({ time: p.time, value: p.dif })), '#ebedf1');
        addLine(chart, indicators.macd.map(p => ({ time: p.time, value: p.dea })), '#f1d55c');
        panes.push({ chart, anchor: line, values: new Map(indicators.macd.map(p => [p.time, p.dif])) });
      }
      if (!compact && panels.KDJ && kdjRef.current) {
        const chart = makeChart(kdjRef.current, 140, lastPanel === 'KDJ');
        const lines = (['k', 'd', 'j'] as const).map((key, i) => {
          const line = addLine(chart, indicators.kdj.map(p => ({ time: p.time, value: p[key] })), ['#ebedf1', '#f1d55c', '#d968e8'][i]);
          line.applyOptions({ autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
            const base = original();
            return base ? { ...base, priceRange: { minValue: Math.min(0, base.priceRange.minValue), maxValue: Math.max(100, base.priceRange.maxValue) } } : null;
          } });
          return line;
        });
        for (const level of [20, 80]) lines[0].createPriceLine({ price: level, color: '#35373b', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
        panes.push({ chart, anchor: lines[0], values: new Map(indicators.kdj.map(p => [p.time, p.k])) });
      }
      if(!compact&&panels.RSI&&rsiRef.current){const chart=makeChart(rsiRef.current,130,lastPanel==='RSI'),line=addLine(chart,extra.rsi,'#f7cf65');for(const level of [30,70])line.createPriceLine({price:level,color:'#35373b',lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:false});panes.push({chart,anchor:line,values:new Map(extra.rsi.map(p=>[p.time,p.value]))});}
      const count = rangeSize(period, candles.length, unit);
      const initial = visibleRef.current || { from: Math.max(-1, candles.length - count - 1), to: candles.length + 3 };
      for (const pane of panes) pane.chart.timeScale().setVisibleLogicalRange(initial);
      for (const pane of panes) {
        const onRange = (range: LogicalRange | null) => {
          if (!range || syncingRange) return;
          visibleRef.current = range;
          for (const target of panes) {
            if (target === pane) continue;
            const existing = target.chart.timeScale().getVisibleLogicalRange();
            if (!existing || Math.abs(existing.from - range.from) > 0.001 || Math.abs(existing.to - range.to) > 0.001) target.chart.timeScale().setVisibleLogicalRange(range);
          }
        };
        pane.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
        removers.push(() => pane.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange));
        const onCrosshair: Parameters<IChartApi['subscribeCrosshairMove']>[0] = param => {
          if (syncingCrosshair) return;
          syncingCrosshair = true;
          try {
            const key = param.time ? timeKey(param.time) : null;
            setHoverTime(key);
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
        syncingRange = true;
        try {
          for (const target of resizeTargets) target.chart.applyOptions({ width: target.element.clientWidth, height: paneHeight(target.element.clientWidth, target.height) });
          if (range) for (const pane of panes) pane.chart.timeScale().setVisibleLogicalRange(range);
        } finally { syncingRange = false; }
      });
      observer.observe(priceRef.current);
      observers.push(observer);
      chartsRef.current = instances;
    } catch (error) { setChartError(error instanceof Error ? error.message : '图表加载失败'); }
    return () => {
      removers.forEach(remove => remove()); observers.forEach(observer => observer.disconnect());
      instances.forEach(chart => chart.remove()); chartsRef.current = [];
    };
  }, [display, candles, compact, expanded, indicators, markers, panels, period, preferences, unit, guideEvents,overlay,extra,tradeMarkers]);

  function chooseRange(value: Range) { visibleRef.current = null; setPeriod(value); }
  function resetView() {
    const range = { from: Math.max(-1, candles.length - rangeSize(period, candles.length, unit) - 1), to: candles.length + 3 };
    visibleRef.current = range as LogicalRange;
    chartsRef.current.forEach(chart => chart.timeScale().setVisibleLogicalRange(range));
  }
  function openSettings() {
    setDraft(preferences.map(p => ({ ...p, period: String(p.period) })));
    setSettingsError(''); setSettingsOpen(value => !value);
  }
  if (!candles.length) return <div className="chart-empty">{uiText("暂无可绘制的真实 K 线")}</div>;
  return <div className={'terminal-chart ' + (compact ? 'terminal-compact ' : '') + (expanded ? 'terminal-expanded' : '')} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={uiText(expanded ? '展开的 K 线图表' : undefined)}>
    {uiText(!compact && <>
      <div className="terminal-toolbar">
        <div className="terminal-range" aria-label={uiText("图表显示范围")}>{uiText(([['1M', '1个月'], ['3M', '3个月'], ['6M', '6个月'], ['1Y', '1年'], ['ALL', '全部']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} className={period === value ? 'active' : ''} onClick={() => chooseRange(value)}>{uiText(unit.startsWith('m')&&unit!=='month'&&value!=='ALL'?({'1M':'22根','3M':'66根','6M':'132根','1Y':'264根'}[value]):label)}</button>))}</div>
        <div className="terminal-tools"><select aria-label={uiText("主图指标")} value={overlay} onChange={e=>setOverlay(e.target.value)}>{['MA','BOLL','SAR'].map(v=><option key={v}>{v}</option>)}</select><span className="terminal-frequency">{uiText(unit === 'week' ? '周 K' : unit === 'month' ? '月 K' : unit.startsWith('m')?unit.slice(1)+'分钟':'日 K')}{uiText(symbol ? ' · ' + symbol : '')}</span>
          <button type="button" aria-pressed={chipsOpen} onClick={()=>setChipsOpen(v=>!v)} disabled={unit!=='day'||!chipEligible}>{uiText("筹码峰")}</button><button type="button" onClick={openSettings} aria-expanded={settingsOpen}><Settings2 size={14} />{uiText("均线参数")}</button>
          <button type="button" onClick={resetView} aria-label={uiText("重置缩放")}><RotateCcw size={14} /></button>
          <button type="button" onClick={() => setExpanded(value => !value)} aria-label={uiText(expanded ? '收起图表' : '展开图表')}>{uiText(expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />)}</button>
        </div>
      </div>
      {uiText(settingsOpen && <form className="terminal-settings" aria-label={uiText("均线参数设置")} onSubmit={event => {
        event.preventDefault();
        const next = draft.map(p => ({ ...p, period: Number(p.period) }));
        if (!validMAPreferences(next)) { setSettingsError('周期须为 1–500 的整数，已启用的周期不能重复。'); return; }
        setPreferences(next); setSettingsOpen(false);
      }}>
        <div className="terminal-settings-heading"><b>{uiText("自定义均线")}</b><span>{uiText("按交易日计算 · 参数保存在本机")}</span></div>
        <div className="terminal-settings-grid">{uiText(draft.map((line, i) => <div className="terminal-ma-setting" key={i}>
          <input type="checkbox" aria-label={uiText('启用第' + (i + 1) + '条均线')} checked={line.enabled} onChange={event => setDraft(old => old.map((p, n) => n === i ? { ...p, enabled: event.target.checked } : p))} />
          <label htmlFor={'ma-period-' + i}>MA</label><input id={'ma-period-' + i} aria-label={uiText('第' + (i + 1) + '条均线周期')} type="number" min="1" max="500" step="1" required value={line.period} onChange={event => setDraft(old => old.map((p, n) => n === i ? { ...p, period: event.target.value } : p))} />
          <input type="color" aria-label={uiText('第' + (i + 1) + '条均线颜色')} value={line.color} onChange={event => setDraft(old => old.map((p, n) => n === i ? { ...p, color: event.target.value } : p))} />
        </div>))}</div>
        <div className="terminal-settings-actions"><span role="alert">{uiText(settingsError)}</span><button type="button" onClick={() => setDraft(defaultMAs().map(p => ({ ...p, period: String(p.period) })))}>{uiText("恢复默认")}</button><button className="terminal-apply" type="submit">{uiText("应用参数")}</button></div>
      </form>)}
      {overlay!=='MA'&&<div className="terminal-ma-legend"><b>{overlay==='BOLL'?'BOLL (20,2)':'SAR (0.02,0.2)'}</b></div>}<div style={{display:overlay==='MA'?undefined:'none'}} className="terminal-ma-legend" aria-label={uiText("均线数值")}>{uiText(preferences.map((line, i) => <button type="button" key={i} aria-label={uiText((line.enabled ? '隐藏' : '显示') + ' MA' + line.period)} aria-pressed={line.enabled} style={{ color: chartColor(line.color,light) }} className={line.enabled ? '' : 'is-hidden'} onClick={() => setPreferences(old => {
        const next = old.map((p, n) => n === i ? { ...p, enabled: !p.enabled } : p);
        return validMAPreferences(next) ? next : old;
      })}><i style={{ background: line.color }} /><span>MA{uiText(line.period)}</span><b>{uiText(line.enabled && current ? number(maMaps[line.period]?.get(current.time)) : '—')}</b></button>))}</div>
      <div className="terminal-ohlc" aria-live="off"><strong>{uiText(current?.time)}</strong>{uiText(current && <><span>{uiText("开")}<b>{uiText(number(current.open))}</b></span><span>{uiText("高")}<b className="terminal-up">{uiText(number(current.high))}</b></span><span>{uiText("低")}<b className="terminal-down">{uiText(number(current.low))}</b></span><span>{uiText("收")}<b className={current.close >= current.open ? 'terminal-up' : 'terminal-down'}>{uiText(number(current.close))}</b></span></>)}</div>
    </>)}
    {uiText(chartError && <div className="terminal-error" role="alert">{uiText("图表无法显示：")}{uiText(chartError)}</div>)}
    <div className="terminal-price-pane" data-testid="price-pane" ref={priceRef} aria-label={uiText("K线与可调整均线主图")} />
    {uiText(!compact && chipsOpen && chipEligible && symbol && unit==='day' && <ChipProfile candles={candles} symbol={symbol} volumeUnit={volumeUnit} floatShares={chipFloatShares} asOf={current?.time}/>)}
    {uiText(!compact && <>
      <div className="terminal-panel-controls"><div>{uiText((['VOL', 'MACD', 'KDJ','RSI'] as const).map(panel => <button type="button" key={panel} aria-label={uiText('显示 ' + panel)} aria-pressed={panels[panel]} className={panels[panel] ? 'active' : ''} onClick={() => setPanels(old => ({ ...old, [panel]: !old[panel] }))}>{uiText(panel)}</button>))}</div><label><input type="checkbox" checked={markers} onChange={event => setMarkers(event.target.checked)} />{uiText("交叉 / 展开标记")}</label></div>
      {uiText(panels.VOL && <section className="terminal-indicator" aria-label={uiText("VOL 成交量副图")}>
        <div className="terminal-indicator-heading"><b>VOL <small>{uiText(volumeUnit ? '(' + volumeUnit + ')' : '')}</small></b><span>VOLUME <em>{uiText(volumeNumber(current?.volume))}</em></span><span style={{color:chartColor('#f1d55c',light)}}>MA5 <em>{uiText(volumeNumber(current && volume5.get(current.time)))}</em></span><span style={{color:chartColor('#d968e8',light)}}>MA20 <em>{uiText(volumeNumber(current && volume20.get(current.time)))}</em></span></div><div ref={volumeRef} data-testid="vol-pane" />
      </section>)}
      {uiText(panels.MACD && <section className="terminal-indicator" aria-label={uiText("MACD 指标副图")}>
        <div className="terminal-indicator-heading"><b>MACD <small>(12,26,9)</small></b><span style={{color:chartColor('#ebedf1',light)}}>DIF <em>{uiText(number(currentMACD?.dif))}</em></span><span style={{color:chartColor('#f1d55c',light)}}>DEA <em>{uiText(number(currentMACD?.dea))}</em></span><span className={(currentMACD?.histogram ?? 0) >= 0 ? 'terminal-up' : 'terminal-down'}>MACD <em>{uiText(number(currentMACD?.histogram))}</em></span></div><div ref={macdRef} data-testid="macd-pane" />
      </section>)}
      {uiText(panels.KDJ && <section className="terminal-indicator" aria-label={uiText("KDJ 指标副图")}>
        <div className="terminal-indicator-heading"><b>KDJ <small>(9,3,3)</small></b><span style={{color:chartColor('#ebedf1',light)}}>K <em>{uiText(number(currentKDJ?.k))}</em></span><span style={{color:chartColor('#f1d55c',light)}}>D <em>{uiText(number(currentKDJ?.d))}</em></span><span style={{color:chartColor('#d968e8',light)}}>J <em>{uiText(number(currentKDJ?.j))}</em></span></div><div ref={kdjRef} data-testid="kdj-pane" />
      </section>)}
      {panels.RSI&&<section className="terminal-indicator" aria-label="RSI"><div className="terminal-indicator-heading"><b>RSI (14)</b><span>{number(extra.rsi.find(p=>p.time===current?.time)?.value)}</span></div><div ref={rsiRef} data-testid="rsi-pane"/></section>}
      <div className="terminal-status"><span className={indicators.expanded ? 'terminal-bloom' : ''}><i />{uiText(activePeriods.length < 2 ? '启用至少两条均线以观察展开' : candles.length < maxPeriod + 5 ? '长均线预热中 · 展开观察需 ' + (maxPeriod + 5) + ' 根K线' : indicators.expanded ? '均线多头展开' : '均线结构观察中')}</span><span>{uiText(candles.length)} {uiText("根K线 · 拖动平移 / 滚轮缩放")}</span></div>
      <details className="terminal-method"><summary>{uiText("交叉和展开标记的口径")}</summary><p>{uiText("金叉 / 死叉：已启用均线中周期最短的两条发生交叉。均线展开：已启用均线按周期从短到长多头排列、全部高于 5 根K线以前的均值、收盘高于最短均线，且 MACD 柱大于 0；仅在首次满足时标点。这里随自定义均线变化；“指南启动 / 开花确认”标记另按姚记指南固定MA5/10/20/30/60、粘合、放量穿线及后续3–5根确认计算，不随图表参数改变。MACD 柱 = 2 × (DIF − DEA)。KDJ 使用 9/3/3 递推，J 保留超出 0–100 的实际数值。")}</p></details>
    </>)}
  </div>;
}
