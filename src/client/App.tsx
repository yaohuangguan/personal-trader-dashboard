import ResizeRail,{usePanelWidth} from './components/ResizeRail';
import type {CSSProperties} from 'react';
import WatchSidebar from './components/WatchSidebar';
import SignalCenter from './components/SignalCenter';
import {t as uiText} from './preferences';
import Settings from './components/Settings';
import MarketOverview from './components/MarketOverview';
import {usePreferences} from './preferences';
import * as Dialog from '@radix-ui/react-dialog';
import ScreenerWorkspace from './components/ScreenerWorkspace';
import ResearchDesk, { FlashNewsDesk } from './components/ResearchDesk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
 Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Bookmark, BookmarkCheck, CalendarDays,
 Check, ChevronRight, Clock3, Command, ExternalLink, FileText, Globe2, Layers3, BookOpen,
 LayoutDashboard, LineChart, LoaderCircle, Menu, Newspaper, Plus, Radar, RefreshCw,
 Star, Search, ShieldAlert, SlidersHorizontal, Target, TrendingUp, X, Zap
} from 'lucide-react';
import MarketChart from './components/MarketChart';
import TradingViewWidget from './components/TradingViewWidget';
import {useReader} from './components/InAppReader';
import PWAControls from './components/PWAControls';
import { OverviewIntelStrip, IntelHistory, StockResearchExtras } from './components/IntelPanels';
import { analyzeGuide } from '../shared/guide-analysis';
import { CATALOG, DEFAULT_WATCHLIST, NEWS_CATEGORIES, SECTORS, normalizeSymbol, searchLocal } from '../shared/catalog';
import type { MarketPayload, NewsItem, NewsPayload, SearchItem } from '../shared/types';

type View='overview'|'news'|'radar'|'markets'|'research'|'history'|'saved'|'screener'|'signals';
const NAV:[View,string,typeof Globe2][]=[
 ['research','个股工作台',Target],['screener','选股雷达',SlidersHorizontal],['signals','收盘信号',Bell],['markets','市场全景',LineChart],['news','7×24 快讯',Globe2],
 ['overview','情报总览',LayoutDashboard],['radar','产业联动',Radar],['history','事件档案',Clock3],['saved','收藏情报',Bookmark]
];
function readStored<T>(key:string,fallback:T):T{
 try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw) as T:fallback;}catch{return fallback;}
}
const money=(value:number|null|undefined,digits=2)=>value==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value);
const percent=(value:number|null|undefined)=>value==null?'—':(value>=0?'+':'')+value.toFixed(2)+'%';
const changeClass=(value:number|null|undefined)=>value==null?'muted':value>=0?'positive':'negative';
const dateTime=(v:string|null|undefined)=>!v?'时间未知':new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Pacific/Auckland'}).format(new Date(v));
const relative=(v:string|null|undefined)=>{
 if(!v)return '时间未知';
 const diff=Math.max(0,Date.now()-new Date(v).getTime()),m=Math.floor(diff/60000);
 if(m<1)return '刚刚';if(m<60)return m+' 分钟前';if(m<1440)return Math.floor(m/60)+' 小时前';return Math.floor(m/1440)+' 天前';
};
async function api<T>(path:string,signal?:AbortSignal):Promise<T>{
 const r=await fetch(path,{signal,headers:{accept:'application/json'}});
 const data=await r.json() as T&{error?:string;details?:string};
 if(!r.ok)throw new Error(data.details?data.error+': '+data.details:data.error||('HTTP '+r.status));
 return data;
}
function matchSectors(item:NewsItem){
 const lower=item.title.toLowerCase();
 return SECTORS.filter(s=>item.category===s.id||s.words.some(w=>lower.includes(w.toLowerCase())));
}
function sourceDomain(url:string):string{try{return new URL(url).hostname.replace('www.','');}catch{return '';}}

function Logo(){return <div className="brand-mark"><Activity size={22} strokeWidth={2.8}/></div>;}
function SectionHeading({eyebrow,title,right}:{eyebrow:string;title:string;right?:React.ReactNode}){
 return <div className="section-heading"><div><div className="eyebrow">{uiText(eyebrow)}</div><h2>{uiText(title)}</h2></div>{uiText(right)}</div>;
}
function StatusNote({children}:{children:React.ReactNode}){return <div className="status-note"><ShieldAlert size={15}/><span>{uiText(children)}</span></div>;}
function Blank({title,detail,loading=false}:{title:string;detail:string;loading?:boolean}){
 return <div className="empty-state">{uiText(loading?<LoaderCircle size={25} className="spin"/>:<Globe2 size={25}/>)}<strong>{uiText(title)}</strong><p>{uiText(detail)}</p></div>;
}
function NewsRow({item,save,saved,major=false}:{item:NewsItem;save:(n:NewsItem)=>void;saved:boolean;major?:boolean}){
 const sectors=matchSectors(item).slice(0,2);
 const {openNews}=useReader();
 return <article className={'news-row '+(major?'news-major':'')}>
  <div className="news-copy">
   <div className="news-meta"><span className="source-dot"/><strong>{uiText(item.source)}</strong><span className="separator-dot">·</span><span title={uiText(item.publishedAt||'')}>{uiText(relative(item.publishedAt))}</span>{uiText(sectors.map(s=><span key={s.id} className="tag-neutral">{uiText(s.name)}</span>))}</div>
   <button type="button" onClick={()=>openNews(item)} className="news-title inapp-news-button">{(item.title)}<BookOpen size={13} className="inline-external"/></button>
   {uiText(major&&<div className="news-extra">{uiText("来源：")}{uiText(sourceDomain(item.url))} {uiText("· 点击在本站阅读当前可用摘要")}</div>)}
  </div>
  <button aria-label={uiText(saved?'取消收藏':'收藏新闻')} title={uiText(saved?'取消收藏':'收藏')} className={'icon-button news-save '+(saved?'saved':'')} onClick={()=>save(item)}>{uiText(saved?<BookmarkCheck size={17}/>:<Bookmark size={17}/>)}</button>
 </article>;
}
function QuoteLine({data,selected,onClick}:{data?:MarketPayload;selected?:boolean;onClick:()=>void}){
 const last=data?.last,delta=data?.changePercent;
 return <button className={'quote-line '+(selected?'selected':'')} onClick={onClick}>
  <span className="quote-symbol">{uiText(data?.symbol||'—')}<small>{(data?.name||uiText('加载行情中'))}</small></span>
  <span className="quote-price"><b>{uiText(money(last))}</b><small className={changeClass(delta)}>{uiText(percent(delta))}</small></span>
 </button>;
}
function QuoteCard({symbol,data,onClick}:{symbol:string;data?:MarketPayload;onClick:()=>void}){
 const known=CATALOG.find(x=>x.symbol===symbol);
 return <button className="market-card" onClick={onClick}>
  <span className="market-card-head"><b>{uiText(symbol)}</b><ChevronRight size={14}/></span>
  <span className="market-card-name">{(known?.name||symbol)}</span>
  <span className="market-card-bottom"><strong>{uiText(money(data?.last))}</strong><span className={changeClass(data?.changePercent)}>{uiText(percent(data?.changePercent))}</span></span>
  <small>{uiText(data?.asOf?'日线 '+data.asOf:'等待真实报价')}</small>
 </button>;
}
export default function App(){
 usePreferences();
 const [watchWidth,setWatchWidth]=usePanelWidth('atlas.watch-width.v1',innerWidth>=1600?360:innerWidth<=1200?320:340,320,560);
 const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>readStored('atlas.sidebar-collapsed.v1',false));
 useEffect(()=>{localStorage.setItem('atlas.sidebar-collapsed.v1',JSON.stringify(sidebarCollapsed));},[sidebarCollapsed]);
 const [view,setView]=useState<View>(()=>{
  const params=new URLSearchParams(window.location.search),requested=params.get('view');
  if((['overview','news','radar','markets','research','history','saved','screener','signals'] as string[]).includes(requested||''))return requested as View;
  return params.get('symbol')?.trim()?'research':'markets';
 });
 const [mobileNav,setMobileNav]=useState(false);const [workspaceNav,setWorkspaceNav]=useState(false);
 const [watchlist,setWatchlist]=useState<string[]>(()=>readStored('atlas.watchlist.v1',DEFAULT_WATCHLIST));
 useEffect(()=>{const load=()=>setWatchlist(readStored('atlas.watchlist.v1',DEFAULT_WATCHLIST));window.addEventListener('atlas:watch-cloud',load);return()=>window.removeEventListener('atlas:watch-cloud',load);},[]);
 const [saved,setSaved]=useState<NewsItem[]>(()=>readStored('atlas.bookmarks.v1',[]));
 const [selected,setSelected]=useState(()=>{const sym=new URLSearchParams(window.location.search).get('symbol');return sym?normalizeSymbol(sym):readStored('atlas.last-symbol.v1','300545.SZ');});
 const [markets,setMarkets]=useState<Record<string,MarketPayload>>({});
 const [marketErrors,setMarketErrors]=useState<Record<string,string>>({});
 const [newsCategory,setNewsCategory]=useState('all');
 const [newsData,setNewsData]=useState<NewsPayload|null>(null);
 const [newsLoading,setNewsLoading]=useState(true);
 const [newsError,setNewsError]=useState('');
 const [searchQuery,setSearchQuery]=useState('');
 const [searchOpen,setSearchOpen]=useState(false);
 const [remoteResults,setRemoteResults]=useState<SearchItem[]>([]);
 const [refreshKey,setRefreshKey]=useState(0);
 const [clock,setClock]=useState(new Date());
 const searchRef=useRef<HTMLInputElement>(null);
 const news=useMemo(()=>newsData?.items||[],[newsData]);
 const savedIds=useMemo(()=>new Set(saved.map(x=>x.url)),[saved]);
 const selectedData=markets[selected];
 const activeWatch=useMemo(()=>Array.from(new Set([selected,...watchlist])).slice(0,14),[selected,watchlist]);
 const analysis=useMemo(()=>selectedData?analyzeGuide(selectedData.candles):null,[selectedData]);
 const watchAnalyses=useMemo<Record<string,ReturnType<typeof analyzeGuide>>>(()=>view==='markets'?Object.fromEntries(watchlist.filter(symbol=>markets[symbol]).map(symbol=>[symbol,analyzeGuide(markets[symbol].candles)])):{},[view,watchlist,markets]);
 useEffect(()=>{localStorage.setItem('atlas.watchlist.v1',JSON.stringify(watchlist));window.dispatchEvent(new Event('atlas:watch-local'));},[watchlist]);
 useEffect(()=>{localStorage.setItem('atlas.bookmarks.v1',JSON.stringify(saved));},[saved]);
 useEffect(()=>{const t=setInterval(()=>setClock(new Date()),60000);return ()=>clearInterval(t);},[]);
 useEffect(()=>{
  const handler=(e:KeyboardEvent)=>{
   const target=e.target as HTMLElement;
   const editing=['INPUT','TEXTAREA'].includes(target?.tagName)||target?.isContentEditable;
   if(((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k')||(e.key==='/'&&!editing)){e.preventDefault();setSearchOpen(true);searchRef.current?.focus();}
   if(e.key==='Escape')setSearchOpen(false);
  };
  window.addEventListener('keydown',handler);return ()=>window.removeEventListener('keydown',handler);
 },[]);
 useEffect(()=>{
  const ac=new AbortController();
  const symbols=activeWatch;
  Promise.all(symbols.map(async symbol=>{
   try{
    const data=await api<MarketPayload>('/api/market?symbol='+encodeURIComponent(symbol),ac.signal);
    if(!ac.signal.aborted)setMarkets(prev=>({...prev,[symbol]:data}));
   }catch(e){if(!ac.signal.aborted)setMarketErrors(prev=>({...prev,[symbol]:e instanceof Error?e.message:String(e)}));}
  })).catch(()=>{});
  return ()=>ac.abort();
 },[activeWatch,refreshKey]);
 useEffect(()=>{
  if(view==='research'||view==='screener'||view==='news'&&newsCategory==='all')return;
  const ac=new AbortController();setNewsLoading(true);setNewsError('');setNewsData(null);
  api<NewsPayload>('/api/news?category='+encodeURIComponent(newsCategory),ac.signal)
   .then(data=>{if(!ac.signal.aborted)setNewsData(data);})
   .catch(e=>{if(!ac.signal.aborted)setNewsError(e instanceof Error?e.message:String(e));})
   .finally(()=>{if(!ac.signal.aborted)setNewsLoading(false);});
  return ()=>ac.abort();
 },[newsCategory,refreshKey,view]);
 useEffect(()=>{
  if(!searchQuery.trim()){setRemoteResults([]);return;}
  const ac=new AbortController();setRemoteResults([]);
  const timeout=setTimeout(()=>{
   api<{items:SearchItem[]}>('/api/search?q='+encodeURIComponent(searchQuery),ac.signal)
    .then(data=>{if(!ac.signal.aborted)setRemoteResults(data.items);}).catch(()=>{});
  },250);
  return ()=>{clearTimeout(timeout);ac.abort();};
 },[searchQuery]);
 const chooseSymbol=useCallback((symbol:string)=>{
  setWorkspaceNav(false);const normalized=normalizeSymbol(symbol);setSelected(normalized);setView('research');setSearchOpen(false);setSearchQuery('');
  try{localStorage.setItem('atlas.last-symbol.v1',JSON.stringify(normalized));}catch{/* storage unavailable */}
  window.history.replaceState(null,'','?symbol='+encodeURIComponent(normalized));
  window.scrollTo({top:0,behavior:'smooth'});
 },[]);
 const toggleWatch=useCallback((symbol:string)=>setWatchlist(prev=>prev.includes(symbol)?prev.filter(x=>x!==symbol):[symbol,...prev].slice(0,30)),[]);
 const toggleSave=useCallback((item:NewsItem)=>setSaved(prev=>prev.some(x=>x.url===item.url)?prev.filter(x=>x.url!==item.url):[item,...prev].slice(0,200)),[]);
 const changeView=useCallback((v:View)=>{if(v==='research')setWorkspaceNav(false);setView(v);setMobileNav(false);const url=new URL(window.location.href);url.searchParams.set('view',v);window.history.replaceState(null,'',url.pathname+url.search);window.scrollTo({top:0,behavior:'smooth'});},[]);
 useEffect(()=>{const open=()=>changeView('signals');window.addEventListener('atlas:monitor-pool',open);return()=>window.removeEventListener('atlas:monitor-pool',open);},[changeView]);
 const searchOptions=useMemo(()=>{
  const list=remoteResults.length?remoteResults:searchLocal(searchQuery);
  const seen=new Set<string>();return list.filter(x=>{if(seen.has(x.symbol))return false;seen.add(x.symbol);return true;}).slice(0,12);
 },[remoteResults,searchQuery]);
 const currentTime=new Intl.DateTimeFormat('en-NZ',{weekday:'short',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Pacific/Auckland'}).format(clock);
 const sectorCount=(id:string)=>news.filter(n=>n.category===id).length;
 const visibleArticles=view==='saved'?saved:news;
 const highlighted=visibleArticles.slice(0,1)[0];
 const focusedThemes=SECTORS.map(sector=>({sector,items:news.filter(n=>n.category===sector.id || sector.words.some(w=>n.title.toLowerCase().includes(w.toLowerCase())))}));
 const showNews=(category:string)=>{setNewsCategory(category);changeView('news');};

 return <div style={{'--watch-rail':watchWidth+'px'} as CSSProperties} className={'app-shell '+(view==='research'?'stock-workspace-shell':'')+(view==='research'&&!workspaceNav?' has-watch-sidebar':'')+(sidebarCollapsed?' sidebar-is-collapsed':'')}>
  <aside className={'sidebar '+(mobileNav?'mobile-open':'')}>
   <div className="brand"><Logo/><div className="brand-copy"><strong>观澜 · ATLAS</strong><span>MARKET RESEARCH</span></div><button className="desktop-collapse icon-button" aria-label={uiText(sidebarCollapsed?'展开侧栏':'收起侧栏')} aria-expanded={!sidebarCollapsed} onClick={()=>setSidebarCollapsed(v=>!v)}><ChevronRight size={18} style={{transform:sidebarCollapsed?undefined:'rotate(180deg)'}}/></button><button className="mobile-close icon-button" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
   {view==='research'&&!workspaceNav?<WatchSidebar watchlist={watchlist} markets={markets} selected={selected} onStock={chooseSymbol} onSearch={()=>setSearchOpen(true)} onRemove={toggleWatch} onWorkspace={()=>setWorkspaceNav(true)} onClose={()=>setMobileNav(false)}/>:<><div className="nav-label">WORKSPACE</div>
   <nav className="nav-list">{uiText(NAV.map(([id,label,Icon])=><button key={id} onClick={()=>{if(id==='news')setNewsCategory('all');changeView(id);}} className={'nav-item '+(view===id?'active':'')}><Icon size={17}/><span>{uiText(label)}</span>{uiText(id==='saved'&&saved.length>0&&<small className="nav-count">{uiText(saved.length)}</small>)}</button>))}</nav>
   <div className="sidebar-section">
    <div className="sidebar-section-head">SECTOR WATCH <Radar size={13}/></div>
    {uiText(SECTORS.map((s,i)=><button key={s.id} className="sector-nav-item" onClick={()=>showNews(s.id)}><span className="sector-index">0{uiText(i+1)}</span><span>{uiText(s.name)}</span><ChevronRight size={13}/></button>))}
   </div>
   <div className="sidebar-bottom"><div className="connection-icon"><span className="pulse-dot"/> RESEARCH FEEDS</div><p>{uiText("全球情报 · A股 / 美股 · 原始资料核验")}</p><small>{uiText("公开快照 · 五档 / 分笔 · 非授权Level-2")}</small></div>
{view==='research'&&<button className="watch-workspace-button" onClick={()=>setWorkspaceNav(false)}><Star size={18}/>{uiText('返回自选列表')}</button>}</>}
  </aside>
  {view==='research'&&!workspaceNav&&!sidebarCollapsed&&<ResizeRail className="watch-resize-rail" label="调整自选列表宽度" width={watchWidth} onChange={setWatchWidth} defaultWidth={innerWidth>=1600?360:340} min={320} max={()=>Math.min(560,innerWidth-(document.querySelector('.desk-right')?.getBoundingClientRect().width||350)-384)}/>}
  {uiText(mobileNav&&<button className="mobile-shade" aria-label={uiText("关闭导航")} onClick={()=>setMobileNav(false)}/>)}
  <div className="workspace">
   <header className="topbar">
    <div className="top-left"><button className="icon-button mobile-menu" aria-label={uiText("打开导航")} onClick={()=>setMobileNav(true)}><Menu size={20}/></button><span className="crumb">MARKET DESK</span><ChevronRight size={14}/><strong>{uiText(NAV.find(n=>n[0]===view)?.[1])}</strong></div>
    <div className="top-right">
     <span className="time-label"><span className="pulse-dot"/> AKL {uiText(currentTime)}</span>
     <Settings/><PWAControls/>
     <button onClick={()=>{setRefreshKey(v=>v+1);window.dispatchEvent(new Event('atlas:refresh'));}} className="icon-button" aria-label={uiText("刷新所有数据")} title={uiText("刷新数据")}><RefreshCw size={17}/></button>
     <span className="top-divider"/>
     <button className="search-trigger" onClick={()=>{setSearchOpen(true);searchRef.current?.focus();}}><Search size={16}/><span>{uiText("搜索全球股票 / 代码")}</span><kbd>⌘ K</kbd></button>
    </div>
   </header>
   <main className={'main '+(view==='research'?'desk-main':'')}>
    {uiText(<ScreenerWorkspace active={view==='screener'} onOpen={()=>changeView('screener')} watchlist={watchlist} onStock={chooseSymbol} onWatch={toggleWatch}/>)}
    {uiText(view==='overview'&&<>
     <section className="page-heading">
      <div><div className="eyebrow"><span className="eyebrow-accent">●</span> YOUR GLOBAL INTELLIGENCE TERMINAL</div><h1>{uiText("全局情报")}<span className="title-dim">{uiText("，尽在掌握。")}</span></h1><p>{uiText("从世界事件到产业链，从上市公司披露到股价信号。先看事实，再判断影响。")}</p></div>
      <div className="heading-extra"><Globe2 size={14}/> GLOBAL COVERAGE <span className="accent-tiny">/</span> 7 SECTORS</div>
     </section>
     <OverviewIntelStrip onOpen={()=>changeView("history")}/>
     <div className="global-tape"><div className="tape-top"><span className="eyebrow">CROSS-ASSET MONITOR</span><span>{uiText("第三方行情组件 · 可能延迟")}</span></div><TradingViewWidget kind="tape"/></div>
     <div className="overview-grid">
      <div className="overview-main">
       <div className="panel hero-news">
        <div className="panel-heading"><div><span className="eyebrow">WORLD SIGNAL / 01</span><h2>{uiText("全球信息流")}</h2></div><button className="text-link" onClick={()=>changeView('news')}>{uiText("查看全部")}<ArrowRight size={15}/></button></div>
        {uiText(newsLoading?<Blank loading title={uiText("汇聚全球新闻源")} detail={uiText("正在读取最新公开报道并去除重复标题")}/>:
         newsError?<Blank title={uiText("新闻数据暂时不可用")} detail={uiText(newsError)}/>:
         news.length===0?<Blank title={uiText("暂无可用新闻")} detail={uiText("当前 RSS 未返回有效数据，可稍后刷新或检查数据源")}/>:
         <div className="hero-news-list">
          {uiText(highlighted&&<div className="featured-story"><div className="featured-glow"/><div className="featured-overline"><Zap size={14}/> LATEST GLOBAL SIGNAL</div><div className="featured-content"><NewsRow item={highlighted} save={toggleSave} saved={savedIds.has(highlighted.url)} major/></div></div>)}
          {uiText(news.slice(1,8).map(x=><NewsRow key={x.id} item={x} save={toggleSave} saved={savedIds.has(x.url)}/>))}
         </div>)}
        <div className="panel-bottom"><span>{uiText("公开新闻源 · 原文可溯 ·")}{uiText(newsData?.fetchedAt?'更新 '+dateTime(newsData.fetchedAt):'等待更新')}</span><button onClick={()=>changeView('news')}>{uiText("全部资讯")}<ArrowRight size={13}/></button></div>
       </div>
       <div className="panel">
        <div className="panel-heading"><div><span className="eyebrow">CATALYST MONITOR / 02</span><h2>{uiText("七大产业链脉搏")}</h2></div><button className="text-link" onClick={()=>changeView('radar')}>{uiText("产业研究")}<ArrowRight size={15}/></button></div>
        <div className="sector-overview-grid">{uiText(SECTORS.map((s,i)=><button key={s.id} className="sector-tile" onClick={()=>showNews(s.id)}>
         <div className="sector-tile-top"><span className="sector-tile-index">0{uiText(i+1)} /</span><Radar size={15}/></div>
         <strong>{uiText(s.name)}</strong><small>{uiText(s.en)}</small>
         <div className="sector-tile-bottom"><span>{uiText(sectorCount(s.id))} {uiText("条线索")}</span><ArrowUpRight size={16}/></div>
        </button>))}</div>
        <StatusNote>{uiText("线索数量不代表产业景气或订单兑现。报道必须核查原始公告、订单、价格、收入和利润证据。")}</StatusNote>
       </div>
      </div>
      <div className="overview-side">
       <div className="panel">
        <div className="panel-heading compact"><div><span className="eyebrow">FOCUS LIST / 03</span><h2>{uiText("市场关注")}</h2></div><button className="icon-button" title={uiText("打开自选股")} onClick={()=>changeView('markets')}><ChevronRight size={18}/></button></div>
        {uiText(watchlist.every(symbol=>!markets[symbol]?.last)?<><TradingViewWidget kind="quotes" symbols={watchlist.slice(0,8)}/><div className="widget-note">{uiText("TradingView 第三方参考行情 · 可能延迟，点击右上角进入本站个股研究。")}</div></>:<div className="quote-lines">{uiText(watchlist.slice(0,8).map(symbol=><QuoteLine key={symbol} selected={selected===symbol} data={markets[symbol]||{symbol,name:CATALOG.find(c=>c.symbol===symbol)?.name||symbol} as MarketPayload} onClick={()=>chooseSymbol(symbol)}/>))}</div>)}
        <div className="panel-bottom"><span>{uiText("真实日线 · 收盘价")}</span><button onClick={()=>changeView('markets')}>{uiText("管理自选")}<ArrowRight size={13}/></button></div>
       </div>
       <div className="panel focus-spotlight">
        <div className="panel-heading compact"><div><span className="eyebrow">TECHNICAL FOCUS / 04</span><h2>{uiText("技术结构观察")}</h2></div><Activity size={17} className="accent-icon"/></div>
        <div className="spotlight-symbol"><strong>{uiText(selected)}</strong><span>{(selectedData?.name||uiText('等待行情'))}</span></div>
        <div className="spotlight-price"><strong>{uiText(money(selectedData?.last))}</strong><span className={changeClass(selectedData?.changePercent)}>{uiText(percent(selectedData?.changePercent))}</span></div>
        {uiText(selectedData?<MarketChart candles={selectedData.candles} compact/>:<Blank loading={!marketErrors[selected]} title={uiText("正在读取历史行情")} detail={uiText(marketErrors[selected]||'数据不可用时不会显示假走势图')}/>)}
        <div className="spotlight-signals">
         <div><span>{uiText("五线状态")}</span><b>{uiText(analysis?.stage||'等待数据')}</b></div>
         <div><span>{uiText("相对量能")}</span><b>{uiText(analysis?.volumeRatio?analysis.volumeRatio.toFixed(2)+'×':'—')}</b></div>
        </div>
        <button className="primary-action" onClick={()=>changeView('research')}>{uiText("打开完整个股研究")}<ArrowRight size={16}/></button>
       </div>
       <div className="source-disclosure"><ShieldAlert size={16}/><div><b>{uiText("数据可信度优先")}</b><p>{uiText("新闻展示来源与时间；K 线属于日线研究数据，不能用作实时交易决策。数据不可用时不生成虚假内容。")}</p></div></div>
      </div>
     </div>
    </>)}
    {uiText(view==='news'&&newsCategory==='all'&&<FlashNewsDesk/>)}
    {uiText(view==='news'&&newsCategory!=='all'&&<>
     <SectionHeading eyebrow="GLOBAL EVENTS / LIVE FEEDS" title={uiText("全球事件情报")} right={<span className="small-metadata"><Clock3 size={14}/> {uiText(newsData?'最后抓取 '+dateTime(newsData.fetchedAt):'尚未获取')}</span>}/>
     <p className="section-subtitle">{uiText("从全球宏观、政策、科技突破到产业订单线索。按时间排序的原始报道，并非自动确认的投资结论。")}</p>
     <div className="chip-row">{uiText(NEWS_CATEGORIES.map(c=><button key={c.id} className={'chip '+(newsCategory===c.id?'selected':'')} onClick={()=>setNewsCategory(c.id)}>{uiText(c.name)}</button>))}</div>
     <div className="panel article-panel">
      <div className="list-toolbar"><div><span className="eyebrow">LATEST ARTICLES</span><b>{uiText(newsData?.items.length||0)} {uiText("条")}</b></div><span>{uiText("按发布时间 · 新→旧")}</span></div>
      {uiText(newsLoading?<Blank loading title={uiText("正在读取相关新闻")} detail={uiText("正在请求公开新闻 RSS")}/>:newsError?<Blank title={uiText("新闻源暂时不可用")} detail={uiText(newsError)}/>:
       visibleArticles.length===0?<Blank title={uiText("当前没有检索到新闻")} detail={uiText("换个主题或稍后刷新")}/>:
       visibleArticles.map(x=><NewsRow key={x.id} item={x} save={toggleSave} saved={savedIds.has(x.url)} />))}
      {uiText(newsData?.warnings.length?<div className="feed-errors">{uiText(newsData.warnings.map((w,i)=><StatusNote key={i}>{uiText("新闻源异常：")}{uiText(w)}</StatusNote>))}</div>:null)}
     </div>
    </>)}
    {uiText(view==='radar'&&<>
     <SectionHeading eyebrow="THESIS MONITOR / SEVEN INDUSTRY CHAINS" title={uiText("产业催化雷达")} right={<div className="heading-extra"><Radar size={14}/> WATCHING 07 CHAINS</div>}/>
     <p className="section-subtitle">{uiText("扫描媒体线索，拆解美股领先信号与 A 股映射；区分叙事、订单验证、收入确认与利润兑现。")}</p>
     <div className="thesis-method"><div><span>01</span><b>{uiText("事件与事实")}</b><small>{uiText("原始信息 / 发生时间")}</small></div><ArrowRight size={17}/><div><span>02</span><b>{uiText("供需 / 订单")}</b><small>{uiText("谁真正获得商业利益")}</small></div><ArrowRight size={17}/><div><span>03</span><b>{uiText("收入 / 利润")}</b><small>{uiText("财务披露验证兑现")}</small></div><ArrowRight size={17}/><div><span>04</span><b>{uiText("估值 / 股价")}</b><small>{uiText("预期是否已经反映")}</small></div></div>
     {uiText(newsLoading&&<Blank loading title={uiText("扫描七大产业链")} detail={uiText("聚合来自公开新闻源的产业新闻")}/>)}
     {uiText(!newsLoading&&<div className="radar-grid">{uiText(focusedThemes.map(({sector,items},i)=><div className="panel radar-panel" key={sector.id}>
      <div className="radar-head"><div><span className="eyebrow">CHAIN 0{uiText(i+1)} / 07</span><h3>{uiText(sector.name)}</h3><small>{uiText(sector.en)}</small></div><div className="radar-qty"><strong>{uiText(items.length)}</strong><small>{uiText("相关线索")}</small></div></div>
      <div className="radar-coverage"><b>{uiText("关注标的")}</b><div>{uiText(sector.tickers.map(t=><button key={t} onClick={()=>chooseSymbol(t)}>{uiText(t)}<ArrowUpRight size={11}/></button>))}</div></div>
      {uiText(items.length?items.slice(0,3).map(x=><NewsRow key={x.id} item={x} save={toggleSave} saved={savedIds.has(x.url)}/>):<div className="radar-none">{uiText("该主题目前没有从订阅源取得新线索；不能据此认定产业没有变化。")}</div>)}
      <div className="radar-footer"><span className="pending-dot"/> {uiText("媒体线索 · 尚未完成订单 / 财报验证")}<button onClick={()=>showNews(sector.id)}>{uiText("展开")}<ArrowRight size={13}/></button></div>
     </div>))}</div>)}
     <StatusNote>{uiText("这是事实收集与跟踪工具，不会因报道提及某公司就宣称其订单、收入或利润已兑现。需结合公告、财报和其他独立证据。")}</StatusNote>
    </>)}
    {view==='signals'&&<SignalCenter watchlist={watchlist} onStock={chooseSymbol}/>}
    {uiText(view==='markets'&&<MarketOverview onStock={chooseSymbol} onWatch={toggleWatch} watchlist={watchlist}/>)}
    {uiText(view==='research'&&<ResearchDesk symbol={selected} market={selectedData} marketError={marketErrors[selected]} markets={markets} watchlist={watchlist} onSelect={chooseSymbol} onToggleWatch={toggleWatch} onSearch={()=>{setSearchOpen(true);searchRef.current?.focus();}} onRefresh={()=>setRefreshKey(v=>v+1)}/>)}
    {uiText(view==='history'&&<IntelHistory onStock={chooseSymbol}/>)}
    {uiText(view==='saved'&&<>
     <SectionHeading eyebrow="PRIVATE RESEARCH LIBRARY" title={uiText("收藏情报")} right={<span className="small-metadata">{uiText(saved.length)} {uiText("条已保存")}</span>}/>
     <p className="section-subtitle">{uiText("快速保存值得二次验证的原始报道；只存当前浏览器，不会上传你的研究列表。")}</p>
     <div className="panel article-panel">{uiText(saved.length?saved.map(x=><NewsRow key={x.url} item={x} save={toggleSave} saved/>):<Blank title={uiText("还没有收藏情报")} detail={uiText("打开全球快讯，点击书签图标保存重要新闻")}/>)}</div>
    </>)}
    <footer className="app-footer"><span>观澜 · MARKET ATLAS <i>·</i> PERSONAL RESEARCH</span><span>{uiText("公开来源研究 · 非实时交易数据 · 非投资建议")}</span></footer>
   </main>
  </div>
  <Dialog.Root open={searchOpen} onOpenChange={setSearchOpen}><Dialog.Portal><Dialog.Overlay className="search-overlay"/>
   <Dialog.Content className="command-modal" aria-label={uiText("股票搜索")}><Dialog.Title className="sr-only">{uiText("搜索股票")}</Dialog.Title><Dialog.Description className="sr-only">{uiText("输入股票代码或名称，选择结果后打开个股工作台。")}</Dialog.Description>
    <div className="command-head"><Search size={20}/><input ref={searchRef} autoFocus placeholder={uiText("搜索股票名称、代码，例如 NVDA / 300308 / 中际旭创")} value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&searchOptions[0])chooseSymbol(searchOptions[0].symbol);}}/><button className="command-esc" onClick={()=>setSearchOpen(false)}>ESC</button></div>
    <div className="command-options"><div className="eyebrow">SECURITIES / {uiText(searchQuery?'SEARCH RESULTS':'QUICK ACCESS')}</div>
     {uiText(searchOptions.length?searchOptions.map(x=><button key={x.symbol} className="command-result" onClick={()=>chooseSymbol(x.symbol)}><span className="command-symbol">{uiText(x.symbol)}</span><span className="command-name">{(x.name)}<small>{uiText(x.exchange)} {uiText(x.sector?'· '+x.sector:'')}</small></span><ArrowRight size={15}/></button>):<p className="helper-text">{uiText("未找到匹配标的。可输入交易所代码并按回车尝试获取行情。")}</p>)}
    </div>
    <div className="command-footer"><span><kbd>↵</kbd> {uiText("进入个股")}</span><span><kbd>ESC</kbd> {uiText("退出搜索")}</span><span><kbd>⌘ K</kbd> {uiText("快速打开")}</span></div>
   </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
 </div>;
}
