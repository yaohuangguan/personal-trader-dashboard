import {t as uiText} from '../preferences';
import { useEffect,useState } from 'react';
import { Activity, ArrowRight, BookOpenCheck, CalendarClock, ChevronDown, CircleAlert, Clock3, ExternalLink, FileText, LoaderCircle, Radar, RefreshCw, ShieldCheck, DatabaseZap, XCircle } from 'lucide-react';
import { NEWS_CATEGORIES } from '../../shared/catalog';
import type { NewsItem } from '../../shared/types';
import {useReader} from './InAppReader';

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
function Message({text,error=false}:{text:string;error?:boolean}){return <div className={'intel-message '+(error?'error':'')}><CircleAlert size={16}/><span>{uiText(text)}</span></div>;}
function TimelineCard({item,onStock}:{item:IntelItem;onStock?:(symbol:string)=>void}){
 const {openNews}=useReader();
 return <article className="event-card">
  <div className="event-date"><strong>{uiText(format(item.firstSeenAt))}</strong><small>{uiText("首次发现")}</small></div>
  <div className="event-card-body">
   <div className="event-badges"><span className="intel-evidence">{uiText("媒体线索 · 未核验订单")}</span>{uiText(item.sectors.map(s=><span className="event-sector" key={s}>{uiText(sectorName(s))}</span>))}</div>
   <button type="button" className="event-title-button" onClick={()=>openNews(item)}>{(item.title)} <BookOpenCheck size={13}/></button>
   <div className="event-metadata">{uiText(item.source)} {uiText("· 报道")}{uiText(format(item.publishedAt))} {uiText("· 累计扫描命中")}{uiText(item.sightings)} {uiText("次")}</div>
   {uiText(item.tickers.length>0&&<div className="event-tickers">{uiText(item.tickers.map(s=><button key={s} onClick={()=>onStock?.(s)}>{uiText(s)}<ArrowRight size={12}/></button>))}</div>)}
  </div>
 </article>;
}
export function OverviewIntelStrip({onOpen}:{onOpen:()=>void}){
 const {loading,data,error}=useEndpoint<Summary>('/api/intelligence/summary');
 return <section className="intel-status-strip" aria-label={uiText("情报扫描归档状态")}>
  <div className="intel-stat"><DatabaseZap size={20}/><div><strong>{uiText(loading?'…':data?.total??'—')}</strong><span>{uiText("历史情报条目")}</span></div></div>
  <div className="intel-stat"><Radar size={20}/><div><strong>{uiText(loading?'…':data?.new24h??'—')}</strong><span>{uiText("近24小时新发现")}</span></div></div>
  <div className="intel-stat"><Clock3 size={20}/><div><strong className="intel-small-stat">{uiText(data?.lastRun?format(data.lastRun.finished_at):'等待扫描')}</strong><span>{uiText("最近一次扫描")}</span></div></div>
  <button className="intel-open" onClick={onOpen}>{uiText("事件档案")}<ArrowRight size={16}/></button>
  {uiText((error||data?.reason)&&<div className="intel-mini-warning">{uiText(error||data?.reason)}</div>)}
 </section>;
}
export function IntelHistory({onStock}:{onStock:(symbol:string)=>void}){
 const [category,setCategory]=useState('all'),[onlyNew,setOnlyNew]=useState(false);
 const {loading,data,error,refresh}=useEndpoint<IntelList>('/api/intelligence?category='+encodeURIComponent(category)+'&limit=90&new='+(onlyNew?'1':'0'));
 const summary=useEndpoint<Summary>('/api/intelligence/summary');
 return <div className="intel-history-view">
  <div className="intel-page-hero"><div className="eyebrow">DURABLE INTELLIGENCE / EVENT LOG</div><h2>{uiText("可追溯的全球情报档案")}</h2><p>{uiText("从一次性的新闻流升级为长期事件记录：什么时候首次发现，之后出现了几次，涉及哪些产业和股票。")}</p></div>
  <div className="history-stats">
   <div><span>{uiText("累计事件")}</span><strong>{uiText(summary.data?.total??'—')}</strong></div>
   <div><span>{uiText("近24小时首次发现")}</span><strong>{uiText(summary.data?.new24h??'—')}</strong></div>
   <div><span>{uiText("最近扫描入库")}</span><strong>{uiText(summary.data?.lastRun?.new_events??'—')}</strong></div>
   <div><span>{uiText("最近扫描警告")}</span><strong>{uiText(summary.data?.lastRun?.warning_count??'—')}</strong></div>
  </div>
  <div className="intel-filter-bar"><select aria-label={uiText("产业线索筛选")} value={category} onChange={e=>setCategory(e.target.value)}>{uiText(NEWS_CATEGORIES.map(x=><option key={x.id} value={x.id}>{uiText(x.name)}</option>))}</select>
   <label><input type="checkbox" checked={onlyNew} onChange={e=>setOnlyNew(e.target.checked)}/> {uiText("只看近24小时新发现")}</label>
   <button onClick={()=>{refresh();summary.refresh();}}><RefreshCw size={15}/> {uiText("刷新档案")}</button>
  </div>
  <div className="event-history-panel">
   {uiText(loading?<div className="intel-loading"><LoaderCircle className="spin" size={20}/> {uiText("正在查询历史情报…")}</div>:
    error?<Message error text={uiText(error)}/>:
    !data?.stored?<Message text={uiText(data?.reason||'持久化尚未启用。')}/>:
    data.items.length===0?<Message text={uiText("没有符合当前条件的历史事件。等待下次扫描，或切换筛选条件。")}/>:
    data.items.map(item=><TimelineCard key={item.id} item={item} onStock={onStock}/>))}
  </div>
  <Message text={uiText("每条记录初始状态均为「媒体线索」。同一新闻再次出现只增加观测次数；不等于订单验证或利润兑现。")}/>
 </div>;
}
type Announcement={title:string;date:string;content:string;pdfUrl:string|null;tags:string[];provider:string};
function AnnouncementInspector({code,onClose}:{code:string;onClose:()=>void}){
 const detail=useEndpoint<Announcement>('/api/announcement?code='+encodeURIComponent(code));
 return <div className="announcement-inspector">
  <div className="announcement-inspector-title"><strong>{uiText("公告原文解析")}</strong><button onClick={onClose}>{uiText("关闭 ×")}</button></div>
  {uiText(detail.loading?<p>{uiText("正在读取公告正文…")}</p>:detail.error?<Message error text={uiText(detail.error)}/>:
   detail.data&&<>
    <h4>{(detail.data.title)}</h4><p className="deep-caption">{uiText(detail.data.provider)} · {uiText(detail.data.date)}</p>
    <div className="event-badges">{uiText(detail.data.tags.map(tag=><span key={tag} className="event-sector">{uiText(tag)}</span>))}</div>
    <p className="deep-caption">{uiText("标签仅通过标题关键词识别；以下为来源提供的正文摘录，不是模型生成的结论。")}</p>
    <div className="announcement-excerpt">{(detail.data.content||uiText('仅有附件，无可提取正文。'))}</div>
    {uiText(detail.data.pdfUrl&&<div className="inapp-pdf"><p>{uiText("PDF 附件 · 通过本站安全阅读端点加载")}</p><iframe title={uiText("公告 PDF")} src={"/api/announcement-pdf?code="+encodeURIComponent(code)} loading="lazy"/></div>)}
   </>)}
 </div>;
}
export function StockResearchExtras({symbol,onStock}:{symbol:string;onStock:(symbol:string)=>void}){
 const [selectedAnnouncement,setSelectedAnnouncement]=useState<string|null>(null);
 const {openNews,openFiling}=useReader();
 const news=useEndpoint<StockNews>('/api/stock/news?symbol='+encodeURIComponent(symbol));
 const earnings=useEndpoint<Earnings>('/api/earnings-calendar?symbol='+encodeURIComponent(symbol));
 const filings=useEndpoint<Filings>('/api/filings?symbol='+encodeURIComponent(symbol));
 const history=useEndpoint<IntelList>('/api/intelligence?symbol='+encodeURIComponent(symbol)+'&limit=20&category=all');
 return <div className="deep-research">
  <div className="deep-research-heading"><div className="eyebrow">PRIMARY EVIDENCE / COMPANY INTELLIGENCE</div><h2>{uiText("公司新闻、财报与公告证据链")}</h2><p>{uiText("分开列出媒体报道、财报日历与交易所/SEC 正式披露，绝不把传闻自动当成业绩兑现。")}</p></div>
  <div className="deep-grid">
   <section className="deep-panel">
    <div className="deep-panel-title"><div><BookOpenCheck size={18}/><h3>{uiText("公司相关报道")}</h3></div><small>{uiText("标题匹配 · 需核验")}</small></div>
    {uiText(news.loading?<p>{uiText("正在寻找公司相关报道…")}</p>:news.error?<Message error text={uiText(news.error)}/>:
     !news.data?.items.length?<Message text={uiText(news.data?.notice||'暂未在当前新闻范围内找到公司相关报道。')}/>:
      news.data.items.slice(0,10).map((n,i)=><div className="deep-link-row" key={n.url+i}><span>{uiText(n.source)} · {uiText(format(n.publishedAt))}</span><button type="button" className="deep-link-button" onClick={()=>openNews(n)}>{(n.title)} <BookOpenCheck size={12}/></button></div>))}
    <div className="deep-caption">{uiText(news.data?.notice||'相关新闻须核实上市公司是否真正受益。')}</div>
   </section>
   <section className="deep-panel">
    <div className="deep-panel-title"><div><CalendarClock size={18}/><h3>{uiText("财报日历")}</h3></div><small>{uiText("独立授权数据源")}</small></div>
    {uiText(earnings.loading?<p>{uiText("正在查询财报日历…")}</p>:earnings.error?<Message error text={uiText(earnings.error)}/>:
    !earnings.data?.available?<Message text={uiText(earnings.data?.reason||'当前没有可用财报日历数据。')}/>:
     <>
      {uiText(earnings.data.items.length===0?<Message text={uiText(earnings.data.reason)}/>:earnings.data.items.map((x,i)=><div className="deep-data-row" key={x.date+i}>
       <div><strong>{uiText(x.date)}</strong><small>{uiText(x.time||'发布时间待公布')} · {uiText(x.status==='reported'?'已报告':'待报告')}</small></div>
       <span>{uiText("预期 EPS")}{uiText(x.epsEstimated==null?'—':x.epsEstimated.toFixed(2))} {uiText("/ 实际")}{uiText(x.epsActual==null?'—':x.epsActual.toFixed(2))}</span>
      </div>))}
      <p className="deep-caption">{uiText(earnings.data.reason)}</p>
     </>)}
   </section>
   <section className="deep-panel">
    <div className="deep-panel-title"><div><FileText size={18}/><h3>{uiText("正式公告时间线")}</h3></div><small>{uiText("SEC / 巨潮资讯")}</small></div>
    {uiText(filings.loading?<p>{uiText("正在查询官方披露…")}</p>:filings.error?<Message error text={uiText(filings.error)}/>:
     <>{uiText(filings.data?.items.length?filings.data.items.slice(0,12).map((f,i)=><div className="deep-announcement-row" key={f.url+i}>
       <button type="button" className="deep-filing-row deep-filing-button" onClick={()=>f.artCode?setSelectedAnnouncement(f.artCode):openFiling(symbol,f.form,f.date,f.title)}>
        <span className="form-tag">{uiText(f.form)}</span><strong>{uiText(f.date)}</strong><small>{uiText(f.title|| (f.reportDate?'报告期 '+f.reportDate:'正式披露'))}</small><BookOpenCheck size={14}/>
       </button>
       {uiText(f.artCode&&<button className="announcement-open" onClick={()=>setSelectedAnnouncement(f.artCode!)}>{uiText("正文解析 / PDF")}<ChevronDown size={14}/></button>)}
      </div>):<Message text={uiText(filings.data?.notice||'暂无法查询公告。')}/>)}
     {uiText(selectedAnnouncement&&<AnnouncementInspector code={selectedAnnouncement} onClose={()=>setSelectedAnnouncement(null)}/>)}
     {uiText(filings.data&&<p className="deep-caption">{uiText("来源：")}{uiText(filings.data.provider)} · {uiText(filings.data.notice)}</p>)}</>)}
   </section>
   <section className="deep-panel">
    <div className="deep-panel-title"><div><Radar size={18}/><h3>{uiText("关联催化时间线")}</h3></div><small>{uiText("历史归档")}</small></div>
    {uiText(history.loading?<p>{uiText("正在关联事件档案…")}</p>:history.error?<Message error text={uiText(history.error)}/>:
     !history.data?.stored?<Message text={uiText("情报数据库未配置，无法读取长期历史。")}/>:
     !history.data.items.length?<Message text={uiText("当前历史档案中暂无可通过证券代码或名称确认关联的事件。")}/>:
     history.data.items.slice(0,6).map(item=><div className="compact-event" key={item.id}><span>{uiText(format(item.firstSeenAt))} {uiText("· 线索")}</span><button type="button" className="deep-link-button" onClick={()=>openNews(item)}>{(item.title)}<BookOpenCheck size={12}/></button></div>))}
    <div className="deep-caption">{uiText("事件关联仅依赖可解释的标题匹配，不进行未经证明的产业链受益推断。")}</div>
   </section>
  </div>
 </div>;
}
