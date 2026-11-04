import {useMemo,useState} from 'react';
import {Search,ArrowUpRight,ArrowDownRight,ChevronDown} from 'lucide-react';
import type {Sector,PeersPayload} from '../../shared/desk-types';
import {t} from '../preferences';
import './StockSectorMap.css';

const pct=(value:number|null)=>value===null?'—':(value>=0?'+':'')+value.toFixed(2)+'%';
const heat=(value:number|null)=>value===null?'#2b2e35':`color-mix(in srgb, ${value>=0?'#df4b5b':'#168b76'} ${Math.min(82,25+Math.abs(value)*6)}%, #191b21)`;
export default function StockSectorMap({symbol,name,boards,selected,onBoard,onStock,peers,loading,error,memberLoading,memberError,onRetry}:{symbol:string;name?:string;boards:Sector[];selected?:Sector;onBoard:(code:string)=>void;onStock:(symbol:string)=>void;peers:PeersPayload|null;loading:boolean;error:string;memberLoading:boolean;memberError:string;onRetry:()=>void}){
 const [query,setQuery]=useState(''),[expanded,setExpanded]=useState(false);
 const matching=useMemo(()=>boards.filter(board=>!query||board.name.toLowerCase().includes(query.toLowerCase())),[boards,query]);
 const visible=expanded?matching:matching.slice(0,12),up=boards.filter(b=>(b.changePercent??0)>0).length,down=boards.filter(b=>(b.changePercent??0)<0).length;
 return <section className="stock-sector-map" aria-label={t('个股板块联动')}>
  <header><div><small>{name||symbol} <span>{name?symbol:''}</span></small><h2>{t('板块联动')}</h2></div><span className="stock-sector-count">{boards.length} {t('个所属板块')}</span></header>
  <div className="stock-sector-summary"><span><ArrowUpRight size={14}/><b>{up}</b> {t('上涨')}</span><span><ArrowDownRight size={14}/><b>{down}</b> {t('下跌')}</span><small>{t('仅展示该股归属')}</small></div>
  <label className="stock-sector-search"><Search size={16}/><input aria-label={t('筛选该股所属板块')} placeholder={t('筛选所属行业、概念…')} value={query} onChange={e=>setQuery(e.target.value)}/></label>
  <div className="stock-sector-caption"><span>{t('所属板块热力图')}</span><small>{t('色深表示涨跌幅')}</small></div>
  <div className="stock-sector-tiles">{visible.map(board=><button type="button" key={board.code} aria-pressed={board.code===selected?.code} onClick={()=>onBoard(board.code)} style={{background:heat(board.changePercent)}}><b>{board.name}</b><strong>{pct(board.changePercent)}</strong>{board.code===selected?.code&&<small>{t('正在查看')}</small>}</button>)}</div>
  {!visible.length&&<p className="stock-sector-empty">{t(loading?'正在读取该股所属板块…':error||'暂无匹配的所属板块')}{error&&<button onClick={onRetry}>{t('重试')}</button>}</p>}
  {matching.length>12&&<button className="stock-sector-more" onClick={()=>setExpanded(v=>!v)}>{t(expanded?'收起板块':'展开其余板块')} {!expanded&&matching.length-12}<ChevronDown size={14}/></button>}
  {selected&&<section className="stock-sector-members"><div className="stock-sector-members-heading"><h3>{selected.name}</h3><span>{peers?.related?t('相关分类参考')+' · '+peers.resolvedName:t('成分股表现')}</span></div><p className="stock-sector-member-note">{t('来源涨幅前16只 · 未读取全成分')}</p>
   <div className="stock-sector-stock-grid">{peers?.items.map(stock=><button type="button" key={stock.symbol} onClick={()=>onStock(stock.symbol)} className={stock.symbol===symbol?'current':''}><span><b>{stock.name}</b>{stock.symbol===symbol&&<em>{t('本股')}</em>}</span><small>{stock.symbol}</small><div><strong>{stock.price?.toFixed(2)||'—'}</strong><b style={{color:(stock.changePercent??0)>=0?'#f1737f':'#43bfa3'}}>{pct(stock.changePercent)}</b></div></button>)}</div>
   {!peers?.items.length&&<p className="stock-sector-empty">{t(memberLoading?'正在读取所选板块成分…':memberError||'来源暂无该板块成分')}{memberError&&<button onClick={onRetry}>{t('重试')}</button>}</p>}
   {(memberError||peers?.notice)&&<p className="stock-sector-member-note">{memberError||peers?.notice}</p>}
   <small className="stock-sector-member-note">{peers?.source}</small>
  </section>}
 </section>;
}
