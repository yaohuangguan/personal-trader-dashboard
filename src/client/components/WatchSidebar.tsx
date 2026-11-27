import {editWatch,useWatchState} from '../watch-store';
import ExtendedQuote from './ExtendedQuote';
import {supportedStock} from '../../shared/market-clock';
import WatchTransfer from './WatchTransfer';
import WatchInsight from './WatchInsight';
import {useWatchInsights} from '../hooks/useWatchInsights';
import {useIntradaySpark} from '../hooks/useIntradaySpark';
import {useQuotes} from '../quote-store';
import {rankWatch,watchPhase,WATCH_PHASES,type WatchPhase} from '../../shared/watch-insight';
import {useState,useEffect,useRef,useLayoutEffect} from 'react';
import {createPortal} from 'react-dom';
import {Star,Plus,Search,LayoutGrid,X,Folder} from 'lucide-react';
import {t} from '../preferences';
import type {Candle,MarketPayload} from '../../shared/types';
import type {WatchGroup} from '../watch-ops';

/** True while the element is on screen; drives every per-row subscription. */
function useVisible<T extends Element>(){
 const ref=useRef<T>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const o=new IntersectionObserver(e=>setVisible(e[0].isIntersecting));if(ref.current)o.observe(ref.current);return()=>o.disconnect();},[]);
 return [ref,visible] as const;
}
function sparkPath(values:number[],reference:number|null){
 const lo=Math.min(...values,reference??Infinity),hi=Math.max(...values,reference??-Infinity),y=(v:number)=>3+(hi-v)/(hi-lo||1)*26;
 return {y,path:values.map((v,i)=>`${i?'L':'M'}${(i/(values.length-1)*64).toFixed(1)},${y(v).toFixed(1)}`).join(' '),up:values.at(-1)!>=(reference??values[0])};
}
/** A-share rows: today's intraday line. US rows: recent daily closes when daily K data is already loaded. */
function Mini({symbol,daily}:{symbol:string;daily?:Candle[]}){
 const [ref,visible]=useVisible<HTMLSpanElement>();
 const intraday=useIntradaySpark(symbol,visible);
 const values=intraday?.points.map(p=>p.price)||daily?.slice(-30).map(c=>c.close)||[];
 const reference=intraday?intraday.previous:daily?.at(-31)?.close??null;
 if(values.length<2)return <span ref={ref} className="watch-spark is-empty" aria-hidden/>;
 const {y,path,up}=sparkPath(values,reference),label=intraday?t('当日分时')+' '+(intraday.date||''):t('近30日收盘');
 return <span ref={ref} className="watch-spark" title={label}><svg viewBox="0 0 64 32" role="img" aria-label={label}>{reference!=null&&intraday&&<line x1="0" x2="64" y1={y(reference)} y2={y(reference)} stroke="#777" strokeDasharray="2 2" strokeWidth=".4"/>}<path d={path} fill="none" stroke={up?'var(--up)':'var(--down)'} strokeWidth="1.2"/></svg></span>;
}
/** "···" row menu rendered in a portal so the scrolling list cannot clip it. */
function RowMenu({symbol,groups,onRemove}:{symbol:string;groups:WatchGroup[];onRemove:(s:string)=>void}){
 const [open,setOpen]=useState(false),[pos,setPos]=useState({top:0,left:0}),button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{const r=button.current!.getBoundingClientRect(),h=menu.current?.offsetHeight||200,w=220;setPos({left:Math.max(8,Math.min(r.right-w,innerWidth-w-8)),top:r.bottom+h+8<innerHeight?r.bottom+4:Math.max(8,r.top-h-4)});};
  place();
  const outside=(e:PointerEvent)=>{if(!menu.current?.contains(e.target as Node)&&!button.current?.contains(e.target as Node))setOpen(false);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  requestAnimationFrame(()=>menu.current?.querySelector<HTMLElement>('input,button')?.focus());
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open]);
 return <><button ref={button} type="button" className="watch-row-menu" aria-haspopup="true" aria-expanded={open} aria-label={t('设置分组')+' '+symbol} onClick={()=>setOpen(v=>!v)}>···</button>
  {open&&createPortal(<div ref={menu} className="watch-row-popover" role="dialog" aria-label={t('设置分组')+' '+symbol} style={pos}>
   {groups.length?groups.map(g=><label key={g.id}><input type="checkbox" checked={g.symbols.includes(symbol)} onChange={e=>editWatch({kind:'group-member',id:g.id,symbol,member:e.target.checked})}/>{g.name}</label>):<span>{t('先创建分组')}</span>}
   <button type="button" onClick={()=>{setOpen(false);onRemove(symbol);}}>{t('移除自选')}</button>
  </div>,document.body)}</>;
}

export default function WatchSidebar({watchlist,markets,selected,onStock,onSearch,onRemove,onWorkspace,onClose}:{watchlist:string[];markets:Record<string,MarketPayload>;selected:string;onStock:(s:string)=>void;onSearch:()=>void;onRemove:(s:string)=>void;onWorkspace:()=>void;onClose:()=>void}){
 const [filter,setFilter]=useState(''),{groups}=useWatchState(),[group,setGroup]=useState(''),[phase,setPhase]=useState<WatchPhase>('all'),[editing,setEditing]=useState(false),[name,setName]=useState(''),[error,setError]=useState('');
 const cn=watchlist.filter(s=>supportedStock(s)),{quotes}=useQuotes(cn),current=groups.find(g=>g.id===group);
 const preset=group==='@trend'||group==='@five',insights=useWatchInsights(preset?cn:[]),ordered=group==='@trend'?rankWatch(watchlist,insights):watchlist;
 const counts=Object.fromEntries(Object.keys(WATCH_PHASES).map(p=>[p,p==='all'?watchlist.length:watchlist.filter(s=>watchPhase(insights[s])===p).length]));
 function save(renaming=false){const value=name.trim();if(!value||value.length>24){setError('分组名称需要1–24个字');return;}if(groups.some(g=>g.name===value&&(!renaming||g.id!==group))){setError('分组名称已存在');return;}if(renaming&&current)editWatch({kind:'group-rename',id:group,name:value});else if(groups.length<20){const id=crypto.randomUUID();editWatch({kind:'group-create',id,name:value});setGroup(id);}else{setError('最多创建20个分组');return;}setEditing(false);setError('');setName('');}
 const query=filter.trim().toLowerCase();
 const rows=ordered.filter(s=>(!current||current.symbols.includes(s))&&(group!=='@five'||phase==='all'||watchPhase(insights[s])===phase));
 return <><div className="watch-sidebar-heading"><h2><Star size={18}/>{t('我的自选')} <small>{watchlist.length}</small></h2><button className="icon-button" onClick={onSearch} aria-label={t('搜索并添加自选')}><Plus size={20}/></button><button className="icon-button mobile-close" onClick={onClose} aria-label={t('关闭导航')}><X size={20}/></button></div>

 <div className="watch-group-bar"><select aria-label={t('自选分组')} value={group} onChange={e=>setGroup(e.target.value)}><option value="">{t('全部自选')}</option><optgroup label={t('动态分组')}><option value="@trend">{t('今日走势排序')}</option><option value="@five">{t('五线量价')}</option></optgroup>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select><button className="icon-button" aria-label={t('管理分组')} onClick={()=>{setEditing(v=>!v);setName(current?.name||'');}}><Folder size={17}/></button><details className="watch-tools"><summary aria-label={t('自选管理')}>···</summary><div><WatchTransfer compact/><button onClick={onSearch}>{t('添加自选')}</button></div></details></div>
 {editing&&<div className="watch-group-editor"><input maxLength={24} value={name} onChange={e=>setName(e.target.value)} placeholder={t('分组名称')} aria-label={t('分组名称')}/><button onClick={()=>save()}>{t('创建分组')}</button>{current&&<><button onClick={()=>save(true)}>{t('重命名')}</button><button onClick={()=>{editWatch({kind:'group-delete',id:group});setGroup('');setEditing(false);}}>{t('删除分组（保留自选）')}</button></>}{error&&<p role="alert">{t(error)}</p>}</div>}
 {preset&&<div className="watch-preset-info"><span>{t(group==='@trend'?'走势评分从高到低，待更新项置后':'经典均线 · 按量价研判阶段筛选')}</span>{group==='@five'&&<select aria-label={t('五线状态')} value={phase} onChange={e=>setPhase(e.target.value as WatchPhase)}>{Object.entries(WATCH_PHASES).map(([id,label])=><option key={id} value={id}>{t(label)} · {counts[id]}</option>)}</select>}</div>}
 <label className="watch-sidebar-search"><Search size={16}/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder={t('筛选名称或代码')}/></label><div className="watch-sidebar-list">{rows.map(symbol=>{
  const q=quotes.get(symbol),m=markets[symbol],name=q?.name||m?.name||symbol,price=q?.price??m?.last,change=q?.changePercent??m?.changePercent;
  if(query&&!name.toLowerCase().includes(query)&&!symbol.toLowerCase().includes(query))return null;
  const tone=change==null?'':change>=0?'positive':'negative';
  return <div className={'watch-sidebar-row '+(selected===symbol?'active':'')} key={symbol}><button onClick={()=>{onStock(symbol);onClose();}} title={name!==symbol?name+' · '+symbol:symbol}><span><b>{name}</b><small>{symbol}</small></span><Mini symbol={symbol} daily={m?.candles}/><span><strong className={'watch-price '+tone}>{price==null?'—':price.toFixed(2)}</strong><small className={tone}>{change==null?'—':(change>=0?'+':'')+change.toFixed(2)+'%'}</small></span></button><ExtendedQuote symbol={symbol}/><WatchInsight symbol={symbol} data={insights[symbol]} managed={preset}/><RowMenu symbol={symbol} groups={groups} onRemove={onRemove}/></div>;
 })}{!watchlist.length&&<p>{t('暂无自选，点击 + 添加')}</p>}</div><button className="watch-workspace-button" onClick={onWorkspace}><LayoutGrid size={19}/>{t('返回工作区导航')}</button></>;
}
