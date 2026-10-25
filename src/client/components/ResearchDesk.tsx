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
import { analyzeCandles } from '../../shared/analysis';
import { evaluateWatchRules, type QuotesPayload, type Snapshot, type IntradayPayload, type TickPayload, type SectorsPayload, type PeersPayload, type SectorRanks, type FlowPayload, type FlashPayload, type ReportsPayload, type WatchRule, type Sector } from '../../shared/desk-types';
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
  return <Tooltip.Root><Tooltip.Trigger asChild><button type="button" className="desk-help" aria-label={text}><CircleHelp size={13} /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="desk-tooltip" sideOffset={7}>{text}<Tooltip.Arrow /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}
function Empty({ text = '数据暂不可用', loading = false }: { text?: string; loading?: boolean }) {
  return <div className="desk-empty">{loading && <LoaderCircle size={16} className="spin" />}<span>{loading ? '正在连接数据源…' : text}</span></div>;
}
function Source({ text, error }: { text: string; error?: string }) { return <div className={'desk-source ' + (error ? 'has-warning' : '')}>{error || text}</div>; }
function NewsFeed({ items, compact = false, loading, error }: { items: NewsItem[]; compact?: boolean; loading?: boolean; error?: string }) {
  const { openNews } = useReader();
  if (!items.length) return <Empty loading={loading} text={error || '当前范围内暂无来源资讯'} />;
  return <div className={'desk-news-list ' + (compact ? 'is-compact' : '')}>{items.map((item, i) => <button type="button" className="desk-news-item" key={item.id + '-' + i} onClick={() => openNews(item)}>
    <time>{clock(item.publishedAt)}</time><div><span className="desk-news-title">{item.title}</span>{!compact && item.summary && <p>{item.summary}</p>}<small>{item.source} <span>· {dateClock(item.publishedAt)}</span></small></div>
  </button>)}</div>;
}
export function FlashNewsDesk() {
  const [auto, setAuto] = useState(true), [filter, setFilter] = useState('all');
  const feed = useLiveEndpoint<FlashPayload>('/api/desk/flash', 60000, auto);
  const items = (feed.data?.items || []).filter(item => filter === 'all' || (filter === 'important' ? item.important : item.source === filter));
  return <div className="research-desk desk-news-page"><header><div><span>MARKET NEWSROOM</span><h1>7×24 财经快讯</h1><p>财联社与华尔街见闻 · 来源摘要 · 北京时间</p></div><div className="desk-live-actions"><span>{auto ? '每60秒更新' : '已暂停自动更新'} · {clock(feed.data?.fetchedAt)}</span><button type="button" onClick={() => setAuto(value => !value)}>{auto ? <Pause size={13} /> : <Play size={13} />}{auto ? '暂停' : '恢复'}</button><button type="button" aria-label="刷新财经快讯" onClick={feed.refresh}><RefreshCw size={14} /></button></div></header><section className="desk-context"><Tabs.Root value={filter} onValueChange={setFilter}><Tabs.List className="desk-tabs desk-context-tabs" aria-label="快讯来源筛选">{[['all', '全部快讯'], ['important', '重要'], ['财联社', '财联社'], ['华尔街见闻', '华尔街见闻']].map(([value, label]) => <Tabs.Trigger key={value} value={value}>{label}</Tabs.Trigger>)}</Tabs.List></Tabs.Root><NewsFeed items={items} loading={feed.loading} error={feed.error} /><Source text={(feed.data?.sources.join(' / ') || '正在连接快讯源') + ' · ' + items.length + '条'} error={feed.error || feed.data?.warnings.join('；')} /></section></div>;
}
function Book({ quote, loading, error }: { quote?: Snapshot; loading: boolean; error: string }) {
  if (!quote) return <Empty loading={loading} text={error || '此市场暂未接入五档盘口'} />;
  const max = Math.max(1, ...[...quote.asks, ...quote.bids].map(l => l.volume || 0));
  const buy = quote.bids.reduce((n, l) => n + (l.volume || 0), 0), sell = quote.asks.reduce((n, l) => n + (l.volume || 0), 0);
  return <><div className="desk-book-head"><span>档位</span><span>价格</span><span>数量</span></div><div className="desk-book-rows">
    {[...quote.asks].map((level, i) => ({ ...level, rank: i + 1 })).reverse().map(level => <div key={'ask' + level.rank} className="desk-book-row"><span>卖{level.rank}</span><b className={tone((level.price ?? quote.previous) - quote.previous)}>{number(level.price)}</b><span className="desk-book-volume"><i className="ask-depth" style={{ width: ((level.volume || 0) / max * 100) + '%' }} />{number(level.volume, 0)}</span></div>)}
    <div className="desk-book-mid"><b className={tone(quote.changePercent)}>{number(quote.price)}</b><span className={tone(quote.changePercent)}>{pct(quote.changePercent)}</span><small>{clock(quote.asOf)}</small></div>
    {quote.bids.map((level, i) => <div key={'bid' + i} className="desk-book-row"><span>买{i + 1}</span><b className={tone((level.price ?? quote.previous) - quote.previous)}>{number(level.price)}</b><span className="desk-book-volume"><i className="bid-depth" style={{ width: ((level.volume || 0) / max * 100) + '%' }} />{number(level.volume, 0)}</span></div>)}
  </div><div className="desk-order-ratio"><span>买盘挂单 {buy + sell ? (buy / (buy + sell) * 100).toFixed(1) : '—'}%</span><div><i style={{ width: (buy + sell ? buy / (buy + sell) * 100 : 50) + '%' }} /></div><span>卖盘</span></div><Source text={'公开五档快照 · 数量使用来源单位 · ' + dateClock(quote.asOf)} error={error ? '刷新失败，保留上一快照' : undefined} /></>;
}
function FlowPanel({ state }: { state: ReturnType<typeof useLiveEndpoint<FlowPayload>> }) {
  const last = state.data?.points.at(-1);
  if (!last) return <Empty loading={state.loading} text={state.error || '来源暂无资金流记录'} />;
  const items = [{ title: '主力净流入', value: last.main }, { title: '超大单', value: last.superLarge }, { title: '大单', value: last.large }, { title: '中单', value: last.medium }, { title: '小单', value: last.small }];
  const max = Math.max(1, ...items.map(i => Math.abs(i.value || 0)));
  return <div className="desk-flow"><div className="desk-flow-overline">来源时点 {last.time} <Hint text="按成交单大小分类估算的资金流，不等于交易所主动买卖逐笔，也不是 Level-2。" /></div>{items.map(item => <div className="desk-flow-row" key={item.title}><span>{item.title}</span><div><i className={(item.value || 0) >= 0 ? 'flow-positive' : 'flow-negative'} style={{ width: Math.abs(item.value || 0) / max * 100 + '%' }} /></div><b className={tone(item.value)}>{amount(item.value)}</b></div>)}<Source text={state.data!.source} error={state.error} /></div>;
}
function readRules(): WatchRule[] {
  try {
    const stored = JSON.parse(localStorage.getItem('atlas.price-alerts.v1') || '[]');
    return Array.isArray(stored) ? stored.filter(r => typeof r.id === 'string' && /^\d{6}\.(SH|SZ|BJ)$/.test(r.symbol) && ['above', 'below'].includes(r.direction) && Number.isFinite(r.value) && r.value > 0).slice(0, 30) : [];
  } catch { return []; }
}

type Props = { symbol: string; market?: MarketPayload; marketError?: string; markets: Record<string, MarketPayload>; watchlist: string[]; onSelect: (symbol: string) => void; onToggleWatch: (symbol: string) => void; onSearch: () => void; onRefresh: () => void };
export default function ResearchDesk({ symbol, market, marketError, markets, watchlist, onSelect, onToggleWatch, onSearch, onRefresh }: Props) {
  const [auto, setAuto] = useState(true), [chartMode, setChartMode] = useState('daily'), [contextTab, setContextTab] = useState('sectors'), [bookTab, setBookTab] = useState('book');
  const [watchFilter, setWatchFilter] = useState('all'), [sectorCode, setSectorCode] = useState('');
  const [externalSector, setExternalSector] = useState<Sector | null>(null);
  const [rules, setRules] = useState<WatchRule[]>(readRules), [alertOpen, setAlertOpen] = useState(false), [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above'), [alertValue, setAlertValue] = useState(''), [alertMessage, setAlertMessage] = useState('');
  const chinese = /^\d{6}\.(SH|SZ|BJ)$/.test(symbol);
  const symbols = useMemo(() => [...new Set([symbol, ...INDEXES, ...watchlist, ...rules.filter(r => !r.firedAt).map(r => r.symbol)].filter(s => /^\d{6}\.(SH|SZ|BJ)$/.test(s)))].slice(0, 60).sort().join(','), [symbol, watchlist, rules]);
  const quotes = useLiveEndpoint<QuotesPayload>('/api/desk/quotes?symbols=' + symbols, 5000, auto);
  const quoteMap = useMemo(() => new Map(quotes.data?.items.map(q => [q.symbol, q]) || []), [quotes.data]);
  const quote = quoteMap.get(symbol);
  const dayData = useLiveEndpoint<IntradayPayload>(chinese && chartMode === 'intraday' ? '/api/desk/intraday?symbol=' + symbol : null, 15000, auto);
  const periodData = useLiveEndpoint<{candles:Candle[];source:string}>(chinese && ['week','month'].includes(chartMode) ? '/api/desk/history?symbol=' + symbol + '&period=' + chartMode : null);
  const tickData = useLiveEndpoint<TickPayload>(chinese && bookTab === 'ticks' ? '/api/desk/ticks?symbol=' + symbol : null, 15000, auto);
  const boardData = useLiveEndpoint<SectorsPayload>(chinese ? '/api/desk/sectors?symbol=' + symbol : null, 300000);
  const boards = boardData.data?.boards || [];
  const chosenBoard = externalSector || boards.find(b => b.code === sectorCode) || boards[0];
  const peerData = useLiveEndpoint<PeersPayload>(contextTab === 'sectors' && chosenBoard ? '/api/desk/peers?code=' + chosenBoard.code : null, 60000, auto);
  const rankData = useLiveEndpoint<SectorRanks>(contextTab === 'sectors' ? '/api/desk/ranks' : null, 120000, auto);
  const flowData = useLiveEndpoint<FlowPayload>(chinese && contextTab === 'flow' ? '/api/desk/flow?symbol=' + symbol : null, 60000, auto);
  const flash = useLiveEndpoint<FlashPayload>('/api/desk/flash', 60000, auto);
  const companyNews = useLiveEndpoint<FlashPayload>(chinese && contextTab === 'news' ? '/api/desk/stock-news?symbol=' + symbol : null, 180000, auto);
  const reportData = useLiveEndpoint<ReportsPayload>(chinese && contextTab === 'reports' ? '/api/desk/reports?symbol=' + symbol : null);
  const analysis = useMemo(() => market ? analyzeCandles(market.candles) : null, [market]);
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
  const refresh = () => { quotes.refresh(); dayData.refresh(); flash.refresh(); onRefresh(); };
  const sourceDate = quote?.asOf ? dateClock(quote.asOf) : market?.asOf || '—';
  const status = !auto ? '已暂停轮询' : quotes.error ? '行情连接异常' : !quote ? chinese ? '连接行情中' : '历史日线' : quote.stale ? '快照已过期' : quote?.session === 'trading' ? '盘中快照' : quote?.session === 'break' ? '午间休市' : '已收盘';
  const visibleWatch = watchlist.filter(s => watchFilter === 'all' || (watchFilter === 'cn' ? /\.(SH|SZ|BJ)$/.test(s) : !/\.(SH|SZ|BJ)$/.test(s)));
  const row = (s: string) => { const q = quoteMap.get(s), d = markets[s]; return { name: q?.name || d?.name || CATALOG.find(c => c.symbol === s)?.name || s, price: q?.price ?? d?.last, change: q?.changePercent ?? d?.changePercent }; };
  const renderSector = (board: Sector) => <button type="button" key={board.code} className={'desk-sector-row ' + (chosenBoard?.code === board.code ? 'selected' : '')} onClick={() => { setSectorCode(board.code); setExternalSector(board); setContextTab('sectors'); }}><span>{board.name}<small>{board.code}</small></span><b className={tone(board.changePercent)}>{pct(board.changePercent)}</b><ChevronRight size={13} /></button>;

  return <Tooltip.Provider delayDuration={250}><div className="research-desk" data-testid="research-desk">
    <div className="desk-market-tape" aria-label="大盘联动">{INDEXES.map(s => { const q = quoteMap.get(s); return <button type="button" key={s} onClick={() => onSelect(s)}><span>{q?.name || ({ '000001.SH': '上证指数', '399001.SZ': '深证成指', '399006.SZ': '创业板指', '000300.SH': '沪深300', '000688.SH': '科创50' }[s])}</span><b>{number(q?.price)}</b><small className={tone(q?.changePercent)}>{pct(q?.changePercent)}</small></button>; })}<div className="desk-tape-stamp"><Radio size={12} />公开快照</div></div>
    <div className="desk-layout">
      <aside className="desk-watch">
        <div className="desk-block-heading"><h2>我的自选 <small>{watchlist.length}</small></h2><button type="button" className="desk-icon" aria-label="搜索并添加自选" onClick={onSearch}><Plus size={16} /></button></div>
        <div className="desk-watch-filters">{[['all', '全部'], ['cn', 'A股'], ['us', '美股']].map(([id, label]) => <button type="button" aria-pressed={watchFilter === id} className={watchFilter === id ? 'active' : ''} onClick={() => setWatchFilter(id)} key={id}>{label}</button>)}</div>
        <div className="desk-watch-labels"><span>名称 / 代码</span><span>价格 / 涨跌</span></div>
        <div className="desk-watch-items">{visibleWatch.map(s => { const d = row(s); return <button type="button" key={s} className={'desk-watch-item ' + (s === symbol ? 'active' : '')} onClick={() => onSelect(s)}><span><b>{d.name}</b><small>{s}</small></span><span><b>{number(d.price)}</b><small className={tone(d.change)}>{pct(d.change)}</small></span></button>; })}{!visibleWatch.length && <Empty text="暂无自选，点击 + 添加" />}</div>
        <div className="desk-watch-bottom"><button type="button" onClick={() => setAlertOpen(true)}><Bell size={14} /><span>价格提醒</span><b>{rules.filter(r => !r.firedAt).length}</b></button><p>本页打开且盘中行情有效时触发</p></div>
      </aside>

      <div className="desk-center">
        <section className="desk-security">
          <div className="desk-security-top"><div className="desk-company"><span className="desk-market-tag">{symbol.endsWith('.SZ') ? '深' : symbol.endsWith('.SH') ? '沪' : symbol.endsWith('.BJ') ? '京' : 'US'}</span><h1>{name}</h1><span>{symbol}</span><button type="button" className={'desk-icon ' + (watchlist.includes(symbol) ? 'is-starred' : '')} aria-label={watchlist.includes(symbol) ? '移出自选' : '加入自选'} onClick={() => onToggleWatch(symbol)}><Star size={16} fill={watchlist.includes(symbol) ? 'currentColor' : 'none'} /></button></div><div className={'desk-session ' + (quote?.session === 'trading' && !quote.stale && auto && !quotes.error ? 'is-trading' : '')}><i />{status}<Hint text="盘中按5秒轮询公开行情，盘后30秒。市场时段按北京时间判断；交易日以来源快照为准，行情不保证交易所实时。" /></div></div>
          <div className="desk-security-main"><div className={'desk-big-price ' + tone(change)}><strong>{number(price)}</strong><div><b>{quote?.change != null ? (quote.change >= 0 ? '+' : '') + number(quote.change) : market?.change != null ? number(market.change) : '—'}</b><span>{pct(change)}</span></div></div><div className="desk-live-actions"><button type="button" onClick={() => { setAlertValue(price ? String(price) : ''); setAlertOpen(true); }}><Bell size={13} />提醒</button><button type="button" onClick={() => setAuto(v => !v)} aria-pressed={!auto} aria-label={auto ? '暂停自动刷新' : '恢复自动刷新'}>{auto ? <Pause size={13} /> : <Play size={13} />}{auto ? '自动' : '暂停'}</button><button type="button" onClick={refresh} aria-label="刷新个股工作台"><RefreshCw size={14} /></button></div></div>
          <div className="desk-stat-grid">{[{ label: '今开', value: number(quote?.open) }, { label: '最高', value: number(quote?.high) }, { label: '最低', value: number(quote?.low) }, { label: '成交额', value: amount(quote?.amount) }, { label: '换手率', value: quote?.turnover == null ? '—' : quote.turnover.toFixed(2) + '%' }, { label: '量比', value: number(quote?.volumeRatio) }, { label: '市盈率 TTM', value: number(quote?.pe) }, { label: '总市值', value: amount(quote?.marketCap) }].map(stat => <div key={stat.label}><span>{stat.label}</span><b>{stat.value}</b></div>)}</div>
          <div className="desk-security-footer"><span>快照 {sourceDate} · 北京时间</span><span>较沪深300 <b className={tone(relativeStrength)}>{relativeStrength == null ? '—' : (relativeStrength >= 0 ? '+' : '') + relativeStrength.toFixed(2) + ' pct'}</b></span></div>
          {quotes.error && <Source text="" error={quote ? '刷新失败 · 当前保留上一行情快照' : quotes.error} />}
        </section>

        <section className="desk-chart-card"><Tabs.Root value={chartMode} onValueChange={setChartMode}>
          <div className="desk-chart-heading"><Tabs.List className="desk-tabs" aria-label="行情图表类型"><Tabs.Trigger value="intraday" disabled={!chinese}>分时</Tabs.Trigger><Tabs.Trigger value="daily">日 K</Tabs.Trigger><Tabs.Trigger value="week" disabled={!chinese || symbol.endsWith('.BJ')}>周 K</Tabs.Trigger><Tabs.Trigger value="month" disabled={!chinese || symbol.endsWith('.BJ')}>月 K</Tabs.Trigger></Tabs.List><span>MA · VOL · MACD · KDJ</span></div>
          <Tabs.Content value="daily">{market?.candles.length ? <MarketChart candles={market.candles} symbol={symbol} volumeUnit={market.provider.startsWith('腾讯') ? /^68[89]/.test(symbol) ? '股' : '手' : undefined} /> : marketError ? <><Empty text="原始K线暂不可用，保留第三方参考图" /><TradingViewWidget symbol={symbol} /></> : <Empty loading />}</Tabs.Content>
          {(['week','month'] as const).map(period=><Tabs.Content value={period} key={period}>{periodData.data?<MarketChart candles={periodData.data.candles} symbol={symbol} unit={period} volumeUnit={/^68[89]/.test(symbol)?'股':'手'}/>:<Empty loading={periodData.loading} text={periodData.error}/>}</Tabs.Content>)}
          <Tabs.Content value="intraday">{dayData.data ? <IntradayChart data={dayData.data} /> : <Empty loading={dayData.loading} text={dayData.error || '分时暂不可用'} />}{dayData.error && dayData.data && <Source text="" error="分时刷新失败，保留上一快照" />}</Tabs.Content>
        </Tabs.Root><div className="desk-chart-source"><span>{chartMode === 'daily' ? market?.provider || '等待日线数据' : chartMode === 'intraday' ? dayData.data?.source || '公开分钟分时' : periodData.data?.source || '等待周期历史'}</span><span>{chartMode === 'daily' ? market?.asOf : chartMode === 'intraday' ? dayData.data?.date : periodData.data?.candles.at(-1)?.time}</span></div></section>

        <section className="desk-context"><Tabs.Root value={contextTab} onValueChange={setContextTab}><Tabs.List className="desk-tabs desk-context-tabs" aria-label="个股关联数据">{[['sectors', '板块联动'], ['flow', '资金流'], ['news', '个股资讯'], ['reports', '机构研报'], ['evidence', '公告财报'], ['technical', '趋势观察']].map(([id, label]) => <Tabs.Trigger key={id} value={id}>{label}</Tabs.Trigger>)}</Tabs.List>
          <Tabs.Content value="sectors"><div className="desk-linkage-head"><div><Layers3 size={15} /><b>所属板块</b><span>{boards.length || '—'}</span></div><small>点击板块查看同板块标的</small></div>
            {boards.length ? <div className="desk-sector-chips">{boards.map(b => <button type="button" key={b.code} className={chosenBoard?.code === b.code ? 'active' : ''} onClick={() => {setExternalSector(null);setSectorCode(b.code);}}>{b.name}<span className={tone(b.changePercent)}>{pct(b.changePercent)}</span></button>)}</div> : <Empty loading={boardData.loading} text={chinese ? boardData.error || '来源暂无板块归属' : '当前公开板块接口覆盖 A 股'} />}
            <div className="desk-linkage-grid"><div><div className="desk-subheading"><b>{chosenBoard?.name || '板块成分'} · 领涨观察</b><span>{peerData.data?.delayMinutes ? '约15分钟延迟 · 涨幅排序' : '涨幅排序'}</span></div><div className="desk-table-scroll"><table className="desk-table"><thead><tr><th>名称</th><th>最新价</th><th>涨跌幅</th><th>主力净额</th></tr></thead><tbody>{peerData.data?.items.map(p => <tr key={p.symbol} onClick={() => onSelect(p.symbol)}><td><button type="button" onClick={() => onSelect(p.symbol)}>{p.name}<small>{p.symbol}</small></button></td><td>{number(p.price)}</td><td className={tone(p.changePercent)}>{pct(p.changePercent)}</td><td className={tone(p.mainNet)}>{amount(p.mainNet)}</td></tr>)}</tbody></table></div>{!peerData.data?.items.length && <Empty loading={peerData.loading} text={peerData.error || '选择板块以加载成分'} />}</div><div><div className="desk-subheading"><b>市场行业轮动</b><span>{rankData.data?.delayMinutes ? '约15分钟延迟' : '涨幅前20'}</span></div>{rankData.data?.items.slice(0, 9).map(renderSector)}{!rankData.data?.items.length && <Empty loading={rankData.loading} text={rankData.error} />}</div></div><Source text={[peerData.data?.source, rankData.data?.source].filter(Boolean).join(' · ') || '东方财富公开板块归属、成分与行业排名；板块归属混合行业、概念和地域。'} /></Tabs.Content>
          <Tabs.Content value="flow"><FlowPanel state={flowData} /></Tabs.Content>
          <Tabs.Content value="news"><NewsFeed items={companyNews.data?.items || []} loading={companyNews.loading} error={companyNews.error} /><Source text="东方财富个股代码检索 · 来源摘要 · 3分钟刷新" /></Tabs.Content>
          <Tabs.Content value="reports">{reportData.data?.items.length ? <div className="desk-reports">{reportData.data.items.map((r, i) => <button type="button" key={r.url + i} onClick={() => openNews({ id: r.url, title: r.title, publishedAt: r.date + 'T00:00:00+08:00', source: r.organization, url: r.url, category: 'all', originalTitle: r.title, summary: '机构：' + r.organization + (r.rating ? '；来源评级：' + r.rating : '') })}><span>{r.date}<b>{r.organization}</b></span><strong>{r.title}</strong><small>{r.rating || '未提供评级'} <ChevronRight size={13} /></small></button>)}</div> : <Empty loading={reportData.loading} text={reportData.error || '来源在当前窗口未列出研报'} />}<Source text="东方财富研报索引 · 评级保留来源表述" /></Tabs.Content>
          <Tabs.Content value="evidence"><StockResearchExtras symbol={symbol} onStock={onSelect} /></Tabs.Content>
          <Tabs.Content value="technical">{analysis ? <div className="desk-technical"><div className="desk-technical-head"><div><span>当前结构</span><strong>{analysis.stage}</strong></div><div><span>相对量能</span><strong>{number(analysis.volumeRatio)}×</strong></div><div><span>RSI 14</span><strong>{number(analysis.rsi)}</strong></div><div><span>ATR / 价格</span><strong>{number(analysis.atrPct)}%</strong></div></div>{analysis.dimensions.map(d => <div className="desk-technical-row" key={d.title}><b>{d.title}</b><span>{d.status}</span><p>{d.evidence.join(' · ')}</p></div>)}<Source text="此处沿用 MA5/10/20/60/120 历史观察规则；图表均线参数独立可调。" /></div> : <Empty text="需要有效日线历史" />}</Tabs.Content>
        </Tabs.Root></section>
      </div>

      <aside className="desk-right">
        <section className="desk-orderbook"><Tabs.Root value={bookTab} onValueChange={setBookTab}><div className="desk-block-heading"><Tabs.List className="desk-tabs" aria-label="盘口类型"><Tabs.Trigger value="book">五档盘口</Tabs.Trigger><Tabs.Trigger value="ticks">成交分笔</Tabs.Trigger></Tabs.List><Hint text="公开五档和约3秒聚合分笔；没有授权十档、逐笔委托队列或完整交易所 Level-2。" /></div>
          <Tabs.Content value="book"><Book quote={quote} loading={quotes.loading} error={quotes.error} /></Tabs.Content>
          <Tabs.Content value="ticks">{tickData.data?.items.length ? <><div className="desk-ticks-head"><span>时间</span><span>成交价</span><span>量（手）</span></div><div className="desk-ticks-list">{tickData.data.items.slice(0, 45).map(t => <div key={t.sequence}><time>{t.time}</time><b className={t.side === 'B' ? 'is-up' : t.side === 'S' ? 'is-down' : ''}>{number(t.price)}</b><span>{number(t.volume, 0)}<small>{t.side === 'B' ? 'B' : t.side === 'S' ? 'S' : '·'}</small></span></div>)}</div><Source text={(tickData.data.date || '') + ' · 最近一页 · 聚合分笔，非全日完整明细'} error={tickData.error} /></> : <Empty loading={tickData.loading} text={tickData.error || '暂无分笔数据'} />}</Tabs.Content>
        </Tabs.Root></section>
        <section className="desk-flash"><div className="desk-block-heading"><h2><Globe2 size={14} />7×24 快讯</h2><span className="desk-refresh-label">60s</span><button type="button" aria-label="刷新7×24快讯" className="desk-icon" onClick={flash.refresh}><RefreshCw size={13} /></button></div><div className="desk-flash-scroll"><NewsFeed compact items={flash.data?.items || []} loading={flash.loading} error={flash.error} /></div><Source text={(flash.data?.sources.join(' / ') || '财联社 / 华尔街见闻') + ' · ' + clock(flash.data?.fetchedAt)} error={flash.error || flash.data?.warnings.join('；')} /></section>
        <section className="desk-related"><div className="desk-block-heading"><h2>关联线索</h2><Layers3 size={14} /></div>{boards.slice(0, 5).map(renderSector)}{!boards.length && <Empty text={boardData.error || '等待板块归属'} />}</section>
      </aside>
    </div>
    <Dialog.Root open={alertOpen} onOpenChange={setAlertOpen}><Dialog.Portal><Dialog.Overlay className="desk-dialog-overlay" /><Dialog.Content className="desk-dialog"><Dialog.Title>价格提醒</Dialog.Title><Dialog.Description>规则保存在当前浏览器。本页打开、自动刷新开启且盘中快照有效时触发一次。</Dialog.Description><Dialog.Close asChild><button type="button" className="desk-dialog-close desk-icon" aria-label="关闭提醒设置"><X size={18} /></button></Dialog.Close><form onSubmit={event => { event.preventDefault(); const value = Number(alertValue); if (!chinese || !Number.isFinite(value) || value <= 0 || rules.filter(r => !r.firedAt).length >= 20) return; setRules(old => [...old, { id: crypto.randomUUID(), symbol, direction: alertDirection, value }]); setAlertValue(''); }}><label>监控标的<input value={name + ' · ' + symbol} readOnly /></label><div className="desk-alert-inputs"><label>触发条件<select value={alertDirection} onChange={event => setAlertDirection(event.target.value as 'above' | 'below')}><option value="above">价格达到或高于</option><option value="below">价格达到或低于</option></select></label><label>价格<input aria-label="提醒目标价格" type="number" min="0.001" step="0.001" required value={alertValue} onChange={event => setAlertValue(event.target.value)} /></label></div><button className="desk-primary-button" type="submit" disabled={!chinese || rules.filter(r => !r.firedAt).length >= 20}><Plus size={14} />添加提醒</button>{!chinese && <p>当前公开快照提醒只覆盖沪深北市场。</p>}</form><div className="desk-rule-list">{rules.map(rule => <div key={rule.id}><Bell size={13} /><span>{rule.symbol}<small>{rule.direction === 'above' ? '≥' : '≤'} {number(rule.value)} · {rule.firedAt ? '已触发' : '监控中'}</small></span><button type="button" className="desk-icon" aria-label={'删除提醒 ' + rule.symbol + ' ' + rule.value} onClick={() => setRules(old => old.filter(r => r.id !== rule.id))}><Trash2 size={14} /></button></div>)}</div></Dialog.Content></Dialog.Portal></Dialog.Root>
    {alertMessage && <div className="desk-alert-toast" role="status"><Bell size={17} /><span>{alertMessage}</span><button type="button" aria-label="关闭价格提醒通知" onClick={() => setAlertMessage('')}><X size={15} /></button></div>}
  </div></Tooltip.Provider>;
}
