import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
 Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Bookmark, BookmarkCheck, CalendarDays,
 Check, ChevronRight, Clock3, Command, ExternalLink, FileText, Globe2, Layers3,
 LayoutDashboard, LineChart, LoaderCircle, Menu, Newspaper, Plus, Radar, RefreshCw,
 Search, ShieldAlert, SlidersHorizontal, Target, TrendingUp, X, Zap
} from 'lucide-react';
import MarketChart from './components/MarketChart';
import TradingViewWidget from './components/TradingViewWidget';
import { analyzeCandles } from '../shared/analysis';
import { CATALOG, DEFAULT_WATCHLIST, NEWS_CATEGORIES, SECTORS, normalizeSymbol, searchLocal } from '../shared/catalog';
import type { FundamentalsPayload, MarketPayload, NewsItem, NewsPayload, SearchItem } from '../shared/types';

type View='overview'|'news'|'radar'|'markets'|'research'|'saved';
const NAV:[View,string,typeof Globe2][]=[
 ['overview','情报总览',LayoutDashboard],['news','全球快讯',Globe2],['radar','产业催化',Radar],
 ['markets','市场观察',LineChart],['research','个股研究',Target],['saved','收藏情报',Bookmark]
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
 return <div className="section-heading"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>{right}</div>;
}
function StatusNote({children}:{children:React.ReactNode}){return <div className="status-note"><ShieldAlert size={15}/><span>{children}</span></div>;}
function Blank({title,detail,loading=false}:{title:string;detail:string;loading?:boolean}){
 return <div className="empty-state">{loading?<LoaderCircle size={25} className="spin"/>:<Globe2 size={25}/>}<strong>{title}</strong><p>{detail}</p></div>;
}
function NewsRow({item,save,saved,major=false}:{item:NewsItem;save:(n:NewsItem)=>void;saved:boolean;major?:boolean}){
 const sectors=matchSectors(item).slice(0,2);
 return <article className={'news-row '+(major?'news-major':'')}>
  <div className="news-copy">
   <div className="news-meta"><span className="source-dot"/><strong>{item.source}</strong><span className="separator-dot">·</span><span title={item.publishedAt||''}>{relative(item.publishedAt)}</span>{sectors.map(s=><span key={s.id} className="tag-neutral">{s.name}</span>)}</div>
   <a href={item.url} target="_blank" rel="noopener noreferrer" className="news-title">{item.title}<ExternalLink size={12} className="inline-external"/></a>
   {major&&<div className="news-extra">源站：{sourceDomain(item.url)} · 点击阅读原文以核实完整上下文</div>}
  </div>
  <button aria-label={saved?'取消收藏':'收藏新闻'} title={saved?'取消收藏':'收藏'} className={'icon-button news-save '+(saved?'saved':'')} onClick={()=>save(item)}>{saved?<BookmarkCheck size={17}/>:<Bookmark size={17}/>}</button>
 </article>;
}
function QuoteLine({data,selected,onClick}:{data?:MarketPayload;selected?:boolean;onClick:()=>void}){
 const last=data?.last,delta=data?.changePercent;
 return <button className={'quote-line '+(selected?'selected':'')} onClick={onClick}>
  <span className="quote-symbol">{data?.symbol||'—'}<small>{data?.name||'加载行情中'}</small></span>
  <span className="quote-price"><b>{money(last)}</b><small className={changeClass(delta)}>{percent(delta)}</small></span>
 </button>;
}
function QuoteCard({symbol,data,onClick}:{symbol:string;data?:MarketPayload;onClick:()=>void}){
 const known=CATALOG.find(x=>x.symbol===symbol);
 return <button className="market-card" onClick={onClick}>
  <span className="market-card-head"><b>{symbol}</b><ChevronRight size={14}/></span>
  <span className="market-card-name">{known?.name||symbol}</span>
  <span className="market-card-bottom"><strong>{money(data?.last)}</strong><span className={changeClass(data?.changePercent)}>{percent(data?.changePercent)}</span></span>
  <small>{data?.asOf?'日线 '+data.asOf:'等待真实报价'}</small>
 </button>;
}
function FinanceSection({data,loading}:{data:FundamentalsPayload|null;loading:boolean}){
 if(loading)return <Blank loading title="正在读取财务披露" detail="优先读取 SEC 官方数据，不生成推测财务数值"/>;
 if(!data)return <Blank title="财报尚未加载" detail="选择一只股票以查看相关官方披露"/>;
 return <div className="finance-wrap">
  <p className="helper-text">{data.notice}</p>
  {data.available&&<>
   <div className="finance-metrics">
    {([{title:'年度营收',list:data.revenue},{title:'年度净利润',list:data.netIncome}] as const).map(x=><div className="finance-block" key={x.title}>
     <div className="block-subtitle">{x.title} <span>USD · 10-K</span></div>
     {(x.list?.length??0)>0?<div className="finance-bars">
      {x.list!.map(item=><div className="finance-bar-line" key={item.year}>
       <span>{item.year}</span><div className="finance-track"><i style={{width:Math.max(2,Math.round(Math.abs(item.value)/Math.max(...x.list!.map(v=>Math.abs(v.value)),1)*100))+'%'}}/></div>
       <strong>{(item.value/1e9).toFixed(2)}B</strong>
      </div>)}
     </div>:<div className="subdued-panel">该公司未以当前支持的 XBRL 科目报告此项指标。</div>}
    </div>)}
   </div>
  </>}
  <a className="outline-link" href={data.sourceUrl} target="_blank" rel="noopener noreferrer">查看官方披露原文 <ExternalLink size={13}/></a>
 </div>;
}
function AnalysisPanel({data}:{data:MarketPayload}){
 const a=useMemo(()=>analyzeCandles(data.candles),[data.candles]);
 return <div className="analysis-panel">
  <div className="analysis-top">
   <div><div className="eyebrow">TECHNICAL FRAMEWORK</div><h3>五线开花 <span>×</span> 量价时空</h3><p>先判断趋势结构，再拆分量、价、时、空的证据。</p></div>
   <div className={'stage-chip '+(a.bloom?'bloom':'')}>{a.stage}</div>
  </div>
  {a.ready?<div className="model-strip">
   <div className="model-stat"><small>模型观察分</small><strong>{a.score}<em> / 100</em></strong></div>
   <div className="model-stat"><small>五线排列</small><strong className={a.aligned?'positive':'muted'}>{a.aligned?'多头':'未齐整'}</strong></div>
   <div className="model-stat"><small>五线斜率</small><strong className={a.rising?'positive':'muted'}>{a.rising?'全部向上':'混合方向'}</strong></div>
   <div className="model-stat"><small>MACD</small><strong className={a.macdBull?'positive':'muted'}>{a.macdBull?'多头':'未确认'}</strong></div>
  </div>:<StatusNote>日K样本不足：{a.available} / {a.required}，不能计算完整五线开花模型。</StatusNote>}
  <div className="dimension-grid">{a.dimensions.map(d=><div className="dimension-card" key={d.title}>
   <div className="dimension-head"><h4>{d.title}</h4><b>{a.ready?d.score:'—'}</b></div>
   <div className="dimension-status">{d.status}</div>
   <div className="dimension-evidence">{d.evidence.map((e,i)=><p key={i}><span className="bullet-tiny"/> {e}</p>)}</div>
  </div>)}</div>
  <div className="model-footer"><div><span className="eyebrow">MODEL RULES</span><p>五线开花采用 MA5 / 10 / 20 / 60 / 120，多头排列、均线斜率与 MACD 同时确认。分数是观察指标，不是收益概率。</p></div><div><span className="eyebrow">DATA QUALITY</span><p>最后交易日 {a.asOf||'未知'} · OHLCV 日线 · 样本 {a.available} 根</p></div></div>
  {a.warnings.map((w,i)=><StatusNote key={i}>{w}</StatusNote>)}
 </div>;
}
export default function App(){
 const [view,setView]=useState<View>('overview');
 const [mobileNav,setMobileNav]=useState(false);
 const [watchlist,setWatchlist]=useState<string[]>(()=>readStored('atlas.watchlist.v1',DEFAULT_WATCHLIST));
 const [saved,setSaved]=useState<NewsItem[]>(()=>readStored('atlas.bookmarks.v1',[]));
 const [selected,setSelected]=useState(()=>{const sym=new URLSearchParams(window.location.search).get('symbol');return sym?normalizeSymbol(sym):'NVDA';});
 const [markets,setMarkets]=useState<Record<string,MarketPayload>>({});
 const [marketErrors,setMarketErrors]=useState<Record<string,string>>({});
 const [newsCategory,setNewsCategory]=useState('all');
 const [newsData,setNewsData]=useState<NewsPayload|null>(null);
 const [newsLoading,setNewsLoading]=useState(true);
 const [newsError,setNewsError]=useState('');
 const [fundamentals,setFundamentals]=useState<FundamentalsPayload|null>(null);
 const [financeLoading,setFinanceLoading]=useState(false);
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
 const analysis=useMemo(()=>selectedData?analyzeCandles(selectedData.candles):null,[selectedData]);
 useEffect(()=>{localStorage.setItem('atlas.watchlist.v1',JSON.stringify(watchlist));},[watchlist]);
 useEffect(()=>{localStorage.setItem('atlas.bookmarks.v1',JSON.stringify(saved));},[saved]);
 useEffect(()=>{const t=setInterval(()=>setClock(new Date()),60000);return ()=>clearInterval(t);},[]);
 useEffect(()=>{
  const handler=(e:KeyboardEvent)=>{
   const target=e.target as HTMLElement;
   const editing=['INPUT','TEXTAREA'].includes(target?.tagName)||target?.isContentEditable;
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'||(e.key==='/'&&!editing)){e.preventDefault();setSearchOpen(true);searchRef.current?.focus();}
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
  const ac=new AbortController();setNewsLoading(true);setNewsError('');setNewsData(null);
  api<NewsPayload>('/api/news?category='+encodeURIComponent(newsCategory),ac.signal)
   .then(data=>{if(!ac.signal.aborted)setNewsData(data);})
   .catch(e=>{if(!ac.signal.aborted)setNewsError(e instanceof Error?e.message:String(e));})
   .finally(()=>{if(!ac.signal.aborted)setNewsLoading(false);});
  return ()=>ac.abort();
 },[newsCategory,refreshKey]);
 useEffect(()=>{
  if(view!=='research')return;
  const ac=new AbortController();setFinanceLoading(true);setFundamentals(null);
  api<FundamentalsPayload>('/api/fundamentals?symbol='+encodeURIComponent(selected),ac.signal)
   .then(data=>{if(!ac.signal.aborted)setFundamentals(data);})
   .catch(e=>{if(!ac.signal.aborted)setFundamentals({symbol:selected,available:false,provider:'SEC EDGAR',sourceUrl:'https://www.sec.gov/edgar/search/',notice:e instanceof Error?e.message:String(e)});})
   .finally(()=>{if(!ac.signal.aborted)setFinanceLoading(false);});
  return ()=>ac.abort();
 },[view,selected]);
 useEffect(()=>{
  if(!searchQuery.trim()){setRemoteResults([]);return;}
  const ac=new AbortController();
  const timeout=setTimeout(()=>{
   api<{items:SearchItem[]}>('/api/search?q='+encodeURIComponent(searchQuery),ac.signal)
    .then(data=>{if(!ac.signal.aborted)setRemoteResults(data.items);}).catch(()=>{});
  },250);
  return ()=>{clearTimeout(timeout);ac.abort();};
 },[searchQuery]);
 const chooseSymbol=useCallback((symbol:string)=>{
  const normalized=normalizeSymbol(symbol);setSelected(normalized);setView('research');setSearchOpen(false);setSearchQuery('');
  window.history.replaceState(null,'','?symbol='+encodeURIComponent(normalized));
  window.scrollTo({top:0,behavior:'smooth'});
 },[]);
 const toggleWatch=useCallback((symbol:string)=>setWatchlist(prev=>prev.includes(symbol)?prev.filter(x=>x!==symbol):[symbol,...prev].slice(0,30)),[]);
 const toggleSave=useCallback((item:NewsItem)=>setSaved(prev=>prev.some(x=>x.url===item.url)?prev.filter(x=>x.url!==item.url):[item,...prev].slice(0,200)),[]);
 const changeView=useCallback((v:View)=>{setView(v);setMobileNav(false);window.scrollTo({top:0,behavior:'smooth'});},[]);
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

 return <div className="app-shell">
  <aside className={'sidebar '+(mobileNav?'mobile-open':'')}>
   <div className="brand"><Logo/><div className="brand-copy"><strong>MARKET ATLAS</strong><span>PERSONAL INTELLIGENCE</span></div><button className="mobile-close icon-button" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
   <div className="nav-label">WORKSPACE</div>
   <nav className="nav-list">{NAV.map(([id,label,Icon])=><button key={id} onClick={()=>changeView(id)} className={'nav-item '+(view===id?'active':'')}><Icon size={17}/><span>{label}</span>{id==='saved'&&saved.length>0&&<small className="nav-count">{saved.length}</small>}</button>)}</nav>
   <div className="sidebar-section">
    <div className="sidebar-section-head">SECTOR WATCH <Radar size={13}/></div>
    {SECTORS.map((s,i)=><button key={s.id} className="sector-nav-item" onClick={()=>showNews(s.id)}><span className="sector-index">0{i+1}</span><span>{s.name}</span><ChevronRight size={13}/></button>)}
   </div>
   <div className="sidebar-bottom"><div className="connection-icon"><span className="pulse-dot"/> RESEARCH FEEDS</div><p>全球情报 · A股 / 美股 · 原始资料核验</p><small>行情按数据源交易日更新，并非实时盘口</small></div>
  </aside>
  {mobileNav&&<button className="mobile-shade" aria-label="关闭导航" onClick={()=>setMobileNav(false)}/>}
  <div className="workspace">
   <header className="topbar">
    <div className="top-left"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={()=>setMobileNav(true)}><Menu size={20}/></button><span className="crumb">RESEARCH DESK</span><ChevronRight size={14}/><strong>{NAV.find(n=>n[0]===view)?.[1]}</strong></div>
    <div className="top-right">
     <span className="time-label"><span className="pulse-dot"/> AKL {currentTime}</span>
     <button onClick={()=>setRefreshKey(v=>v+1)} className="icon-button" aria-label="刷新所有数据" title="刷新数据"><RefreshCw size={17}/></button>
     <span className="top-divider"/>
     <button className="search-trigger" onClick={()=>{setSearchOpen(true);searchRef.current?.focus();}}><Search size={16}/><span>搜索全球股票 / 代码</span><kbd>⌘ K</kbd></button>
    </div>
   </header>
   <main className="main">
    {view==='overview'&&<>
     <section className="page-heading">
      <div><div className="eyebrow"><span className="eyebrow-accent">●</span> YOUR GLOBAL INTELLIGENCE TERMINAL</div><h1>全局情报<span className="title-dim">，尽在掌握。</span></h1><p>从世界事件到产业链，从上市公司披露到股价信号。先看事实，再判断影响。</p></div>
      <div className="heading-extra"><Globe2 size={14}/> GLOBAL COVERAGE <span className="accent-tiny">/</span> 7 SECTORS</div>
     </section>
     <div className="global-tape"><div className="tape-top"><span className="eyebrow">CROSS-ASSET MONITOR</span><span>第三方行情组件 · 可能延迟</span></div><TradingViewWidget kind="tape"/></div>
     <div className="overview-grid">
      <div className="overview-main">
       <div className="panel hero-news">
        <div className="panel-heading"><div><span className="eyebrow">WORLD SIGNAL / 01</span><h2>全球信息流</h2></div><button className="text-link" onClick={()=>changeView('news')}>查看全部 <ArrowRight size={15}/></button></div>
        {newsLoading?<Blank loading title="汇聚全球新闻源" detail="正在读取最新公开报道并去除重复标题"/>:
         newsError?<Blank title="新闻数据暂时不可用" detail={newsError}/>:
         news.length===0?<Blank title="暂无可用新闻" detail="当前 RSS 未返回有效数据，可稍后刷新或检查数据源"/>:
         <div className="hero-news-list">
          {highlighted&&<div className="featured-story"><div className="featured-glow"/><div className="featured-overline"><Zap size={14}/> LATEST GLOBAL SIGNAL</div><div className="featured-content"><NewsRow item={highlighted} save={toggleSave} saved={savedIds.has(highlighted.url)} major/></div></div>}
          {news.slice(1,8).map(x=><NewsRow key={x.id} item={x} save={toggleSave} saved={savedIds.has(x.url)}/>)}
         </div>}
        <div className="panel-bottom"><span>Google News RSS · 源站验证 · {newsData?.fetchedAt?'更新 '+dateTime(newsData.fetchedAt):'等待更新'}</span><button onClick={()=>changeView('news')}>全部资讯 <ArrowRight size={13}/></button></div>
       </div>
       <div className="panel">
        <div className="panel-heading"><div><span className="eyebrow">CATALYST MONITOR / 02</span><h2>七大产业链脉搏</h2></div><button className="text-link" onClick={()=>changeView('radar')}>产业研究 <ArrowRight size={15}/></button></div>
        <div className="sector-overview-grid">{SECTORS.map((s,i)=><button key={s.id} className="sector-tile" onClick={()=>showNews(s.id)}>
         <div className="sector-tile-top"><span className="sector-tile-index">0{i+1} /</span><Radar size={15}/></div>
         <strong>{s.name}</strong><small>{s.en}</small>
         <div className="sector-tile-bottom"><span>{sectorCount(s.id)} 条线索</span><ArrowUpRight size={16}/></div>
        </button>)}</div>
        <StatusNote>线索数量不代表产业景气或订单兑现。报道必须核查原始公告、订单、价格、收入和利润证据。</StatusNote>
       </div>
      </div>
      <div className="overview-side">
       <div className="panel">
        <div className="panel-heading compact"><div><span className="eyebrow">FOCUS LIST / 03</span><h2>市场关注</h2></div><button className="icon-button" title="打开自选股" onClick={()=>changeView('markets')}><ChevronRight size={18}/></button></div>
        {watchlist.every(symbol=>!markets[symbol]?.last)?<><TradingViewWidget kind="quotes" symbols={watchlist.slice(0,8)}/><div className="widget-note">TradingView 第三方参考行情 · 可能延迟，点击右上角进入本站个股研究。</div></>:<div className="quote-lines">{watchlist.slice(0,8).map(symbol=><QuoteLine key={symbol} selected={selected===symbol} data={markets[symbol]||{symbol,name:CATALOG.find(c=>c.symbol===symbol)?.name||symbol} as MarketPayload} onClick={()=>chooseSymbol(symbol)}/>)}</div>}
        <div className="panel-bottom"><span>真实日线 · 收盘价</span><button onClick={()=>changeView('markets')}>管理自选 <ArrowRight size={13}/></button></div>
       </div>
       <div className="panel focus-spotlight">
        <div className="panel-heading compact"><div><span className="eyebrow">TECHNICAL FOCUS / 04</span><h2>技术结构观察</h2></div><Activity size={17} className="accent-icon"/></div>
        <div className="spotlight-symbol"><strong>{selected}</strong><span>{selectedData?.name||'等待行情'}</span></div>
        <div className="spotlight-price"><strong>{money(selectedData?.last)}</strong><span className={changeClass(selectedData?.changePercent)}>{percent(selectedData?.changePercent)}</span></div>
        {selectedData?<MarketChart candles={selectedData.candles} compact/>:<Blank loading={!marketErrors[selected]} title="正在读取历史行情" detail={marketErrors[selected]||'数据不可用时不会显示假走势图'}/>}
        <div className="spotlight-signals">
         <div><span>五线状态</span><b>{analysis?.stage||'等待数据'}</b></div>
         <div><span>相对量能</span><b>{analysis?.volumeRatio?analysis.volumeRatio.toFixed(2)+'×':'—'}</b></div>
        </div>
        <button className="primary-action" onClick={()=>changeView('research')}>打开完整个股研究 <ArrowRight size={16}/></button>
       </div>
       <div className="source-disclosure"><ShieldAlert size={16}/><div><b>数据可信度优先</b><p>新闻展示来源与时间；K 线属于日线研究数据，不能用作实时交易决策。数据不可用时不生成虚假内容。</p></div></div>
      </div>
     </div>
    </>}
    {view==='news'&&<>
     <SectionHeading eyebrow="GLOBAL EVENTS / LIVE FEEDS" title="全球事件情报" right={<span className="small-metadata"><Clock3 size={14}/> {newsData?'最后抓取 '+dateTime(newsData.fetchedAt):'尚未获取'}</span>}/>
     <p className="section-subtitle">从全球宏观、政策、科技突破到产业订单线索。按时间排序的原始报道，并非自动确认的投资结论。</p>
     <div className="chip-row">{NEWS_CATEGORIES.map(c=><button key={c.id} className={'chip '+(newsCategory===c.id?'selected':'')} onClick={()=>setNewsCategory(c.id)}>{c.name}</button>)}</div>
     <div className="panel article-panel">
      <div className="list-toolbar"><div><span className="eyebrow">LATEST ARTICLES</span><b>{newsData?.items.length||0} 条</b></div><span>按发布时间 · 新→旧</span></div>
      {newsLoading?<Blank loading title="正在读取相关新闻" detail="正在请求公开新闻 RSS"/>:newsError?<Blank title="新闻源暂时不可用" detail={newsError}/>:
       visibleArticles.length===0?<Blank title="当前没有检索到新闻" detail="换个主题或稍后刷新"/>:
       visibleArticles.map(x=><NewsRow key={x.id} item={x} save={toggleSave} saved={savedIds.has(x.url)} />)}
      {newsData?.warnings.length?<div className="feed-errors">{newsData.warnings.map((w,i)=><StatusNote key={i}>新闻源异常：{w}</StatusNote>)}</div>:null}
     </div>
    </>}
    {view==='radar'&&<>
     <SectionHeading eyebrow="THESIS MONITOR / SEVEN INDUSTRY CHAINS" title="产业催化雷达" right={<div className="heading-extra"><Radar size={14}/> WATCHING 07 CHAINS</div>}/>
     <p className="section-subtitle">扫描媒体线索，拆解美股领先信号与 A 股映射；区分叙事、订单验证、收入确认与利润兑现。</p>
     <div className="thesis-method"><div><span>01</span><b>事件与事实</b><small>原始信息 / 发生时间</small></div><ArrowRight size={17}/><div><span>02</span><b>供需 / 订单</b><small>谁真正获得商业利益</small></div><ArrowRight size={17}/><div><span>03</span><b>收入 / 利润</b><small>财务披露验证兑现</small></div><ArrowRight size={17}/><div><span>04</span><b>估值 / 股价</b><small>预期是否已经反映</small></div></div>
     {newsLoading&&<Blank loading title="扫描七大产业链" detail="聚合来自公开新闻源的产业新闻"/>}
     {!newsLoading&&<div className="radar-grid">{focusedThemes.map(({sector,items},i)=><div className="panel radar-panel" key={sector.id}>
      <div className="radar-head"><div><span className="eyebrow">CHAIN 0{i+1} / 07</span><h3>{sector.name}</h3><small>{sector.en}</small></div><div className="radar-qty"><strong>{items.length}</strong><small>相关线索</small></div></div>
      <div className="radar-coverage"><b>关注标的</b><div>{sector.tickers.map(t=><button key={t} onClick={()=>chooseSymbol(t)}>{t}<ArrowUpRight size={11}/></button>)}</div></div>
      {items.length?items.slice(0,3).map(x=><NewsRow key={x.id} item={x} save={toggleSave} saved={savedIds.has(x.url)}/>):<div className="radar-none">该主题目前没有从订阅源取得新线索；不能据此认定产业没有变化。</div>}
      <div className="radar-footer"><span className="pending-dot"/> 媒体线索 · 尚未完成订单 / 财报验证 <button onClick={()=>showNews(sector.id)}>展开 <ArrowRight size={13}/></button></div>
     </div>)}</div>}
     <StatusNote>这是事实收集与跟踪工具，不会因报道提及某公司就宣称其订单、收入或利润已兑现。需结合公告、财报和其他独立证据。</StatusNote>
    </>}
    {view==='markets'&&<>
     <SectionHeading eyebrow="WATCHLIST / EQUITIES" title="市场观察列表" right={<button className="outline-button" onClick={()=>{setSearchOpen(true);searchRef.current?.focus();}}><Plus size={16}/> 添加标的</button>}/>
     <p className="section-subtitle">跟踪自己关心的美股与 A 股，而不是盯着账户盈亏。支持名称/代码搜索，最多 30 只，自选列表保存在当前浏览器。</p>
     <div className="market-grid">{watchlist.map(symbol=><QuoteCard key={symbol} symbol={symbol} data={markets[symbol]} onClick={()=>chooseSymbol(symbol)}/>)}</div>
     <div className="panel table-panel"><div className="panel-heading"><div><span className="eyebrow">DAILY EQUITY MONITOR</span><h2>行情与技术观察</h2></div><span className="small-metadata">最近交易日日线收盘</span></div>
      <div className="table-scroll"><table className="equity-table"><thead><tr><th>标的</th><th>市场</th><th>最近价格</th><th>日变化</th><th>五线结构</th><th>更新交易日</th><th></th></tr></thead><tbody>
       {watchlist.map(symbol=>{const d=markets[symbol],a=d?analyzeCandles(d.candles):null;return <tr key={symbol} onClick={()=>chooseSymbol(symbol)}>
        <td><b>{symbol}</b><small>{d?.name||CATALOG.find(x=>x.symbol===symbol)?.name}</small></td><td>{d?.exchange||'—'}</td><td><b>{money(d?.last)}</b></td><td className={changeClass(d?.changePercent)}>{percent(d?.changePercent)}</td><td><span className={'table-status '+(a?.bloom?'good':'')}>{a?.stage||'等待数据'}</span></td><td>{d?.asOf||'—'}</td><td><button className="icon-button" title="从自选移除" onClick={e=>{e.stopPropagation();toggleWatch(symbol);}}><X size={14}/></button></td>
       </tr>;})}
      </tbody></table></div>
      {Object.entries(marketErrors).filter(([key])=>watchlist.includes(key)&&!markets[key]).map(([key,message])=><StatusNote key={key}>{key} 数据不可用：{message}</StatusNote>)}
     </div>
    </>}
    {view==='research'&&<>
     <div className="stock-header">
      <div className="stock-id"><div className="eyebrow">SECURITY RESEARCH / {selectedData?.exchange||'GLOBAL'}</div><div className="stock-heading"><h1>{selectedData?.name||selected}</h1><span>{selected}</span></div><p>{selectedData?.provider||'等待市场数据提供方'} · {selectedData?.currency||'—'}</p></div>
      <div className="stock-price-wrap"><div className="stock-price"><strong>{money(selectedData?.last)}</strong><span>{selectedData?.currency||''}</span></div><div className={'stock-delta '+changeClass(selectedData?.changePercent)}>{selectedData?.changePercent!=null?(selectedData.changePercent>=0?<ArrowUpRight size={16}/>:<ArrowDownRight size={16}/>):null}{percent(selectedData?.changePercent)} <span>最近交易日</span></div></div>
      <button className={'outline-button watch-toggle '+(watchlist.includes(selected)?'in-watch':'')} onClick={()=>toggleWatch(selected)}>{watchlist.includes(selected)?<Check size={15}/>:<Plus size={15}/>} {watchlist.includes(selected)?'已在关注':'加入关注'}</button>
     </div>
     <div className="research-layout">
      <div className="research-primary">
       <div className="panel candle-panel"><div className="panel-heading"><div><span className="eyebrow">OHLCV / HISTORICAL DATA</span><h2>价格走势与均线结构</h2></div><span className="date-chip"><Clock3 size={13}/> {selectedData?.asOf||'等待数据'}</span></div>
        {selectedData?<MarketChart candles={selectedData.candles}/>:<div className="chart-fallback">{!marketErrors[selected]&&<p className="widget-loading">正在尝试获取可分析的 OHLCV 数据…</p>}<TradingViewWidget symbol={selected}/><StatusNote>以下是 TradingView 官方嵌入图表；它不向本系统提供原始 K 线，暂不能计算五线开花。{marketErrors[selected]||'如需本地技术分析请配置行情 API。'}</StatusNote></div>}
        <div className="chart-disclaimer">{selectedData?.notice||'尚未获得报价'} {selectedData?.sourceUrl&&<a href={selectedData.sourceUrl} target="_blank" rel="noopener noreferrer">数据来源 <ExternalLink size={12}/></a>}</div>
       </div>
       {selectedData?<div className="panel analysis-box"><AnalysisPanel data={selectedData}/></div>:<div className="panel"><Blank title="技术分析等待行情" detail={marketErrors[selected]||'请先选择能提供日线历史数据的股票'}/></div>}
       <div className="panel"><div className="panel-heading"><div><span className="eyebrow">OFFICIAL DISCLOSURE / FINANCIALS</span><h2>财务披露与业绩</h2></div><FileText size={18} className="panel-heading-icon"/></div><FinanceSection data={fundamentals} loading={financeLoading}/></div>
      </div>
      <div className="research-aside">
       <div className="panel snapshot-panel"><div className="panel-heading compact"><div><span className="eyebrow">DATA PROFILE</span><h2>证券概览</h2></div></div>
        {([{label:'市场',value:selectedData?.exchange||'—'},{label:'交易币种',value:selectedData?.currency||'—'},{label:'历史数据源',value:selectedData?.provider||'—'},{label:'最后交易日',value:selectedData?.asOf||'—'},{label:'K线样本',value:selectedData?.candles.length.toString()||'—'},{label:'报价类型',value:'历史日线 / 非实时'}]).map(x=><div className="snapshot-line" key={x.label}><span>{x.label}</span><b>{x.value}</b></div>)}
       </div>
       <div className="panel"><div className="panel-heading compact"><div><span className="eyebrow">RELEVANT COVERAGE</span><h2>相关产业与事件</h2></div></div>
        {SECTORS.filter(s=>s.tickers.some(t=>t===selected)).map(s=><button key={s.id} className="related-sector" onClick={()=>showNews(s.id)}><Layers3 size={15}/>{s.name}<ChevronRight size={14}/></button>)}
        {!SECTORS.some(s=>s.tickers.some(t=>t===selected))&&<p className="helper-text">当前没有将该标的映射到七条追踪产业链，可从全球新闻和独立公告继续研究。</p>}
        <button className="primary-action subdued" onClick={()=>{setSearchQuery(selected);setNewsCategory('all');changeView('news');}}>搜索相关最新新闻 <ArrowRight size={15}/></button>
       </div>
       <div className="panel"><div className="panel-heading compact"><div><span className="eyebrow">MODEL DISCIPLINE</span><h2>反方检查</h2></div></div>
        <div className="audit-points"><p><span>01</span> 股价上涨 ≠ 订单已经落地</p><p><span>02</span> 均线多头 ≠ 未来一定上涨</p><p><span>03</span> 放量需要观察后续承接</p><p><span>04</span> 财报数据需要核实会计口径</p><p><span>05</span> 技术结构需结合市场与行业条件</p></div>
       </div>
      </div>
     </div>
    </>}
    {view==='saved'&&<>
     <SectionHeading eyebrow="PRIVATE RESEARCH LIBRARY" title="收藏情报" right={<span className="small-metadata">{saved.length} 条已保存</span>}/>
     <p className="section-subtitle">快速保存值得二次验证的原始报道；只存当前浏览器，不会上传你的研究列表。</p>
     <div className="panel article-panel">{saved.length?saved.map(x=><NewsRow key={x.url} item={x} save={toggleSave} saved/>):<Blank title="还没有收藏情报" detail="打开全球快讯，点击书签图标保存重要新闻"/>}</div>
    </>}
    <footer className="app-footer"><span>MARKET ATLAS <i>·</i> PERSONAL RESEARCH SYSTEM</span><span>公开来源研究 · 非实时交易数据 · 非投资建议</span></footer>
   </main>
  </div>
  {searchOpen&&<div className="search-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSearchOpen(false);}}>
   <div className="command-modal" role="dialog" aria-modal="true" aria-label="股票搜索">
    <div className="command-head"><Search size={20}/><input ref={searchRef} autoFocus placeholder="搜索股票名称、代码，例如 NVDA / 300308 / 中际旭创" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&searchOptions[0])chooseSymbol(searchOptions[0].symbol);}}/><button className="command-esc" onClick={()=>setSearchOpen(false)}>ESC</button></div>
    <div className="command-options"><div className="eyebrow">SECURITIES / {searchQuery?'SEARCH RESULTS':'QUICK ACCESS'}</div>
     {searchOptions.length?searchOptions.map(x=><button key={x.symbol} className="command-result" onClick={()=>chooseSymbol(x.symbol)}><span className="command-symbol">{x.symbol}</span><span className="command-name">{x.name}<small>{x.exchange} {x.sector?'· '+x.sector:''}</small></span><ArrowRight size={15}/></button>):<p className="helper-text">未找到匹配标的。可输入交易所代码并按回车尝试获取行情。</p>}
    </div>
    <div className="command-footer"><span><kbd>↵</kbd> 进入个股</span><span><kbd>ESC</kbd> 退出搜索</span><span><kbd>⌘ K</kbd> 快速打开</span></div>
   </div>
  </div>}
 </div>;
}
