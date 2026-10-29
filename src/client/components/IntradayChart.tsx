import {intradayStudy,isMarketIndex} from '../../shared/intraday-study';
import {t,usePreferences} from '../preferences';
import {useEffect,useRef,useState} from 'react';
import {createChart,ColorType,CrosshairMode,LineStyle,type UTCTimestamp,type Time} from 'lightweight-charts';
import type {IntradayPayload,SectorsPayload} from '../../shared/desk-types';
import type {AuctionSegment} from '../../shared/auction';
import {sessionGrid,defaultBenchmark} from '../../shared/intraday-axis';
import {useLiveEndpoint} from '../hooks/useLiveEndpoint';
import './IntradayChart.css';
const indexes={'000001.SH':'上证指数','399001.SZ':'深证成指','399006.SZ':'创业板指','000300.SH':'沪深300','000688.SH':'科创50','899050.BJ':'北证50'};
type Comparison=IntradayPayload&{name?:string;classification?:string;notice?:string};
export default function IntradayChart({data}:{data:IntradayPayload}){
 const display=usePreferences(),light=display.theme==='light',root=useRef<HTMLDivElement>(null);
 const [hover,setHover]=useState(data.points.at(-1)),[auctionOpen,setAuctionOpen]=useState(false),[overlayOpen,setOverlayOpen]=useState(false),[marketOn,setMarketOn]=useState(!isMarketIndex(data.symbol)),[macdOn,setMacdOn]=useState(true),[index,setIndex]=useState(defaultBenchmark(data.symbol)),[board,setBoard]=useState(''),[segment,setSegment]=useState('open');
 useEffect(()=>{setIndex(defaultBenchmark(data.symbol));setMarketOn(!isMarketIndex(data.symbol));setBoard('');},[data.symbol]);
 const boards=useLiveEndpoint<SectorsPayload>(overlayOpen?'/api/desk/sectors?symbol='+data.symbol:null,300000);
 const yellow=useLiveEndpoint<Comparison>(isMarketIndex(data.symbol)?'/api/desk/index-equal?symbol='+data.symbol:null,90000);
 const boardRef=useRef<{code:string;name:string}|null>(null);
 const market=useLiveEndpoint<Comparison>(marketOn?'/api/desk/intraday?symbol='+index:null,30000);
 const sector=useLiveEndpoint<Comparison>(board?'/api/desk/sector-intraday?code='+encodeURIComponent(board)+'&name='+encodeURIComponent(boardRef.current?.name||''):null,60000);
 const auction=useLiveEndpoint<{date:string;segments:AuctionSegment[];source:string;notice:string}>(auctionOpen?'/api/desk/auction?symbol='+data.symbol:null,30000);
 const valid=(r:Comparison|null)=>r?.date===data.date&&(r.previous||0)>0;
 const comparison=[...(isMarketIndex(data.symbol)&&valid(yellow.data)?[{data:yellow.data!,color:'#d5ae58',label:yellow.data!.name}]:[]),...(marketOn&&valid(market.data)?[{data:market.data!,color:'#6a92dc',label:indexes[index as keyof typeof indexes]}]:[]),...(board&&valid(sector.data)?[{data:sector.data!,color:'#758eef',label:sector.data!.name||boardRef.current?.name}]:[])];
 useEffect(()=>{
  if(!root.current||!data.date)return;
  setHover(data.points.at(-1));const el=root.current,grid=sessionGrid(data.date),base=data.previous;
  if(!grid.length)return;
  const cn=new Intl.DateTimeFormat(display.locale,{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
  const format=(time:Time)=>typeof time==='number'?cn.format(new Date(time*1000)):String(time);
  const charts:ReturnType<typeof createChart>[]=[],small=el.clientWidth<600,total=small?340:450;
  const make=(height:number,last:boolean,label?:string)=>{
   const pane=document.createElement('div');pane.style.position='relative';pane.style.height=height+'px';el.appendChild(pane);
   if(label){const tag=document.createElement('span');tag.textContent=label;tag.style.cssText='position:absolute;left:8px;top:2px;font-size:11px;z-index:1;color:#999;pointer-events:none';pane.appendChild(tag);}
   const chart=createChart(pane,{width:el.clientWidth,height,
    layout:{background:{type:ColorType.Solid,color:light?'#fff':'#0c0c0d'},textColor:light?'#59616d':'#a1a1aa',fontSize:Math.round(display.fontSize*.8)},
    grid:{vertLines:{visible:false},horzLines:{color:light?'#e9ecf0':'#202023'}},
    rightPriceScale:{visible:!label,borderVisible:false,minimumWidth:65,scaleMargins:{top:.12,bottom:.08}},
    timeScale:{visible:last,borderVisible:false,timeVisible:true,secondsVisible:false,tickMarkFormatter:format,fixLeftEdge:true,fixRightEdge:false},
    crosshair:{mode:CrosshairMode.Normal},handleScroll:false,handleScale:false,localization:{locale:display.locale,timeFormatter:format}});
   const clock=chart.addLineSeries({visible:false,priceScaleId:'clock',lastValueVisible:false,priceLineVisible:false});clock.setData(grid.map(p=>({time:p.time as UTCTimestamp,value:0})));
   charts.push(chart);return chart;
  };
  el.replaceChildren();
  const chart=make(total*(macdOn?.60:.75),false),volChart=make(total*(macdOn?.16:.25),!macdOn,'VOL'),macdChart=macdOn?make(total*.24,true,'MACD (12,26,9)'):null;
  const normalize=!!base&&base>0;
  const price=chart.addAreaSeries({lineColor:light?'#364f70':'#e4e4e7',topColor:'#d0d0d019',bottomColor:'#d0d0d000',lineWidth:2,priceLineVisible:false,lastValueVisible:false,priceFormat:normalize?{type:'percent'}:{type:'price',precision:2,minMove:.01}});
  const studied=intradayStudy(data.points,data.previous),byTime=new Map(studied.map(p=>[p.time,p]));
  price.setData(grid.map(p=>{const row=byTime.get(p.time);return row?{time:p.time as UTCTimestamp,value:normalize?(row.price/base!-1)*100:row.price}:{time:p.time as UTCTimestamp};}));
  if(normalize)price.createPriceLine({price:0,lineStyle:LineStyle.Dashed,lineWidth:1,color:'#73737c',axisLabelVisible:true,title:t('昨收')});
  for(const r of comparison){if(!normalize)continue;const line=chart.addLineSeries({color:r.color,lineWidth:1,priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'percent'}}),points=new Map(r.data.points.map(p=>[p.time,p]));line.setData(grid.map(p=>{const row=points.get(p.time);return row?{time:p.time as UTCTimestamp,value:(row.price/r.data.previous!-1)*100}:{time:p.time as UTCTimestamp};}));}
  const vol=volChart.addHistogramSeries({priceFormat:{type:'volume'},lastValueVisible:false,priceLineVisible:false});
  vol.setData(grid.map(p=>{const row=byTime.get(p.time);return row?{time:p.time as UTCTimestamp,value:row.volume,color:row.rising?'#f04a55':'#28cdb6'}:{time:p.time as UTCTimestamp};}));
  if(macdChart){
   const hist=macdChart.addHistogramSeries({lastValueVisible:false,priceLineVisible:false,base:0});
   hist.setData(grid.map(p=>{const r=byTime.get(p.time);return r&&!r.warmup?{time:p.time as UTCTimestamp,value:r.histogram,color:r.histogram>=0?'#f04a55':'#28cdb6'}:{time:p.time as UTCTimestamp};}));
   for(const [key,color] of [['dif','#e4e4e7'],['dea','#d5ae58']] as const){const line=macdChart.addLineSeries({color,lineWidth:1,lastValueVisible:false,priceLineVisible:false});line.setData(grid.map(p=>{const r=byTime.get(p.time);return r&&!r.warmup?{time:p.time as UTCTimestamp,value:r[key]}:{time:p.time as UTCTimestamp};}));}
  }
  const resize=()=>{for(const c of charts){c.applyOptions({width:el.clientWidth});c.timeScale().setVisibleLogicalRange({from:0,to:grid.length-1});}};
  for(const c of charts)c.subscribeCrosshairMove(p=>setHover(typeof p.time==='number'?byTime.get(p.time):data.points.at(-1)));
  resize();const observer=new ResizeObserver(resize);observer.observe(el);
  return()=>{observer.disconnect();for(const c of charts)c.remove();el.replaceChildren();};
 },[data,display,market.data,sector.data,yellow.data,marketOn,board,macdOn]);
 const chosen=auction.data?.date===data.date?auction.data.segments.find(s=>s.key===segment):null;
 return <div className="intraday-chart">
  <div className="intraday-actions"><span>{data.date} · {t('北京时间')}</span><button type="button" aria-pressed={macdOn} onClick={()=>setMacdOn(v=>!v)}>MACD</button><button type="button" aria-pressed={auctionOpen} onClick={()=>setAuctionOpen(v=>!v)}>{t('竞价')}</button><button type="button" aria-pressed={overlayOpen} onClick={()=>setOverlayOpen(v=>!v)}>{t('叠加走势')}</button></div>
  {overlayOpen&&<div className="intraday-overlays"><label><input type="checkbox" checked={marketOn} onChange={e=>setMarketOn(e.target.checked)}/>{t('叠加大盘')}</label><select aria-label={t('大盘指数')} value={index} onChange={e=>setIndex(e.target.value)}>{Object.entries(indexes).map(([id,name])=><option key={id} value={id}>{t(name)}</option>)}</select><select aria-label={t('所属板块叠加')} value={board} onChange={e=>{const b=boards.data?.boards.find(b=>b.code===e.target.value);boardRef.current=b||null;setBoard(e.target.value);}}><option value="">{t('不叠加板块')}</option>{boards.data?.boards.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select><small>{t('按各自昨收归一比较涨跌幅')}</small>{boards.error&&<small>{boards.error}</small>}</div>}
  <div className="intraday-legend"><b>{hover?.clock||'—'}</b><span>{t('价格')} {hover?.price.toFixed(2)||'—'}</span><span>VOL {hover?.volume??'—'}</span>{comparison.map(r=><span key={r.label} style={{color:r.color}} title={r.data.notice}>{r.label}</span>)}</div>
  {(market.error||sector.error)&&<small role="status">{market.error||sector.error}</small>}
  {(marketOn&&market.data&&!valid(market.data)||board&&sector.data&&!valid(sector.data))&&<small>{t('叠加来源交易日或昨收不匹配，已隐藏')}</small>}
  {isMarketIndex(data.symbol)&&<small className="intraday-yellow-note">{yellow.data?.notice||yellow.error||'正在加载黄色成分等权参考线…'}</small>}
  <small className="intraday-indicator-note">VOL 红：较上一分钟上涨／持平，绿：下跌{macdOn?' · MACD(12,26,9) 分钟价；前33个有效分钟预热':''}</small>
  <div ref={root} data-testid="intraday-pane"/>
  {auctionOpen&&<section className="auction-panel"><div className="intraday-actions">{(['open','close','after'] as const).map((key,i)=><button type="button" key={key} aria-pressed={segment===key} onClick={()=>setSegment(key)}>{t(['盘前竞价','收盘竞价','盘后定价'][i])}</button>)}</div>{chosen?.points.length?<><AuctionSpark segment={chosen}/><p>{chosen.points.at(-1)!.sourceClock} · {chosen.points.at(-1)!.price.toFixed(2)} · {t(chosen.points.at(-1)!.observation?'分钟观测':chosen.points.at(-1)!.indicative?'虚拟撮合':'撮合成交')} · {chosen.points.at(-1)!.volume}{t('手')} · {chosen.points.at(-1)!.amount??'—'}{t('元')}</p><small>{chosen.notice}</small></>:<p>{auction.error||t(auction.loading?'正在核验竞价数据…':'该时段暂未取得可核验数据')}</p>}<small>{auction.data?.source} · {auction.data?.notice}</small></section>}
 </div>;
}
function AuctionSpark({segment}:{segment:AuctionSegment}){
 const points=segment.points,prices=points.map(p=>p.price),hi=Math.max(...prices),lo=Math.min(...prices),range=Math.max(.01,hi-lo);
 const start=segment.key==='open'?555:segment.key==='close'?897:905,end=segment.key==='open'?565:segment.key==='close'?900:930;
 const xy=points.map(p=>{const [h,m]=p.clock.split(':').map(Number);return [8+(h*60+m-start)/(end-start)*584,8+(hi-p.price)/range*60];});
 return <svg viewBox="0 0 600 80" preserveAspectRatio="none" aria-label={segment.label}><polyline points={xy.map(p=>p.join(',')).join(' ')} fill="none" stroke="#d5ae58" strokeWidth="1.4"/>{xy.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="2" fill={points[i].indicative?'#d5ae58':'currentColor'}/>)}</svg>;
}