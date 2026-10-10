import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, type IChartApi, type Time } from 'lightweight-charts';
import type { Candle } from '../../shared/types';
import { analyzeCandles } from '../../shared/analysis';

const colors:Record<number,string>={5:'#f6c064',10:'#e787a3',20:'#58bdcb',60:'#9b8df3',120:'#b6c97f'};
export default function MarketChart({candles,compact=false}:{candles:Candle[];compact?:boolean}){
 const ref=useRef<HTMLDivElement>(null);
 const [period,setPeriod]=useState<'3M'|'6M'|'1Y'|'ALL'>(compact?'3M':'1Y');
 const [showMA,setShowMA]=useState(!compact);
 const analysis=useMemo(()=>analyzeCandles(candles),[candles]);
 useEffect(()=>{
  const el=ref.current;if(!el||!candles.length)return;
  let chart:IChartApi|undefined;
  try {
   chart=createChart(el,{
    width:el.clientWidth,height:compact?210:380,
    layout:{background:{type:ColorType.Solid,color:'#101b2a'},textColor:'#8797ac',fontFamily:'Inter, system-ui, sans-serif',fontSize:11},
    grid:{vertLines:{color:'#1d2a3a'},horzLines:{color:'#1d2a3a'}},
    rightPriceScale:{borderColor:'#2c3a4b',scaleMargins:{top:0.09,bottom:0.23}},
    timeScale:{borderColor:'#2c3a4b',timeVisible:false,rightOffset:5,fixLeftEdge:false},
    crosshair:{vertLine:{color:'#587289',labelBackgroundColor:'#22374a'},horzLine:{color:'#587289',labelBackgroundColor:'#22374a'}},
    handleScroll:{mouseWheel:!compact,pressedMouseMove:!compact},handleScale:{mouseWheel:!compact,axisPressedMouseMove:!compact}
   });
   const prices=chart.addCandlestickSeries({upColor:'#36c9a9',downColor:'#f07883',borderUpColor:'#36c9a9',borderDownColor:'#f07883',wickUpColor:'#36c9a9',wickDownColor:'#f07883',priceLineVisible:false});
   const duration=period==='3M'?66:period==='6M'?132:period==='1Y'?264:candles.length;
   const current=candles.slice(-duration);
   prices.setData(current.map(c=>({time:c.time as Time,open:c.open,high:c.high,low:c.low,close:c.close})));
   const volume=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'',priceLineVisible:false,lastValueVisible:false});
   volume.priceScale().applyOptions({scaleMargins:{top:0.81,bottom:0.01}});
   volume.setData(current.map(c=>({time:c.time as Time,value:c.volume,color:c.close>=c.open?'#246d64aa':'#804c5a99'})));
   if(showMA)for(const p of [5,10,20,60,120]){
    const line=chart.addLineSeries({color:colors[p],lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
    const oldest=current[0]?.time;
    line.setData((analysis.maSeries[p]??[]).filter(x=>x.time>=oldest).map(x=>({time:x.time as Time,value:x.value})));
   }
   chart.timeScale().fitContent();
   const resize=new ResizeObserver(()=>chart?.applyOptions({width:el.clientWidth}));
   resize.observe(el);
   return ()=>{resize.disconnect();chart?.remove();};
  }catch(e){console.error('MarketChart',e);chart?.remove();}
 },[candles,period,showMA,compact,analysis]);
 if(!candles.length)return <div className="chart-empty">暂无可绘制的真实 K 线</div>;
 return <div className="chart-shell">
  {!compact&&<div className="chart-controls">
   <div className="time-buttons">{(['3M','6M','1Y','ALL'] as const).map(p=><button type="button" className={period===p?'active':''} key={p} onClick={()=>setPeriod(p)}>{p}</button>)}</div>
   <button type="button" className={'ma-toggle '+(showMA?'active':'')} onClick={()=>setShowMA(v=>!v)}>五线均线 {showMA?'ON':'OFF'}</button>
  </div>}
  {showMA&&!compact&&<div className="ma-legend">{[5,10,20,60,120].map(p=><span key={p}><i style={{background:colors[p]}}/> MA{p} <b>{analysis.ma[p]===null?'—':analysis.ma[p]?.toFixed(2)}</b></span>)}</div>}
  <div className="trading-chart" ref={ref} aria-label="K线、成交量与五条移动均线可交互图表"/>
 </div>;
}
