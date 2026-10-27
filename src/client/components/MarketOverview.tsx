import SectorMap from './SectorMap';
import MarketChart from './MarketChart';
import type {Candle} from '../../shared/types';
import {t as uiText} from '../preferences';
import {useMemo,useState} from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {RefreshCw,ArrowUpRight,Star} from 'lucide-react';
import {useLiveEndpoint} from '../hooks/useLiveEndpoint';
import type {QuotesPayload,IntradayPayload,SectorRanks,PeersPayload} from '../../shared/desk-types';
import type {RankedStock,GainersPayload,PoolsPayload,DragonPayload} from '../../shared/market-overview';
import {marketSentiment} from '../../shared/market-models';
import IntradayChart from './IntradayChart';
import {FlashNewsDesk} from './ResearchDesk';
import './MarketOverview.css';
const indices=['000001.SH','399001.SZ','399006.SZ','000300.SH','000688.SH'];
const names=['上证指数','深证成指','创业板指','沪深300','科创50'];
const pct=(n:number|null|undefined)=>n==null?'—':(n>=0?'+':'')+n.toFixed(2)+'%';
const tone=(n:number|null|undefined)=>n==null?'':n>=0?'is-up':'is-down';
export default function MarketOverview({onStock,onWatch,watchlist}:{onStock:(s:string)=>void;onWatch:(s:string)=>void;watchlist:string[]}){
 const [timeframe,setTimeframe]=useState('day');
 const [index,setIndex]=useState(indices[0]),[tab,setTab]=useState('gainers'),[sector,setSector]=useState(''),[search,setSearch]=useState('');
 const quotes=useLiveEndpoint<QuotesPayload>('/api/desk/quotes?symbols='+indices.join(','),15000);
 const history=useLiveEndpoint<{candles:Candle[];source:string;volumeUnit:string;notice?:string}>(timeframe==='intraday'?null:'/api/desk/history?symbol='+index+'&period='+timeframe);
 const intraday=useLiveEndpoint<IntradayPayload>('/api/desk/intraday?symbol='+index,30000);
 const date=quotes.data?.items.find(q=>q.symbol===indices[0])?.asOf.slice(0,10)||intraday.data?.date;
 const pools=useLiveEndpoint<PoolsPayload>(date?'/api/desk/market-pools?date='+date:null,90000);
 const dragons=useLiveEndpoint<DragonPayload>(date?'/api/desk/dragon?date='+date:null,300000);
 const gainers=useLiveEndpoint<GainersPayload>('/api/desk/gainers',60000);
 const ranks=useLiveEndpoint<SectorRanks>('/api/desk/ranks',90000);
 const peers=useLiveEndpoint<PeersPayload>(sector?'/api/desk/peers?code='+encodeURIComponent(sector):null,60000);
 const pool=pools.data?.pools,dragonMap=useMemo(()=>new Map(dragons.data?.items.map(r=>[r.symbol,r])||[]),[dragons.data]);
 const yesterday=new Set(pool?.yesterday.items.map(r=>r.symbol)||[]);
 const premium=pool?.yesterday.available&&pool.yesterday.items.length?pool.yesterday.items.filter(r=>r.changePercent!==null).reduce((n,r)=>n+r.changePercent!,0)/pool.yesterday.items.filter(r=>r.changePercent!==null).length:null;
 // Count unique failed seals, excluding stocks which closed sealed.
 const sealed=new Set(pool?.up.items.map(r=>r.symbol)||[]);
 const broken=pool?.broken.available?pool.broken.items.filter(r=>!sealed.has(r.symbol)).length:null;
 const sentiment=marketSentiment({up:pool?.up.available?pool.up.total:null,down:pool?.down.available?pool.down.total:null,broken,yesterdayMean:premium});
 const rawRows:RankedStock[]=sector?peers.data?.items.map(r=>({...r,amount:null,turnover:null}))||[]:tab==='dragon'?dragons.data?.items||[]:tab==='yesterday'?pool?.yesterday.items||[]:tab==='up'?pool?.up.items||[]:gainers.data?.items||[];
 const rows=[...rawRows].filter(r=>!search||r.name.includes(search)||r.symbol.includes(search)).sort((a,b)=>(b.changePercent??-Infinity)-(a.changePercent??-Infinity));
 const error=sector?peers.error:tab==='dragon'?dragons.error:tab==='gainers'?gainers.error:pools.error||pool?.[tab==='up'?'up':'yesterday'].reason;
 const loading=sector?peers.loading:tab==='dragon'?dragons.loading:tab==='gainers'?gainers.loading:pools.loading;
 const refresh=()=>{quotes.refresh();intraday.refresh();history.refresh();pools.refresh();dragons.refresh();gainers.refresh();ranks.refresh();if(sector)peers.refresh();};
 return <div className="market-overview research-desk"><header className="market-page-heading"><div><span>MARKET PULSE</span><h1>{uiText("市场全景")}</h1><p>{uiText("大盘分时 · 热点板块 · 强势个股 · 市场情绪")}</p></div><button className="outline-button" onClick={refresh}><RefreshCw size={18}/>{uiText("刷新市场")}</button></header>
  <div className="market-index-grid">{uiText(indices.map((symbol,i)=>{const q=quotes.data?.items.find(r=>r.symbol===symbol);return <button key={symbol} aria-pressed={index===symbol} onClick={()=>setIndex(symbol)}><span>{uiText(names[i])}</span><b>{uiText(q?.price.toFixed(2)||'—')}</b><strong className={tone(q?.changePercent)}>{uiText(pct(q?.changePercent))}</strong><small>{uiText(q?.asOf.slice(0,10)||'等待报价')}</small></button>;}))}</div>
  <div className={'market-hero-grid '+(timeframe==='intraday'?'':'market-hero-candles')}><section className="market-surface"><header><h2>{uiText(names[indices.indexOf(index)])}</h2><span>{date||'—'} · {uiText('北京时间')}</span></header><Tabs.Root value={timeframe} onValueChange={setTimeframe}><Tabs.List className="desk-tabs market-timeframes" aria-label={uiText('大盘图表周期')}>{[['intraday','分时'],['day','日 K'],['week','周 K'],['month','月 K']].map(([value,label])=><Tabs.Trigger value={value} key={value}>{uiText(label)}</Tabs.Trigger>)}<select aria-label={uiText('分钟周期')} value={timeframe.startsWith('m')&&timeframe!=='month'?timeframe:''} onChange={e=>{if(e.target.value)setTimeframe(e.target.value);}}><option value="">{uiText('周期')}</option>{[5,15,30,60,120].map(n=><option key={n} value={'m'+n}>{n} {uiText('分钟')}</option>)}</select></Tabs.List></Tabs.Root>{timeframe==='intraday'?(intraday.data?<IntradayChart data={intraday.data}/>:<div className="market-empty">{uiText(intraday.loading?'正在读取大盘分时…':intraday.error||'分时暂不可用')}</div>):history.data?<MarketChart candles={history.data.candles} symbol={index} unit={timeframe as 'day'|'week'|'month'} volumeUnit={history.data.volumeUnit}/>:<div className="market-empty">{uiText(history.loading?'正在读取历史行情':history.error||'等待周期历史')}{!history.loading&&<button className="outline-button" onClick={history.refresh}>{uiText('重试数据源')}</button>}</div>}<p className="market-source">{uiText(timeframe==='intraday'?intraday.data?.source:history.data?.source)} · {timeframe==='intraday'?intraday.data?.date:history.data?.candles.at(-1)?.time} · {uiText('最近交易日')}{uiText(history.data?.notice)}</p></section>
   <section className="market-surface sentiment-panel"><header><h2>{uiText("情绪指数")}</h2><span>{uiText("自定义 v1 ·")}{uiText(date||'日期待核验')}</span></header><div className="sentiment-number" data-testid="sentiment-score">{uiText(sentiment?.score??'—')}<small>/ 100</small></div><b>{uiText(!sentiment?'数据不足，无法计算':sentiment.score>=75?'偏热 · 留意分歧':sentiment.score>=55?'偏积极':sentiment.score>=35?'分歧整理':'偏冷 · 留意风险')}</b><div className="sentiment-meter"><i style={{width:(sentiment?.score||0)+'%'}}/></div><dl>{uiText([['涨停家数',pool?.up.total],['跌停家数',pool?.down.total],['炸板家数',broken],['昨涨停平均溢价',premium===null?'—':pct(premium)]].map(([label,value])=><div key={label}><dt>{uiText(label)}</dt><dd>{uiText(value??'—')}</dd></div>))}</dl><details><summary>{uiText("查看计算口径")}</summary><p>{uiText("40% × 涨停占涨跌停之比 + 30% × 封板率 + 30% × 昨涨停溢价强度。溢价强度 = clamp(50 + 平均涨幅 × 5, 0, 100)。低于35偏冷、55以上偏积极、75以上偏热；均为自定义观察阈值。")}</p><p>{uiText("东财公开股票池口径，不是全市场涨跌家数或交易胜率。任一池缺失则不计算；炸板排除已封板的重复股票。")}</p></details>{uiText(pools.error&&<p className="screen-warning">{uiText(pools.error)}</p>)}</section></div>
  <div className="market-ranking-grid"><SectorMap onStock={onStock}/>
   <section className="market-surface market-stocks"><header><h2>{uiText(sector?(ranks.data?.items.find(r=>r.code===sector)?.name||'板块')+' · 成分涨幅':'个股机会榜')}</h2><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={uiText("搜索本榜名称或代码")} aria-label={uiText("搜索本榜名称或代码")}/></header><Tabs.Root value={tab} onValueChange={v=>{setTab(v);setSector('');}}><Tabs.List className="desk-tabs" aria-label={uiText("个股排行类别")}>{uiText([['gainers','涨幅榜'],['dragon','近期龙虎榜'],['yesterday','昨日涨停'],['up','本日涨停']].map(([value,label])=><Tabs.Trigger value={value} key={value}>{uiText(label)}</Tabs.Trigger>))}</Tabs.List></Tabs.Root>
    <p className="market-source">{uiText(sector?'来源成分涨幅前16；未读取全成分':tab==='dragon'?`${dragons.data?.start||'—'} ~ ${dragons.data?.end||'—'} · 最近披露 ${dragons.data?.latestDate||'—'} · 披露日涨幅`:tab==='gainers'?gainers.data?.scope:`${date} · ${tab==='yesterday'?'上一交易日涨停股的当日表现':'来源涨停池'}`)} {uiText("· 点击名称进入个股工作台")}</p>
    <div className="market-table-scroll"><table className="market-rank-table"><thead><tr><th>#</th><th>{uiText("名称 / 标记")}</th><th>{uiText("价格")}</th><th>{uiText("涨幅 ↓")}</th><th>{uiText(tab==='dragon'&&!sector?'上榜日期':'换手率')}</th><th>{uiText("自选")}</th></tr></thead><tbody>{uiText(rows.map((r,i)=><tr key={r.symbol}><td>{uiText(i+1)}</td><td><button onClick={()=>onStock(r.symbol)}><b>{(r.name)}</b><small>{uiText(r.symbol)}</small><span className="stock-badges">{uiText(dragonMap.has(r.symbol)&&<em title={uiText(dragonMap.get(r.symbol)?.date+' · '+dragonMap.get(r.symbol)?.reason)}>{uiText("龙虎榜")}{uiText(dragonMap.get(r.symbol)?.date?.slice(5))}</em>)}{uiText(yesterday.has(r.symbol)&&<em>{uiText("昨日涨停")}</em>)}</span></button></td><td>{uiText(r.price?.toFixed(2)||'—')}</td><td className={tone(r.changePercent)}>{uiText(pct(r.changePercent))}</td><td>{uiText(tab==='dragon'&&!sector?r.date:r.turnover==null?'—':r.turnover.toFixed(2)+'%')}</td><td><button className="desk-icon" aria-label={uiText('自选 '+r.symbol)} onClick={()=>onWatch(r.symbol)}><Star size={18} fill={watchlist.includes(r.symbol)?'currentColor':'none'}/></button></td></tr>))}</tbody></table>{uiText(!rows.length&&<div className="market-empty">{uiText(loading?'正在读取榜单…':error||'此范围暂无记录')}</div>)}</div>{uiText(error&&rows.length>0&&<p className="screen-warning">{uiText("刷新失败，保留上一快照：")}{uiText(error)}</p>)}<p className="market-source">{uiText("龙虎榜为已披露记录；缺少标记不代表从未上榜。")}{uiText(dragons.data&&!dragons.data.complete&&'龙虎榜返回不完整。')}</p>
   </section></div><section className="market-news"><FlashNewsDesk/></section>
 </div>;
}
