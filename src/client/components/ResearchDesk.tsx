import {patchSession} from '../../shared/patch-session';
import {migrateMAPreferences} from '../../shared/chart-indicators';
import ResizeRail,{usePanelWidth} from './ResizeRail';
import type {CSSProperties} from 'react';
import StockSnapshot from './StockSnapshot';
import LiveAlerts from './LiveAlerts';
import {reviewedPatternMarks} from '../../shared/pattern-marks';
import {splitLiveAlerts} from '../../shared/live-alerts';
import {analyzeStrategy} from '../../shared/strategy';
import type {DecisionPayload} from '../../shared/trade-review';
import WatchInsight from './WatchInsight';
import Level2Panel from './Level2Panel';
import {stockCharacter} from '../../shared/stock-character';
import F10Panel from './F10Panel';
import DailyTrendPanel from './DailyTrendPanel';
import FlowPanel from './FlowPanel';
import {t as uiText} from '../preferences';
import { useEffect, useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, Bell, Check, ChevronRight, CircleHelp, Globe2, Layers3, LoaderCircle, Pause, Play, Plus, Radio, RefreshCw, Search, Star, Trash2, X } from 'lucide-react';
import MarketChart from './MarketChart';
import IntradayChart from './IntradayChart';
import TradingViewWidget from './TradingViewWidget';
import { StockResearchExtras } from './IntelPanels';
import { useReader } from './InAppReader';
import { useLiveEndpoint } from '../hooks/useLiveEndpoint';
import { CATALOG } from '../../shared/catalog';
import { analyzeGuide } from '../../shared/guide-analysis';
import SectorOutlook from './SectorOutlook';
import GuidePanel, { GuideSummary } from './GuidePanel';
import { evaluateWatchRules, type QuotesPayload, type Snapshot, type IntradayPayload, type TickPayload, type SectorsPayload, type PeersPayload, type SectorRanks, type FlashPayload, type ReportsPayload, type WatchRule, type Sector } from '../../shared/desk-types';
import type { Candle, MarketPayload, NewsItem } from '../../shared/types';
import './ResearchDesk.css';

const INDEXES = ['000001.SH', '399001.SZ', '399006.SZ', '000300.SH', '000688.SH'];
const number = (v: number | null | undefined, digits = 2) => v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (v: number | null | undefined) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const tone = (v: number | null | undefined) => v == null || v === 0 ? '' : v > 0 ? 'is-up' : 'is-down';
const amount = (v: number | null | undefined) => v == null ? '—' : Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + '亿' : Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(2) + '万' : number(v, 0);
const clock = (v: string | null | undefined) => !v || !Number.isFinite(Date.parse(v)) ? '—' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v));
const dateClock = (v: string | null | undefined) => !v || !Number.isFinite(Date.parse(v)) ? '—' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v));

function Hint({ text }: { text: string }) {
  return <Tooltip.Root><Tooltip.Trigger asChild><button type="button" className="desk-help" aria-label={uiText(text)}><CircleHelp size={13} /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="desk-tooltip" sideOffset={7}>{uiText(text)}<Tooltip.Arrow /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}
function Empty({ text = '数据暂不可用', loading = false }: { text?: string; loading?: boolean }) {
  return <div className="desk-empty">{uiText(loading && <LoaderCircle size={16} className="spin" />)}<span>{uiText(loading ? '正在连接数据源…' : text)}</span></div>;
}
function Source({ text, error }: { text: string; error?: string }) { return <div className={'desk-source ' + (error ? 'has-warning' : '')}>{uiText(error || text)}</div>; }
function NewsFeed({ items, compact = false, loading, error }: { items: NewsItem[]; compact?: boolean; loading?: boolean; error?: string }) {
  const { openNews } = useReader();
  if (!items.length) return <Empty loading={loading} text={uiText(error || '当前范围内暂无来源资讯')} />;
  return <div className={'desk-news-list ' + (compact ? 'is-compact' : '')}>{uiText(items.map((item, i) => <button type="button" className="desk-news-item" key={item.id + '-' + i} onClick={() => openNews(item)}>
    <time>{uiText(clock(item.publishedAt))}</time><div><span className="desk-news-title">{(item.title)}</span>{uiText(!compact && item.summary && <p>{(item.summary)}</p>)}<small>{uiText(item.source)} <span>· {uiText(dateClock(item.publishedAt))}</span></small></div>
  </button>))}</div>;
}
export function FlashNewsDesk() {
  const [quoteWidth,setQuoteWidth]=usePanelWidth('atlas.quote-width.v1',380,280,600);
  const [auto, setAuto] = useState(true), [filter, setFilter] = useState('all');
  const feed = useLiveEndpoint<FlashPayload>('/api/desk/flash', 60000, auto);
  const items = (feed.data?.items || []).filter(item => filter === 'all' || (filter === 'important' ? item.important : item.source === filter));
  return <div className="research-desk desk-news-page"><header><div><span>MARKET NEWSROOM</span><h1>{uiText("7×24 财经快讯")}</h1><p>{uiText("财联社与华尔街见闻 · 来源摘要 · 北京时间")}</p></div><div className="desk-live-actions"><span>{uiText(auto ? '每60秒更新' : '已暂停自动更新')} · {uiText(clock(feed.data?.fetchedAt))}</span><button type="button" onClick={() => setAuto(value => !value)}>{uiText(auto ? <Pause size={13} /> : <Play size={13} />)}{uiText(auto ? '暂停' : '恢复')}</button><button type="button" aria-label={uiText("刷新财经快讯")} onClick={feed.refresh}><RefreshCw size={14} /></button></div></header><section className="desk-context" id="stock-context"><Tabs.Root value={filter} onValueChange={setFilter}><Tabs.List className="desk-tabs desk-context-tabs" aria-label={uiText("快讯来源筛选")}>{uiText([['all', '全部快讯'], ['important', '重要'], ['财联社', '财联社'], ['华尔街见闻', '华尔街见闻']].map(([value, label]) => <Tabs.Trigger key={value} value={value}>{uiText(label)}</Tabs.Trigger>))}</Tabs.List></Tabs.Root><NewsFeed items={items} loading={feed.loading} error={uiText(feed.error)} /><Source text={uiText((feed.data?.sources.join(' / ') || '正在连接快讯源') + ' · ' + items.length + '条')} error={uiText(feed.error || feed.data?.warnings.join('；'))} /></section></div>;
}
function Book({ quote, loading, error }: { quote?: Snapshot; loading: boolean; error: string }) {
  if (!quote) return <Empty loading={loading} text={uiText(error || '此市场暂未接入五档盘口')} />;
  const max = Math.max(1, ...[...quote.asks, ...quote.bids].map(l => l.volume || 0));
  const buy = quote.bids.reduce((n, l) => n + (l.volume || 0), 0), sell = quote.asks.reduce((n, l) => n + (l.volume || 0), 0);
  return <><div className="desk-book-head"><span>{uiText("档位")}</span><span>{uiText("价格")}</span><span>{uiText("数量")}</span></div><div className="desk-book-rows">
    {uiText([...quote.asks].map((level, i) => ({ ...level, rank: i + 1 })).reverse().map(level => <div key={'ask' + level.rank} className="desk-book-row"><span>{uiText("卖")}{uiText(level.rank)}</span><b className={tone((level.price ?? quote.previous) - quote.previous)}>{uiText(number(level.price))}</b><span className="desk-book-volume"><i className="ask-depth" style={{ width: ((level.volume || 0) / max * 100) + '%' }} />{uiText(number(level.volume, 0))}</span></div>))}
    <div className="desk-book-mid"><b className={tone(quote.changePercent)}>{uiText(number(quote.price))}</b><span className={tone(quote.changePercent)}>{uiText(pct(quote.changePercent))}</span><small>{uiText(clock(quote.asOf))}</small></div>
    {uiText(quote.bids.map((level, i) => <div key={'bid' + i} className="desk-book-row"><span>{uiText("买")}{uiText(i + 1)}</span><b className={tone((level.price ?? quote.previous) - quote.previous)}>{uiText(number(level.price))}</b><span className="desk-book-volume"><i className="bid-depth" style={{ width: ((level.volume || 0) / max * 100) + '%' }} />{uiText(number(level.volume, 0))}</span></div>))}
  </div><div className="desk-order-ratio"><span>{uiText("买盘挂单")}{uiText(buy + sell ? (buy / (buy + sell) * 100).toFixed(1) : '—')}%</span><div><i style={{ width: (buy + sell ? buy / (buy + sell) * 100 : 50) + '%' }} /></div><span>{uiText("卖盘")}</span></div><Source text={uiText('公开五档快照 · 数量使用来源单位 · ' + dateClock(quote.asOf))} error={uiText(error ? '刷新失败，保留上一快照' : undefined)} /></>;
}
function readRules(): WatchRule[] {
  try {
    const stored = JSON.parse(localStorage.getItem('atlas.price-alerts.v1') || '[]');
    return Array.isArray(stored) ? stored.filter(r => typeof r.id === 'string' && /^\d{6}\.(SH|SZ|BJ)$/.test(r.symbol) && ['above', 'below'].includes(r.direction) && Number.isFinite(r.value) && r.value > 0).slice(0, 30) : [];
  } catch { return []; }
}

type Props = { symbol: string; market?: MarketPayload; marketError?: string; markets: Record<string, MarketPayload>; watchlist: string[]; onSelect: (symbol: string) => void; onToggleWatch: (symbol: string) => void; onSearch: () => void; onRefresh: () => void };
export default function ResearchDesk({ symbol, market:baseMarket, marketError, markets, watchlist, onSelect, onToggleWatch, onSearch, onRefresh }: Props) {
  const [quoteWidth,setQuoteWidth]=usePanelWidth('atlas.quote-width.v1',380,280,600);
  const [auto, setAuto] = useState(true), [chartMode, setChartMode] = useState('daily'), [contextTab, setContextTab] = useState('chart'), [bookTab, setBookTab] = useState('book');
  const [watchFilter, setWatchFilter] = useState('all'), [sectorCode, setSectorCode] = useState('');
  const [externalSector, setExternalSector] = useState<Sector | null>(null);
  const [rules, setRules] = useState<WatchRule[]>(readRules), [alertOpen, setAlertOpen] = useState(false), [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above'), [alertValue, setAlertValue] = useState(''), [alertMessage, setAlertMessage] = useState('');
  const chinese = /^\d{6}\.(SH|SZ|BJ)$/.test(symbol);
  const readMA=()=>{try{return migrateMAPreferences(JSON.parse(localStorage.getItem('atlas.chart.ma.v2')||'null')).filter(p=>p.enabled).map(p=>p.period).join(',');}catch{return '5,13,20,30,60,120,144,250';}};
  const [maKey,setMaKey]=useState(readMA);useEffect(()=>{const read=()=>setMaKey(readMA());window.addEventListener('atlas:ma-changed',read);return()=>window.removeEventListener('atlas:ma-changed',read);},[]);
  const decision=useLiveEndpoint<DecisionPayload>(chinese?'/api/analysis?symbol='+symbol+'&review=1&ma='+maKey:null,60000,auto);
  const historyMarket=decision.data?.market||baseMarket;
  const symbols = useMemo(() => [...new Set([symbol, ...INDEXES, ...watchlist, ...rules.filter(r => !r.firedAt).map(r => r.symbol)].filter(s => /^\d{6}\.(SH|SZ|BJ)$/.test(s)))].slice(0, 60).sort().join(','), [symbol, watchlist, rules]);
  const quotes = useLiveEndpoint<QuotesPayload>('/api/desk/quotes?symbols=' + symbols, 5000, auto);
  const quoteMap = useMemo(() => new Map(quotes.data?.items.map(q => [q.symbol, q]) || []), [quotes.data]);
  const quote = quoteMap.get(symbol);
  const market=useMemo(()=>{if(!historyMarket||!quote)return historyMarket;const unit=historyMarket.provider.includes('新浪')||/^68[89]/.test(symbol)?'股':'手';const update=patchSession(historyMarket,quote,unit);return update?{...historyMarket,candles:update.candles}:historyMarket;},[historyMarket,quote,symbol]);
  const dayData = useLiveEndpoint<IntradayPayload>(chinese && contextTab === 'chart' && chartMode === 'intraday' ? '/api/desk/intraday?symbol=' + symbol : null, 15000, auto);
  const periodData = useLiveEndpoint<{candles:Candle[];source:string;volumeUnit?:string;notice?:string}>(chinese && contextTab === 'chart' && ['week','month','m5','m15','m30','m60','m120'].includes(chartMode) ? '/api/desk/history?symbol=' + symbol + '&period=' + chartMode : null);
  const guideWeekly = useLiveEndpoint<{candles:Candle[];source:string;volumeUnit?:string;notice?:string}>(chinese && contextTab === 'guide' ? '/api/desk/history?symbol=' + symbol + '&period=week' : null);
  const guideMonthly = useLiveEndpoint<{candles:Candle[];source:string;volumeUnit?:string;notice?:string}>(chinese && contextTab === 'guide' ? '/api/desk/history?symbol=' + symbol + '&period=month' : null);
  const tickData = useLiveEndpoint<TickPayload>(chinese && bookTab === 'ticks' ? '/api/desk/ticks?symbol=' + symbol : null, 15000, auto);
  const boardData = useLiveEndpoint<SectorsPayload>(chinese ? '/api/desk/sectors?symbol=' + symbol : null, 300000);
  const boards = boardData.data?.boards || [];
  const chosenBoard = externalSector || boards.find(b => b.code === sectorCode) || boards[0];
  const peerData = useLiveEndpoint<PeersPayload>(contextTab === 'sectors' && chosenBoard ? '/api/desk/peers?code=' + encodeURIComponent(chosenBoard.code) + '&name=' + encodeURIComponent(chosenBoard.name) : null, 60000, auto);
  const rankData = useLiveEndpoint<SectorRanks>(contextTab === 'sectors' ? '/api/desk/ranks' : null, 120000, auto);
  const conceptData=useLiveEndpoint<{items:Sector[]}>(contextTab==='sectors'?'/api/desk/sector-map?type=concept':null,300000,auto);
  const flash = useLiveEndpoint<FlashPayload>('/api/desk/flash', 60000, auto);
  const companyNews = useLiveEndpoint<FlashPayload>(chinese && contextTab === 'news' ? '/api/desk/stock-news?symbol=' + symbol : null, 180000, auto);
  const reportData = useLiveEndpoint<ReportsPayload>(chinese && contextTab === 'reports' ? '/api/desk/reports?symbol=' + symbol : null);
  const analysis = useMemo(() => market ? (() => {const result = analyzeGuide(market.candles);if(market.provider.includes('不复权')) result.warnings.push('当前历史不复权，送转与除权可能改变均线形态，需复核。');return result;})() : null, [market]);
  const character=useMemo(()=>analysis?.asOf&&market?stockCharacter(market.candles,analysis.asOf):null,[analysis,market]);
  const strategy=useMemo(()=>decision.data?.strategy||(market?analyzeStrategy(market.candles,{symbol}):null),[decision.data,market,symbol]);
  const tradeMarkers=strategy?.signals||[];
  const liveAlerts=useMemo(()=>market&&strategy?splitLiveAlerts(reviewedPatternMarks(market.candles,strategy,new Date(),{symbol,maPeriods:strategy.plan.maPeriods}),[...strategy.signals,...strategy.alerts]).liveAlerts:[],[market,strategy,symbol]);
  const known = CATALOG.find(item => item.symbol === symbol), name = quote?.name || market?.name || known?.name || symbol;
  const price = quote?.price ?? market?.last, change = quote?.changePercent ?? market?.changePercent;
  const benchmark = quoteMap.get('000300.SH');
  const relativeStrength = quote && benchmark && quote.asOf.slice(0, 10) === benchmark.asOf.slice(0, 10) && quote.changePercent !== null && benchmark.changePercent !== null ? quote.changePercent - benchmark.changePercent : null;
  const { openNews } = useReader();
  useEffect(() => { setSectorCode(''); setExternalSector(null); setAlertValue(''); }, [symbol]);
  useEffect(() => { try { localStorage.setItem('atlas.price-alerts.v1', JSON.stringify(rules)); } catch { /* browser storage disabled */ } }, [rules]);
  useEffect(() => {
    if (!auto || quotes.error) return;
    const fired = evaluateWatchRules(rules, quotes.data?.items || []);
    if (!fired.length) return;
    setRules(old => old.map(r => fired.some(f => f.id === r.id) ? { ...r, firedAt: new Date().toISOString() } : r));
    setAlertMessage(fired.map(r => r.symbol + ' 已' + (r.direction === 'above' ? '达到 ' : '低于 ') + r.value.toFixed(2)).join('；'));
  }, [quotes.data, quotes.error, rules, auto]);
  const refresh = () => { quotes.refresh(); dayData.refresh(); flash.refresh(); decision.refresh(); onRefresh(); };
  const sourceDate = quote?.asOf ? dateClock(quote.asOf) : market?.asOf || '—';
  const status = !auto ? '已暂停轮询' : quotes.error ? '行情连接异常' : !quote ? chinese ? '连接行情中' : '历史日线' : quote.stale ? '快照已过期' : quote?.session === 'trading' ? '盘中快照' : quote?.session === 'break' ? '午间休市' : '已收盘';
  const visibleWatch = watchlist.filter(s => watchFilter === 'all' || (watchFilter === 'cn' ? /\.(SH|SZ|BJ)$/.test(s) : !/\.(SH|SZ|BJ)$/.test(s)));
  const row = (s: string) => { const q = quoteMap.get(s), d = markets[s]; return { name: q?.name || d?.name || CATALOG.find(c => c.symbol === s)?.name || s, price: q?.price ?? d?.last, change: q?.changePercent ?? d?.changePercent }; };
  const renderSector = (board: Sector) => <button type="button" key={board.code} className={'desk-sector-row ' + (chosenBoard?.code === board.code ? 'selected' : '')} onClick={() => { setSectorCode(board.code); setExternalSector(board); setContextTab('sectors'); }}><span>{uiText(board.name)}<small>{uiText(board.code)}</small></span><b className={tone(board.changePercent)}>{uiText(pct(board.changePercent))}</b><ChevronRight size={13} /></button>;

  const securityCard=(<section className="desk-security">
          <div className="desk-security-top"><div className="desk-company"><span className="desk-market-tag">{uiText(symbol.endsWith('.SZ') ? '深' : symbol.endsWith('.SH') ? '沪' : symbol.endsWith('.BJ') ? '京' : 'US')}</span><h1>{(name)}</h1><span>{uiText(symbol)}</span><button type="button" className={'desk-icon ' + (watchlist.includes(symbol) ? 'is-starred' : '')} aria-label={uiText(watchlist.includes(symbol) ? '移出自选' : '加入自选')} onClick={() => onToggleWatch(symbol)}><Star size={16} fill={watchlist.includes(symbol) ? 'currentColor' : 'none'} /></button></div><div className={'desk-session ' + (quote?.session === 'trading' && !quote.stale && auto && !quotes.error ? 'is-trading' : '')}><i />{uiText(status)}<Hint text={uiText("盘中按5秒轮询公开行情，盘后30秒。市场时段按北京时间判断；交易日以来源快照为准，行情不保证交易所实时。")} /></div></div>
          <div className="desk-security-main"><div className={'desk-big-price ' + tone(change)}><strong>{uiText(number(price))}</strong><div><b>{uiText(quote?.change != null ? (quote.change >= 0 ? '+' : '') + number(quote.change) : market?.change != null ? number(market.change) : '—')}</b><span>{uiText(pct(change))}</span></div></div><div className="desk-live-actions"><StockSnapshot symbol={symbol}/><button type="button" onClick={() => { setAlertValue(price ? String(price) : ''); setAlertOpen(true); }}><Bell size={13} />{uiText("提醒")}</button><button type="button" onClick={() => setAuto(v => !v)} aria-pressed={!auto} aria-label={uiText(auto ? '暂停自动刷新' : '恢复自动刷新')}>{uiText(auto ? <Pause size={13} /> : <Play size={13} />)}{uiText(auto ? '自动' : '暂停')}</button><button type="button" onClick={refresh} aria-label={uiText("刷新个股工作台")}><RefreshCw size={14} /></button></div></div>
          <div className="desk-stat-grid">{uiText([{ label: '今开', value: number(quote?.open) }, { label: '最高', value: number(quote?.high) }, { label: '最低', value: number(quote?.low) }, { label: '成交额', value: amount(quote?.amount) }, { label: '换手率', value: quote?.turnover == null ? '—' : quote.turnover.toFixed(2) + '%' }, { label: '量比', value: number(quote?.volumeRatio) }, { label: '市盈率 TTM', value: number(quote?.pe) }, { label: '总市值', value: amount(quote?.marketCap) }].map(stat => <div key={stat.label}><span>{uiText(stat.label)}</span><b>{uiText(stat.value)}</b></div>))}</div>
          <div className="desk-security-footer"><span>{uiText("快照")}{uiText(sourceDate)} {uiText("· 北京时间")}</span><span>{uiText("较沪深300")}<b className={tone(relativeStrength)}>{uiText(relativeStrength == null ? '—' : (relativeStrength >= 0 ? '+' : '') + relativeStrength.toFixed(2) + ' pct')}</b></span></div>
          {uiText(quotes.error && <Source text="" error={uiText(quote ? '刷新失败 · 当前保留上一行情快照' : quotes.error)} />)}
        </section>);
  return <Tooltip.Provider delayDuration={250}><div className="research-desk" data-testid="research-desk">
    <div className="desk-market-tape" aria-label={uiText("大盘联动")}>{uiText(INDEXES.map(s => { const q = quoteMap.get(s); return <button type="button" key={s} onClick={() => onSelect(s)}><span>{uiText(q?.name || ({ '000001.SH': '上证指数', '399001.SZ': '深证成指', '399006.SZ': '创业板指', '000300.SH': '沪深300', '000688.SH': '科创50' }[s]))}</span><b>{uiText(number(q?.price))}</b><small className={tone(q?.changePercent)}>{uiText(pct(q?.changePercent))}</small></button>; }))}<div className="desk-tape-stamp"><Radio size={12} />{uiText("公开快照")}</div></div>
    <div className="desk-mobile-sticky" data-testid="mobile-quote"><b>{name}</b><span>{symbol}</span><strong className={tone(change)}>{number(price)}</strong><em className={tone(change)}>{pct(change)}</em></div><div className="desk-layout" style={{'--quote-rail':quoteWidth+'px'} as CSSProperties}>
      <aside className="desk-watch">
        <div className="desk-block-heading"><h2>{uiText("我的自选")}<small>{uiText(watchlist.length)}</small></h2><button type="button" className="desk-icon" aria-label={uiText("搜索并添加自选")} onClick={onSearch}><Plus size={16} /></button></div>
        <div className="desk-watch-filters">{uiText([['all', '全部'], ['cn', 'A股'], ['us', '美股']].map(([id, label]) => <button type="button" aria-pressed={watchFilter === id} className={watchFilter === id ? 'active' : ''} onClick={() => setWatchFilter(id)} key={id}>{uiText(label)}</button>))}</div>
        <div className="desk-watch-labels"><span>{uiText("名称 / 代码")}</span><span>{uiText("价格 / 涨跌")}</span></div>
        <div className="desk-watch-items">{uiText(visibleWatch.map(s => { const d = row(s); return <button type="button" key={s} className={'desk-watch-item ' + (s === symbol ? 'active' : '')} onClick={() => onSelect(s)}><span><b>{(d.name)}</b><small>{uiText(s)}</small></span><span><b className={tone(d.change)}>{uiText(number(d.price))}</b><small className={tone(d.change)}>{uiText(pct(d.change))}</small></span></button>; }))}{uiText(!visibleWatch.length && <Empty text={uiText("暂无自选，点击 + 添加")} />)}</div>
        <div className="desk-watch-bottom"><button type="button" onClick={() => setAlertOpen(true)}><Bell size={14} /><span>{uiText("价格提醒")}</span><b>{uiText(rules.filter(r => !r.firedAt).length)}</b></button><p>{uiText("本页打开且盘中行情有效时触发")}</p></div>
      </aside>

      <div className="desk-center">
        <div className="desk-mobile-security">{securityCard}</div>

        {chinese && <><LiveAlerts alerts={liveAlerts}/><DailyTrendPanel symbol={symbol} liveAlerts={liveAlerts}/></>}
        {uiText(analysis && <GuideSummary strategy={strategy} review={decision.data?.review} candles={market?.candles} character={character} data={analysis} onOpen={() => {setContextTab('guide'); document.getElementById('stock-context')?.scrollIntoView({behavior:'smooth',block:'start'});}} />)}


        <section className="desk-context" id="stock-context"><Tabs.Root value={contextTab} onValueChange={setContextTab}><Tabs.List className="desk-tabs desk-context-tabs" aria-label={uiText("个股关联数据")}>{uiText([['chart', 'K线'], ['guide', '五线开花'], ['sectors', '板块联动'], ['flow', '资金流'], ['news', '个股资讯'], ['reports', '机构研报'], ['f10', 'F10 资料'], ['evidence', '公告财报']].map(([id, label]) => <Tabs.Trigger key={id} value={id}>{uiText(label)}</Tabs.Trigger>))}</Tabs.List>
          <Tabs.Content value="chart" forceMount style={{display:contextTab==='chart'?undefined:'none'}}><section className="desk-chart-card"><Tabs.Root value={chartMode} onValueChange={setChartMode}>
          <div className="desk-chart-heading"><Tabs.List className="desk-tabs" aria-label={uiText("行情图表类型")}><Tabs.Trigger value="intraday" disabled={!chinese}>{uiText("分时")}</Tabs.Trigger><Tabs.Trigger value="daily">{uiText("日 K")}</Tabs.Trigger><Tabs.Trigger value="week" disabled={!chinese}>{uiText("周 K")}</Tabs.Trigger><Tabs.Trigger value="month" disabled={!chinese}>{uiText("月 K")}</Tabs.Trigger><select aria-label={uiText('分钟周期')} value={chartMode.startsWith('m')&&chartMode!=='month'?chartMode:''} onChange={e=>{if(e.target.value)setChartMode(e.target.value);}}><option value="">{uiText('周期')}</option>{[5,15,30,60,120].map(n=><option key={n} value={'m'+n}>{n} {uiText('分钟')}</option>)}</select></Tabs.List><span>MA · VOL · MACD · KDJ</span></div>
          <Tabs.Content value="daily">{uiText(market?.candles.length ? <MarketChart candles={market.candles} symbol={symbol} amount={quote?.amount} amountDate={quote?.asOf.slice(0,10)} guideEvents={analysis?.events} tradeMarkers={tradeMarkers} patternMarkers={decision.data?.patternMarks} chipFloatShares={quote?.floatCap&&quote.price?quote.floatCap/quote.price:undefined} volumeUnit={market.provider.startsWith('新浪') ? '股' : market.provider.startsWith('腾讯') ? /^68[89]/.test(symbol) ? '股' : '手' : undefined} /> : marketError ? <><Empty text={uiText("原始K线暂不可用，保留第三方参考图")} /><TradingViewWidget symbol={symbol} /></> : <Empty loading />)}</Tabs.Content>
          {uiText((['week','month','m5','m15','m30','m60','m120'] as const).map(period=><Tabs.Content value={period} key={period}>{uiText(periodData.data?<MarketChart candles={periodData.data.candles} symbol={symbol} unit={period} volumeUnit={periodData.data.volumeUnit}/>:<div><Empty loading={periodData.loading} text={uiText(periodData.error)}/>{uiText(!periodData.loading&&<button className="outline-button" onClick={periodData.refresh}>{uiText("重试数据源")}</button>)}</div>)}</Tabs.Content>))}
          <Tabs.Content value="intraday">{uiText(dayData.data ? <IntradayChart data={dayData.data} /> : <Empty loading={dayData.loading} text={uiText(dayData.error || '分时暂不可用')} />)}{uiText(dayData.error && dayData.data && <Source text="" error={uiText("分时刷新失败，保留上一快照")} />)}</Tabs.Content>
        </Tabs.Root><div className="desk-chart-source"><span>{uiText(chartMode === 'daily' ? market?.provider || '等待日线数据' : chartMode === 'intraday' ? dayData.data?.source || '公开分钟分时' : periodData.data?.source || '等待周期历史')}</span><span>{uiText(chartMode === 'daily' ? market?.asOf : chartMode === 'intraday' ? dayData.data?.date : periodData.data?.candles.at(-1)?.time)}</span></div></section></Tabs.Content>
          <Tabs.Content value="sectors"><div className="desk-linkage-head"><div><Layers3 size={15} /><b>{uiText("所属板块")}</b><span>{uiText(boards.length || '—')}</span></div><small>{uiText("点击板块查看同板块标的")}</small></div>
            {uiText(boards.length ? <div className="desk-sector-chips">{uiText(boards.map(b => <button type="button" key={b.code} className={chosenBoard?.code === b.code ? 'active' : ''} onClick={() => {setExternalSector(null);setSectorCode(b.code);}}>{uiText(b.name)}<span className={tone(b.changePercent)}>{uiText(pct(b.changePercent))}</span></button>))}</div> : <Empty loading={boardData.loading} text={uiText(chinese ? boardData.error || '来源暂无板块归属' : '当前公开板块接口覆盖 A 股')} />)}
            <div className="desk-concept-source"><label>独立概念成分 <select aria-label="选择新浪概念板块" value={externalSector?.code.startsWith('SN:gn_')?externalSector.code:''} onChange={e=>{const item=conceptData.data?.items.find(r=>r.code===e.target.value);if(item){setExternalSector(item);setSectorCode(item.code);}}}><option value="">选择概念（新浪独立分类）</option>{conceptData.data?.items.map(b=><option key={b.code} value={b.code}>{b.name} · {pct(b.changePercent)}</option>)}</select></label><span>可直接查看机器人、创新药等概念成分；不同来源分类分别标识。</span>{peerData.error&&<button onClick={peerData.refresh}>重试原板块</button>}</div>
            <div className="desk-linkage-grid"><div><div className="desk-subheading"><b>{uiText(peerData.data?.resolvedName || chosenBoard?.name || '板块成分')} {uiText(peerData.data?.related?"· 相关分类参考":"· 领涨观察")}</b><span>{uiText(peerData.data?.delayMinutes ? '约15分钟延迟 · 涨幅排序' : '涨幅排序')}</span></div><div className="desk-table-scroll"><table className="desk-table"><thead><tr><th>{uiText("名称")}</th><th>{uiText("最新价")}</th><th>{uiText("涨跌幅")}</th><th>{uiText("主力净额")}</th></tr></thead><tbody>{uiText(peerData.data?.items.map(p => <tr key={p.symbol} onClick={() => onSelect(p.symbol)}><td><button type="button" onClick={() => onSelect(p.symbol)}>{(p.name)}<small>{uiText(p.symbol)}</small></button></td><td>{uiText(number(p.price))}</td><td className={tone(p.changePercent)}>{uiText(pct(p.changePercent))}</td><td className={tone(p.mainNet)}>{uiText(amount(p.mainNet))}</td></tr>))}</tbody></table></div>{uiText(!peerData.data?.items.length && <Empty loading={peerData.loading} text={uiText(boardData.error && !chosenBoard ? '板块归属源暂不可用，可独立查看市场行业成分。' : peerData.error ? '原板块来源暂不可用，请选择上方独立概念，或点击重试。' : '选择板块以加载成分')} />)}{uiText((peerData.error || boardData.error) && <div className="desk-fallback-actions">{uiText(chosenBoard?.leaderSymbol && <button type="button" onClick={() => onSelect(chosenBoard.leaderSymbol!)}>{uiText("来源领涨：")}{uiText(chosenBoard.leader)}</button>)}{uiText(rankData.data?.items[0] && <button type="button" onClick={() => {setExternalSector(rankData.data!.items[0]);setSectorCode(rankData.data!.items[0].code);}}>{uiText("查看市场领涨行业成分")}</button>)}</div>)}</div><div><div className="desk-subheading"><b>{uiText(rankData.data?.classification === 'sina-industry' ? '新浪行业轮动' : '市场行业轮动')}</b><span>{uiText(rankData.data?.delayMinutes ? '约15分钟延迟' : '涨幅前20')}</span></div>{uiText(rankData.data?.items.slice(0, 9).map(renderSector))}{uiText(!rankData.data?.items.length && <Empty loading={rankData.loading} text={uiText(rankData.error)} />)}</div></div><Source text={uiText([peerData.data?.source, rankData.data?.source].filter(Boolean).join(' · ') || '东方财富公开板块归属、成分与行业排名；板块归属混合行业、概念和地域。')} />{uiText((rankData.data?.notice || peerData.data?.notice) && <Source text={uiText([rankData.data?.notice, peerData.data?.notice].filter(Boolean).join(' '))} />)}<SectorOutlook symbol={symbol} onStock={onSelect} /></Tabs.Content>
          <Tabs.Content value="flow">{chinese?<FlowPanel key={symbol} symbol={symbol} auto={auto}/>:<Empty text="当前公开资金接口覆盖 A 股"/>}</Tabs.Content>
          <Tabs.Content value="news"><NewsFeed items={companyNews.data?.items || []} loading={companyNews.loading} error={uiText(companyNews.error)} /><Source text={uiText("东方财富个股代码检索 · 来源摘要 · 3分钟刷新")} /></Tabs.Content>
          <Tabs.Content value="reports">{uiText(reportData.data?.items.length ? <div className="desk-reports">{uiText(reportData.data.items.map((r, i) => <button type="button" key={r.url + i} onClick={() => openNews({ id: r.url, title: r.title, publishedAt: r.date + 'T00:00:00+08:00', source: r.organization, url: r.url, category: 'all', originalTitle: r.title, summary: '机构：' + r.organization + (r.rating ? '；来源评级：' + r.rating : '') })}><span>{uiText(r.date)}<b>{uiText(r.organization)}</b></span><strong>{(r.title)}</strong><small>{uiText(r.rating || '未提供评级')} <ChevronRight size={13} /></small></button>))}</div> : <Empty loading={reportData.loading} text={uiText(reportData.error || '来源在当前窗口未列出研报')} />)}<Source text={uiText("东方财富研报索引 · 评级保留来源表述")} /></Tabs.Content>
          <Tabs.Content value="evidence"><StockResearchExtras symbol={symbol} onStock={onSelect} /></Tabs.Content>
          <Tabs.Content value="f10"><F10Panel symbol={symbol}/></Tabs.Content>
          <Tabs.Content value="guide">{uiText(analysis ? <GuidePanel strategy={strategy} review={decision.data?.review} patternMarks={decision.data?.patternMarks} reviewError={decision.error} reviewLoading={decision.loading} candles={market?.candles} character={character} data={analysis} weekly={guideWeekly.data?.candles} monthly={guideMonthly.data?.candles} weekError={!chinese ? '当前周期接口未覆盖此市场' : guideWeekly.error} monthError={!chinese ? '当前周期接口未覆盖此市场' : guideMonthly.error} loading={guideWeekly.loading || guideMonthly.loading} /> : <Empty text={uiText("等待有效日线以核验指南条件")} />)}</Tabs.Content>
        </Tabs.Root></section>
      </div>

      <aside className="desk-right"><ResizeRail className="quote-resize-rail" label="调整盘口信息宽度" side="right" width={quoteWidth} onChange={setQuoteWidth} defaultWidth={380} max={()=>Math.min(600,(document.querySelector('.desk-layout')?.getBoundingClientRect().width||1000)-344)}/><div className="desk-pinned-quote">{securityCard}</div><div className="desk-right-stream">
        <section className="desk-orderbook"><Tabs.Root value={bookTab} onValueChange={setBookTab}><div className="desk-block-heading"><Tabs.List className="desk-tabs" aria-label={uiText("盘口类型")}><Tabs.Trigger value="book">{uiText("五档盘口")}</Tabs.Trigger><Tabs.Trigger value="level2">Level-2</Tabs.Trigger><Tabs.Trigger value="ticks">{uiText("成交分笔")}</Tabs.Trigger></Tabs.List><Hint text={uiText("公开五档和约3秒聚合分笔；没有授权十档、逐笔委托队列或完整交易所 Level-2。")} /></div>
          <Tabs.Content value="book"><Book quote={quote} loading={quotes.loading} error={uiText(quotes.error)} /></Tabs.Content>
          <Tabs.Content value="level2"><Level2Panel symbol={symbol}/></Tabs.Content><Tabs.Content value="ticks">{uiText(tickData.data?.items.length ? <><div className="desk-ticks-head"><span>{uiText("时间")}</span><span>{uiText("成交价")}</span><span>{uiText("量（手）")}</span></div><div className="desk-ticks-list">{uiText(tickData.data.items.slice(0, 45).map(t => <div key={t.sequence}><time>{uiText(t.time)}</time><b className={t.side === 'B' ? 'is-up' : t.side === 'S' ? 'is-down' : ''}>{uiText(number(t.price))}</b><span>{uiText(number(t.volume, 0))}<small>{uiText(t.side === 'B' ? 'B' : t.side === 'S' ? 'S' : '·')}</small></span></div>))}</div><Source text={uiText((tickData.data.date || '') + ' · 最近一页 · 聚合分笔，非全日完整明细')} error={uiText(tickData.error)} /></> : <Empty loading={tickData.loading} text={uiText(tickData.error || '暂无分笔数据')} />)}</Tabs.Content>
        </Tabs.Root></section>
        <section className="desk-flash"><div className="desk-block-heading"><h2><Globe2 size={14} />{uiText("7×24 快讯")}</h2><span className="desk-refresh-label">60s</span><button type="button" aria-label={uiText("刷新7×24快讯")} className="desk-icon" onClick={flash.refresh}><RefreshCw size={13} /></button></div><div className="desk-flash-scroll"><NewsFeed compact items={flash.data?.items || []} loading={flash.loading} error={uiText(flash.error)} /></div><Source text={uiText((flash.data?.sources.join(' / ') || '财联社 / 华尔街见闻') + ' · ' + clock(flash.data?.fetchedAt))} error={uiText(flash.error || flash.data?.warnings.join('；'))} /></section>
        <section className="desk-related"><div className="desk-block-heading"><h2>{uiText("关联线索")}</h2><Layers3 size={14} /></div>{uiText(boards.slice(0, 5).map(renderSector))}{uiText(!boards.length && <Empty text={uiText(boardData.error || '等待板块归属')} />)}</section>
      </div></aside>
    </div>
    <Dialog.Root open={alertOpen} onOpenChange={setAlertOpen}><Dialog.Portal><Dialog.Overlay className="desk-dialog-overlay" /><Dialog.Content className="desk-dialog"><Dialog.Title>{uiText("价格提醒")}</Dialog.Title><Dialog.Description>{uiText("规则保存在当前浏览器。本页打开、自动刷新开启且盘中快照有效时触发一次。")}</Dialog.Description><Dialog.Close asChild><button type="button" className="desk-dialog-close desk-icon" aria-label={uiText("关闭提醒设置")}><X size={18} /></button></Dialog.Close><form onSubmit={event => { event.preventDefault(); const value = Number(alertValue); if (!chinese || !Number.isFinite(value) || value <= 0 || rules.filter(r => !r.firedAt).length >= 20) return; setRules(old => [...old, { id: crypto.randomUUID(), symbol, direction: alertDirection, value }]); setAlertValue(''); }}><label>{uiText("监控标的")}<input value={name + ' · ' + symbol} readOnly /></label><div className="desk-alert-inputs"><label>{uiText("触发条件")}<select value={alertDirection} onChange={event => setAlertDirection(event.target.value as 'above' | 'below')}><option value="above">{uiText("价格达到或高于")}</option><option value="below">{uiText("价格达到或低于")}</option></select></label><label>{uiText("价格")}<input aria-label={uiText("提醒目标价格")} type="number" min="0.001" step="0.001" required value={alertValue} onChange={event => setAlertValue(event.target.value)} /></label></div><button className="desk-primary-button" type="submit" disabled={!chinese || rules.filter(r => !r.firedAt).length >= 20}><Plus size={14} />{uiText("添加提醒")}</button>{uiText(!chinese && <p>{uiText("当前公开快照提醒只覆盖沪深北市场。")}</p>)}</form><div className="desk-rule-list">{uiText(rules.map(rule => <div key={rule.id}><Bell size={13} /><span>{uiText(rule.symbol)}<small>{uiText(rule.direction === 'above' ? '≥' : '≤')} {uiText(number(rule.value))} · {uiText(rule.firedAt ? '已触发' : '监控中')}</small></span><button type="button" className="desk-icon" aria-label={uiText('删除提醒 ' + rule.symbol + ' ' + rule.value)} onClick={() => setRules(old => old.filter(r => r.id !== rule.id))}><Trash2 size={14} /></button></div>))}</div></Dialog.Content></Dialog.Portal></Dialog.Root>
    {uiText(alertMessage && <div className="desk-alert-toast" role="status"><Bell size={17} /><span>{uiText(alertMessage)}</span><button type="button" aria-label={uiText("关闭价格提醒通知")} onClick={() => setAlertMessage('')}><X size={15} /></button></div>)}
  </div></Tooltip.Provider>;
}
