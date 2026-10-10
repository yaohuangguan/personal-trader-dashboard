import { useEffect,useState } from 'react';
import { Activity, ArrowRight, BookOpenCheck, CalendarClock, ChevronDown, CircleAlert, Clock3, ExternalLink, FileText, LoaderCircle, Radar, RefreshCw, ShieldCheck, DatabaseZap, XCircle } from 'lucide-react';
import { NEWS_CATEGORIES } from '../../shared/catalog';
import type { NewsItem } from '../../shared/types';

type IntelItem=NewsItem&{firstSeenAt:string;lastSeenAt:string;sightings:number;tickers:string[];sectors:string[];evidenceStage:string};
type Summary={stored:boolean;total:number;new24h:number;sectors:{sector_id:string;total:number}[];lastRun:{started_at:string;finished_at:string;new_events:number;seen_events:number;warning_count:number;warnings_json:string}|null;reason?:string};
type IntelList={stored:boolean;items:IntelItem[];reason?:string};
type EarnEvent={date:string;symbol:string;time:string|null;epsEstimated:number|null;epsActual:number|null;status:'scheduled'|'reported';sourceUrl:string};
type Earnings={available:boolean;items:EarnEvent[];provider:string;reason:string};
type Filings={available:boolean;items:{form:string;date:string;reportDate:string|null;url:string;title?:string;artCode?:string}[];notice:string;provider:string;sourceUrl:string};
type StockNews={items:NewsItem[];notice:string;source:string};
type Load<T>={loading:boolean;data:T|null;error:string};
function useEndpoint<T>(path:string):Load<T>&{refresh:()=>void}{
 const [version,setVersion]=useState(0);
 const [state,setState]=useState<Load<T>>({loading:true,data:null,error:''});
 useEffect(()=>{
  const c=new AbortController();
  setState({loading:true,data:null,error:''});
  fetch(path,{signal:c.signal,headers:{accept:'application/json'}})
   .then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.details||b.error||'HTTP '+r.status);return b as T;})
   .then(data=>{if(!c.signal.aborted)setState({loading:false,data,error:''});})
   .catch(e=>{if(!c.signal.aborted)setState({loading:false,data:null,error:String(e)});});
  return ()=>c.abort();
 },[path,version]);
 return {...state,refresh:()=>setVersion(v=>v+1)};
}
const format=(raw:string|null|undefined)=>raw?new Intl.DateTimeFormat('zh-CN',{timeZone:'Pacific/Auckland',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(raw)):'未知';
const sectorName=(id:string)=>NEWS_CATEGORIES.find(x=>x.id===id)?.name||id;
function Message({text,error=false}:{text:string;error?:boolean}){return <div className={'intel-message '+(error?'error':'')}><CircleAlert size={16}/><span>{text}</span></div>;}
function TimelineCard({item,onStock}:{item:IntelItem;onStock?:(symbol:string)=>void}){
 return <article className="event-card">
  <div className="event-date"><strong>{format(item.firstSeenAt)}</strong><small>首次发现</small></div>
  <div className="event-card-body">
   <div className="event-badges"><span className="intel-evidence">媒体线索 · 未核验订单</span>{item.sectors.map(s=><span className="event-sector" key={s}>{sectorName(s)}</span>)}</div>
   <a href={item.url} target="_blank" rel="noreferrer noopener">{item.title} <ExternalLink size={13}/></a>
   <div className="event-metadata">{item.source} · 报道 {format(item.publishedAt)} · 累计扫描命中 {item.sightings} 次</div>
   {item.tickers.length>0&&<div className="event-tickers">{item.tickers.map(s=><button key={s} onClick={()=>onStock?.(s)}>{s}<ArrowRight size={12}/></button>)}</div>}
  </div>
 </article>;
}
export function OverviewIntelStrip({onOpen}:{onOpen:()=>void}){
 const {loading,data,error}=useEndpoint<Summary>('/api/intelligence/summary');
 return <section className="intel-status-strip" aria-label="情报扫描归档状态">
  <div className="intel-stat"><DatabaseZap size={20}/><div><strong>{loading?'…':data?.total??'—'}</strong><span>历史情报条目</span></div></div>
  <div className="intel-stat"><Radar size={20}/><div><strong>{loading?'…':data?.new24h??'—'}</strong><span>近24小时新发现</span></div></div>
  <div className="intel-stat"><Clock3 size={20}/><div><strong className="intel-small-stat">{data?.lastRun?format(data.lastRun.finished_at):'等待扫描'}</strong><span>最近一次扫描</span></div></div>
  <button className="intel-open" onClick={onOpen}>事件档案 <ArrowRight size={16}/></button>
  {(error||data?.reason)&&<div className="intel-mini-warning">{error||data?.reason}</div>}
 </section>;
}
export function IntelHistory({onStock}:{onStock:(symbol:string)=>void}){
 const [category,setCategory]=useState('all'),[onlyNew,setOnlyNew]=useState(false);
 const {loading,data,error,refresh}=useEndpoint<IntelList>('/api/intelligence?category='+encodeURIComponent(category)+'&limit=90&new='+(onlyNew?'1':'0'));
 const summary=useEndpoint<Summary>('/api/intelligence/summary');
 return <div className="intel-history-view">
  <div className="intel-page-hero"><div className="eyebrow">DURABLE INTELLIGENCE / EVENT LOG</div><h2>可追溯的全球情报档案</h2><p>从一次性的新闻流升级为长期事件记录：什么时候首次发现，之后出现了几次，涉及哪些产业和股票。</p></div>
  <div className="history-stats">
   <div><span>累计事件</span><strong>{summary.data?.total??'—'}</strong></div>
   <div><span>近24小时首次发现</span><strong>{summary.data?.new24h??'—'}</strong></div>
   <div><span>最近扫描入库</span><strong>{summary.data?.lastRun?.new_events??'—'}</strong></div>
   <div><span>最近扫描警告</span><strong>{summary.data?.lastRun?.warning_count??'—'}</strong></div>
  </div>
  <div className="intel-filter-bar"><select aria-label="产业线索筛选" value={category} onChange={e=>setCategory(e.target.value)}>{NEWS_CATEGORIES.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
   <label><input type="checkbox" checked={onlyNew} onChange={e=>setOnlyNew(e.target.checked)}/> 只看近24小时新发现</label>
   <button onClick={()=>{refresh();summary.refresh();}}><RefreshCw size={15}/> 刷新档案</button>
  </div>
  <div className="event-history-panel">
   {loading?<div className="intel-loading"><LoaderCircle className="spin" size={20}/> 正在查询历史情报…</div>:
    error?<Message error text={error}/>:
    !data?.stored?<Message text={data?.reason||'持久化尚未启用。'}/>:
    data.items.length===0?<Message text="没有符合当前条件的历史事件。等待下次扫描，或切换筛选条件。"/>:
    data.items.map(item=><TimelineCard key={item.id} item={item} onStock={onStock}/>)}
  </div>
  <Message text="每条记录初始状态均为「媒体线索」。同一新闻再次出现只增加观测次数；不等于订单验证或利润兑现。"/>
 </div>;
}
type Announcement={title:string;date:string;content:string;pdfUrl:string|null;tags:string[];provider:string};
function AnnouncementInspector({code,onClose}:{code:string;onClose:()=>void}){
 const detail=useEndpoint<Announcement>('/api/announcement?code='+encodeURIComponent(code));
 return <div className="announcement-inspector">
  <div className="announcement-inspector-title"><strong>公告原文解析</strong><button onClick={onClose}>关闭 ×</button></div>
  {detail.loading?<p>正在读取公告正文…</p>:detail.error?<Message error text={detail.error}/>:
   detail.data&&<>
    <h4>{detail.data.title}</h4><p className="deep-caption">{detail.data.provider} · {detail.data.date}</p>
    <div className="event-badges">{detail.data.tags.map(tag=><span key={tag} className="event-sector">{tag}</span>)}</div>
    <p className="deep-caption">标签仅通过标题关键词识别；以下为来源提供的正文摘录，不是模型生成的结论。</p>
    <div className="announcement-excerpt">{detail.data.content||'仅有附件，无可提取正文。'}</div>
    {detail.data.pdfUrl&&<a className="deep-source-link" href={detail.data.pdfUrl} target="_blank" rel="noopener noreferrer">打开 PDF 附件 <ExternalLink size={14}/></a>}
   </>}
 </div>;
}
export function StockResearchExtras({symbol,onStock}:{symbol:string;onStock:(symbol:string)=>void}){
 const [selectedAnnouncement,setSelectedAnnouncement]=useState<string|null>(null);
 const news=useEndpoint<StockNews>('/api/stock/news?symbol='+encodeURIComponent(symbol));
 const earnings=useEndpoint<Earnings>('/api/earnings-calendar?symbol='+encodeURIComponent(symbol));
 const filings=useEndpoint<Filings>('/api/filings?symbol='+encodeURIComponent(symbol));
 const history=useEndpoint<IntelList>('/api/intelligence?symbol='+encodeURIComponent(symbol)+'&limit=20&category=all');
 return <div className="deep-research">
  <div className="deep-research-heading"><div className="eyebrow">PRIMARY EVIDENCE / COMPANY INTELLIGENCE</div><h2>公司新闻、财报与公告证据链</h2><p>分开列出媒体报道、财报日历与交易所/SEC 正式披露，绝不把传闻自动当成业绩兑现。</p></div>
  <div className="deep-grid">
   <section className="deep-panel">
    <div className="deep-panel-title"><div><BookOpenCheck size={18}/><h3>公司相关报道</h3></div><small>标题匹配 · 需核验</small></div>
    {news.loading?<p>正在寻找公司相关报道…</p>:news.error?<Message error text={news.error}/>:
     !news.data?.items.length?<Message text={news.data?.notice||'暂未在当前新闻范围内找到公司相关报道。'}/>:
      news.data.items.slice(0,10).map((n,i)=><div className="deep-link-row" key={n.url+i}><span>{n.source} · {format(n.publishedAt)}</span><a href={n.url} target="_blank" rel="noopener noreferrer">{n.title} <ExternalLink size={12}/></a></div>)}
    <div className="deep-caption">{news.data?.notice||'相关新闻须核实上市公司是否真正受益。'}</div>
   </section>
   <section className="deep-panel">
    <div className="deep-panel-title"><div><CalendarClock size={18}/><h3>财报日历</h3></div><small>独立授权数据源</small></div>
    {earnings.loading?<p>正在查询财报日历…</p>:earnings.error?<Message error text={earnings.error}/>:
    !earnings.data?.available?<Message text={earnings.data?.reason||'当前没有可用财报日历数据。'}/>:
     <>
      {earnings.data.items.length===0?<Message text={earnings.data.reason}/>:earnings.data.items.map((x,i)=><div className="deep-data-row" key={x.date+i}>
       <div><strong>{x.date}</strong><small>{x.time||'发布时间待公布'} · {x.status==='reported'?'已报告':'待报告'}</small></div>
       <span>预期 EPS {x.epsEstimated==null?'—':x.epsEstimated.toFixed(2)} / 实际 {x.epsActual==null?'—':x.epsActual.toFixed(2)}</span>
      </div>)}
      <p className="deep-caption">{earnings.data.reason}</p>
     </>}
   </section>
   <section className="deep-panel">
    <div className="deep-panel-title"><div><FileText size={18}/><h3>正式公告时间线</h3></div><small>SEC / 巨潮资讯</small></div>
    {filings.loading?<p>正在查询官方披露…</p>:filings.error?<Message error text={filings.error}/>:
     <>{filings.data?.items.length?filings.data.items.slice(0,12).map((f,i)=><div className="deep-announcement-row" key={f.url+i}>
       <a className="deep-filing-row" href={f.url} target="_blank" rel="noopener noreferrer">
        <span className="form-tag">{f.form}</span><strong>{f.date}</strong><small>{f.title|| (f.reportDate?'报告期 '+f.reportDate:'正式披露')}</small><ExternalLink size={14}/>
       </a>
       {f.artCode&&<button className="announcement-open" onClick={()=>setSelectedAnnouncement(f.artCode!)}>正文解析 / PDF <ChevronDown size={14}/></button>}
      </div>):<Message text={filings.data?.notice||'暂无法查询公告。'}/>}
     {selectedAnnouncement&&<AnnouncementInspector code={selectedAnnouncement} onClose={()=>setSelectedAnnouncement(null)}/>}
     {filings.data&&<a className="deep-source-link" href={filings.data.sourceUrl} target="_blank" rel="noopener noreferrer">打开 {filings.data.provider} 官方来源 <ExternalLink size={14}/></a>}</>}
   </section>
   <section className="deep-panel">
    <div className="deep-panel-title"><div><Radar size={18}/><h3>关联催化时间线</h3></div><small>历史归档</small></div>
    {history.loading?<p>正在关联事件档案…</p>:history.error?<Message error text={history.error}/>:
     !history.data?.stored?<Message text="情报数据库未配置，无法读取长期历史。"/>:
     !history.data.items.length?<Message text="当前历史档案中暂无可通过证券代码或名称确认关联的事件。"/>:
     history.data.items.slice(0,6).map(item=><div className="compact-event" key={item.id}><span>{format(item.firstSeenAt)} · 线索</span><a target="_blank" rel="noopener noreferrer" href={item.url}>{item.title}<ExternalLink size={12}/></a></div>)}
    <div className="deep-caption">事件关联仅依赖可解释的标题匹配，不进行未经证明的产业链受益推断。</div>
   </section>
  </div>
 </div>;
}
