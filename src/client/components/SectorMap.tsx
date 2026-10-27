import {useMemo,useState} from 'react';
import {useLiveEndpoint} from '../hooks/useLiveEndpoint';
import {t} from '../preferences';
import './SectorMap.css';
type Board={code:string;name:string;count:number;amount:number|null;changePercent:number;leader:string;leaderSymbol:string|null};
type MapData={items:Board[];source:string;notice:string};
type Detail={state:string;outlook:string;notice:string;breadth:{up:number;down:number;flat:number;covered:number;total:number;positiveShare:number|null};members:{symbol:string;name:string;changePercent:number|null;price:number|null}[];related:Board[]};
const pct=(n:number|null)=>n==null?'—':(n>=0?'+':'')+n.toFixed(2)+'%';
export default function SectorMap({onStock}:{onStock:(symbol:string)=>void}){
 const [type,setType]=useState('concept'),[query,setQuery]=useState(''),[selected,setSelected]=useState<Board|null>(null);
 const data=useLiveEndpoint<MapData>('/api/desk/sector-map?type='+type,0,false);
 const detail=useLiveEndpoint<Detail>(selected?'/api/desk/sector-detail?code='+encodeURIComponent(selected.code):'',0,false);
 const items=useMemo(()=>(data.data?.items||[]).filter(b=>!query||b.name.includes(query)).slice().sort((a,b)=>(b.amount||0)-(a.amount||0)).slice(0,36),[data.data,query]);
 return <section className="market-surface sector-map"><header><div><h2>{t('主题雷达')}</h2><small>{t('概念与行业分开 · 点击色块看扩散与龙头')}</small></div><div><button aria-pressed={type==='concept'} onClick={()=>{setType('concept');setSelected(null);}}>{t('概念')}</button><button aria-pressed={type==='industry'} onClick={()=>{setType('industry');setSelected(null);}}>{t('行业')}</button></div></header>
  <input placeholder={t('搜索概念，例如机器人、创新药')} aria-label={t('搜索概念')} value={query} onChange={e=>setQuery(e.target.value)}/>
  <div className="theme-presets">{['全部','机器人','创新药','半导体','新能源'].map(s=><button key={s} onClick={()=>setQuery(s==='全部'?'':s)}>{t(s)}</button>)}</div>
  <div className="sector-treemap">{items.map((s,i)=><button key={s.code} className={i<4?'large':''} onClick={()=>setSelected(s)} style={{background:`color-mix(in srgb, ${s.changePercent>=0?'#e75969':'#1aaf91'} ${Math.min(40,10+Math.abs(s.changePercent)*7)}%, var(--panel))`}}><b>{s.name}</b><strong className={s.changePercent>=0?'positive':'negative'}>{pct(s.changePercent)}</strong><small>{t('成分')} {s.count}</small></button>)}</div>
  {!items.length&&<p className="market-empty">{t(data.loading?'读取概念热力图…':data.error||'当前分类暂无匹配主题')}</p>}
  {selected&&<div className="sector-focus"><h3>{selected.name} <span className={selected.changePercent>=0?'positive':'negative'}>{pct(selected.changePercent)}</span></h3>{detail.data?<><h4>{t(detail.data.state)}</h4><div className="sector-breadth"><i style={{flex:detail.data.breadth.up||.01,background:'#e75969'}}/><i style={{flex:detail.data.breadth.flat||.01,background:'#888'}}/><i style={{flex:detail.data.breadth.down||.01,background:'#1aaf91'}}/></div><p>{t('上涨')} {detail.data.breadth.up} · {t('下跌')} {detail.data.breadth.down} · {t('成分覆盖')} {detail.data.breadth.covered}/{detail.data.breadth.total}</p><p>{t(detail.data.outlook)}</p><div className="sector-stock-tiles">{detail.data.members.slice(0,18).map(s=><button key={s.symbol} onClick={()=>onStock(s.symbol)}><b>{s.name}</b><strong className={(s.changePercent||0)>=0?'positive':'negative'}>{pct(s.changePercent)}</strong><small>{s.symbol} · {s.price?.toFixed(2)||'—'}</small></button>)}</div><small>{t(detail.data.notice)}</small></>:<p>{t(detail.loading?'核验板块成分…':detail.error)}</p>}</div>}
  <p className="market-source">{t(data.data?.source||'')} · {t(data.data?.notice||'')}</p>
 </section>;
}
