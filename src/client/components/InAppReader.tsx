import {newsLink,readNewsLink} from '../../shared/news-link';
import {t as uiText} from '../preferences';
import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {ArrowLeft,BookOpen,CalendarDays,Copy,FileText,Info,LoaderCircle,Newspaper,ShieldCheck,X} from 'lucide-react';
import type {FundamentalsPayload,MarketPayload,NewsItem} from '../../shared/types';

type ReadingItem =
 | {kind:'news'; item:NewsItem}
 | {kind:'filing';symbol:string;form:string;date:string;title?:string}
 | {kind:'finance';data:FundamentalsPayload}
 | {kind:'market';data:MarketPayload};
type ReaderContextValue={openNews:(news:NewsItem)=>void;openFiling:(symbol:string,form:string,date:string,title?:string)=>void;openFinance:(data:FundamentalsPayload)=>void;openMarket:(data:MarketPayload)=>void};
const ReaderContext=createContext<ReaderContextValue|null>(null);
export function useReader(){const context=useContext(ReaderContext);if(!context)throw new Error('InAppReader provider missing');return context;}
const pretty=(raw:string|null|undefined)=>raw?new Intl.DateTimeFormat('zh-CN',{timeZone:'Pacific/Auckland',dateStyle:'medium',timeStyle:'short'}).format(new Date(raw)):'时间未提供';
type FilingDocument={available:boolean;content:string;title:string;notice:string;provider:string;publishedAt:string;sourceUrl:string};
function OfficialDocument({symbol,form,date}:{symbol:string;form:string;date:string}){
 const [state,setState]=useState<{loading:boolean;data:FilingDocument|null;error:string}>({loading:true,data:null,error:''});
 useEffect(()=>{
  const ctrl=new AbortController();
  setState({loading:true,data:null,error:''});
  fetch('/api/filing-document?symbol='+encodeURIComponent(symbol)+'&form='+encodeURIComponent(form)+'&date='+encodeURIComponent(date),{signal:ctrl.signal})
  .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.details||data.error||'披露数据暂不可用');return data as FilingDocument;})
  .then(data=>{if(!ctrl.signal.aborted)setState({loading:false,data,error:''});})
  .catch(err=>{if(!ctrl.signal.aborted)setState({loading:false,data:null,error:String(err)});});
  return ()=>ctrl.abort();
 },[symbol,form,date]);
 if(state.loading)return <div className="reader-state"><LoaderCircle className="spin" size={22}/> {uiText("正在从披露源获取文件…")}</div>;
 if(state.error)return <p className="reader-notice">{uiText("披露源暂不可用：")}{uiText(state.error)}{uiText("。本站不会显示假正文。")}</p>;
 if(!state.data?.available)return <p className="reader-notice">{uiText(state.data?.notice||'暂时无法读取披露正文。')}</p>;
 return <section className="reader-body"><div className="reader-section-title">{uiText("披露内容")}<span>{uiText("来源：")}{uiText(state.data.provider)}</span></div>
  <p className="reader-notice">{uiText(state.data.notice)}</p>
  <div className="reader-document">{(state.data.content||uiText('当前文件无可提取的文本，请以正式披露为准。'))}</div>
 </section>;
}
function ReaderContents({selection}:{selection:ReadingItem}){
 if(selection.kind==='news'){
  const n=selection.item;
  let host='新闻来源';try{host=new URL(n.url).hostname.replace(/^www\./,'');}catch{}
  return <>
   <span className="reader-type"><Newspaper size={15}/> {uiText("新闻与产业线索")}</span>
   <h2>{(n.title)}</h2>
   <div className="reader-facts"><span>{uiText(n.source)}</span><span>{uiText(pretty(n.publishedAt))}</span><span>{uiText(host)}</span></div>
   <section className="reader-body">
    <div className="reader-section-title">{uiText("来源提供的新闻摘要")}</div>
    {uiText(n.summary?<p className="reader-excerpt">{(n.summary)}</p>:<p className="reader-notice">{uiText("该资讯源仅提供了标题、日期与出处，未授权提供正文。本站不推测正文，也不把标题扩写成未经核实的新闻内容。")}</p>)}
    <div className="reader-section-title">{uiText("证据边界")}</div>
    <p className="reader-notice">{uiText("这是媒体信息线索，不代表公司订单、收入或利润已经兑现。需要结合正式公告、财报和不同来源交叉验证。")}</p>
    <div className="reader-provenance"><ShieldCheck size={17}/> {uiText("已保留来源归属；在本站阅读，不跳转第三方网页。")}</div>
   </section>
  </>;
 }
 if(selection.kind==='filing')return <>
  <span className="reader-type"><FileText size={15}/> {uiText("公司官方披露")}</span>
  <h2>{(selection.title||selection.symbol+' · '+selection.form)}</h2>
  <div className="reader-facts"><span>{uiText(selection.symbol)}</span><span>{uiText(selection.form)}</span><span>{uiText(selection.date)}</span></div>
  <OfficialDocument symbol={selection.symbol} form={selection.form} date={selection.date}/>
 </>;
 if(selection.kind==='market')return <>
  <span className="reader-type"><Info size={15}/> {uiText("行情数据口径")}</span>
  <h2>{uiText(selection.data.symbol)} {uiText("· 数据来源说明")}</h2>
  <div className="reader-facts"><span>{uiText(selection.data.provider)}</span><span>{uiText("最后交易日")}{uiText(selection.data.asOf||'未知')}</span></div>
  <section className="reader-body"><div className="reader-section-title">{uiText("行情来源和注意事项")}</div>
   <p>{uiText(selection.data.notice)}</p><p className="reader-notice">{uiText("价格为历史日线，并非交易所实时盘口。复权方法、币种、成交量单位和市场假期都可能影响量价时空分析。")}</p>
  </section>
 </>;
 return <>
  <span className="reader-type"><CalendarDays size={15}/> {uiText("结构化财务资料")}</span>
  <h2>{uiText(selection.data.company||selection.data.symbol)} {uiText("· 财务数据口径")}</h2>
  <div className="reader-facts"><span>{uiText(selection.data.provider)}</span><span>{uiText(selection.data.symbol)}</span></div>
  <section className="reader-body"><p>{uiText(selection.data.notice)}</p>
   <div className="reader-section-title">{uiText("本站可用数据")}</div>
   {uiText((selection.data.revenue?.length||0)>0&&<p>{uiText("已收录")}{uiText(selection.data.revenue?.length)} {uiText("个年度营收数据点。")}</p>)}
   {uiText((selection.data.netIncome?.length||0)>0&&<p>{uiText("已收录")}{uiText(selection.data.netIncome?.length)} {uiText("个年度净利润数据点。")}</p>)}
   {uiText(!selection.data.available&&<p className="reader-notice">{uiText("需要合规数据源支持；当前没有可以直接呈现的正式财报数据。")}</p>)}
   <p className="reader-notice">{uiText("财务数据来自披露的结构化科目。正式原始报告可在「公告时间线」中于本站打开，核验会计口径。")}</p>
  </section>
 </>;
}
export function InAppReaderProvider({children}:{children:ReactNode}){
 const [selected,setSelected]=useState<ReadingItem|null>(null);
 const close=useCallback(()=>{setSelected(null);const u=new URL(location.href);u.searchParams.delete('article');history.replaceState(null,'',u);},[]);
 useEffect(()=>{const raw=new URLSearchParams(location.search).get('article');if(raw){const item=readNewsLink(raw);if(item)setSelected({kind:'news',item});}},[]);
 useEffect(()=>{
  if(!selected)return;
  const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();close();}};
  window.addEventListener('keydown',onKey);
  const old=document.body.style.overflow;document.body.style.overflow='hidden';
  return ()=>{window.removeEventListener('keydown',onKey);document.body.style.overflow=old;};
 },[selected,close]);
 const actions=useMemo<ReaderContextValue>(()=>({
  openNews:item=>setSelected({kind:'news',item}),
  openFiling:(symbol,form,date,title)=>setSelected({kind:'filing',symbol,form,date,title}),
  openFinance:data=>setSelected({kind:'finance',data}),
  openMarket:data=>setSelected({kind:'market',data})
 }),[]);
 return <ReaderContext.Provider value={actions}>
  {uiText(children)}
  {uiText(selected&&<div className="reader-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
   <div className="reader-modal" role="dialog" aria-modal="true" aria-label={uiText("站内资料阅读器")}>
    <header className="reader-header"><span><BookOpen size={19}/> MARKET ATLAS <em>/ READER</em></span><button onClick={close} aria-label={uiText("关闭站内阅读器")}><X size={20}/></button></header>
    <div className="reader-scroll"><ReaderContents selection={selected}/></div>
    <footer className="reader-footer"><button onClick={close}><ArrowLeft size={15}/> {uiText("返回研究工作台")}</button>{selected.kind==='news'&&<button onClick={async()=>{await navigator.clipboard.writeText(newsLink(selected.item,location.origin));}}><Copy size={15}/>{uiText("复制站内链接")}</button>}<span>{uiText("站内阅读 · 来源可追溯")}</span></footer>
   </div>
  </div>)}
 </ReaderContext.Provider>;
}
