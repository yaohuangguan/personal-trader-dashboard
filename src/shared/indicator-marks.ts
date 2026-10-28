import type {Candle} from './types';
import {macd,kdj} from './chart-indicators';
export type IndicatorMark={time:string;pane:'MACD'|'KDJ'|'VOL';kind:'golden'|'death'|'top-divergence'|'bottom-divergence'|'expansion'|'contraction';label:string;detail:string;value:number;bullish:boolean;provisional:boolean;anchorTime?:string};
/** Swings require two right-hand bars. Divergence is dated at confirmation, never backdated to its pivot. */
export function indicatorMarks(bars:Candle[],now=new Date()):IndicatorMark[]{
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),clock=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(now).replace(':',''));
 const rows=bars.filter(b=>b.time.slice(0,10)<=date),out:IndicatorMark[]=[],md=new Map(macd(rows).map(p=>[p.time,p])),kd=new Map(kdj(rows).map(p=>[p.time,p]));
 const mark=(i:number,pane:IndicatorMark['pane'],kind:IndicatorMark['kind'],label:string,detail:string,value:number,bullish:boolean,anchorTime?:string)=>out.push({time:rows[i].time,pane,kind,label,detail,value,bullish,anchorTime,provisional:rows[i].time.length===10&&rows[i].time===date&&clock<1500});
 for(const pane of ['MACD','KDJ'] as const){
  let peak=-1,trough=-1;const value=(i:number)=>pane==='MACD'?md.get(rows[i]?.time)?.dif:kd.get(rows[i]?.time)?.k,slow=(i:number)=>pane==='MACD'?md.get(rows[i]?.time)?.dea:kd.get(rows[i]?.time)?.d;
  for(let i=1;i<rows.length;i++){
   const a=value(i),b=slow(i),x=value(i-1),y=slow(i-1);
   if(a!==undefined&&b!==undefined&&x!==undefined&&y!==undefined){if(x<=y&&a>b)mark(i,pane,'golden','金叉',`${pane}快线上穿慢线；辅助动能证据，不单独生成买点。`,a,true);else if(x>=y&&a<b)mark(i,pane,'death','死叉',`${pane}快线下穿慢线；结合结构支撑核验。`,a,false);}
   const j=i-2;if(j<2||value(j)===undefined)continue;
   const window=rows.slice(j-2,j+3),top=window.every((b,k)=>k===2||rows[j].high>b.high),bottom=window.every((b,k)=>k===2||rows[j].low<b.low);
   for(const high of [true,false]){
    if(!(high?top:bottom))continue;const old=high?peak:trough,v=value(j)!,prior=old>=0?value(old):undefined;
    if(old>=0&&j-old>=5&&j-old<=60&&prior!==undefined){
     const priceChanged=high?rows[j].high>rows[old].high*1.003:rows[j].low<rows[old].low*.997;
     const delta=pane==='KDJ'?5:Math.max(rows[j].close*.001,Math.abs(prior)*.1),diverged=high?v<prior-delta:v>prior+delta;
     const zone=pane==='MACD'?(high?v>0&&prior>0:v<0&&prior<0):(high?prior>=70:prior<=30);
     if(priceChanged&&diverged&&zone)mark(i,pane,high?'top-divergence':'bottom-divergence',high?'顶背离确认':'底背离确认',`${rows[old].time}与${rows[j].time}两个价格摆点背离${pane}快线，右侧两根现已形成；确认日${rows[i].time}，仍可能继续背离。`,value(i)??v,!high,rows[j].time);
    }
    if(high)peak=j;else trough=j;
   }
  }
 }
 let sum=0,last=-99;
 for(let i=0;i<rows.length;i++){if(i>=20){const base=sum/20,ratio=base?rows[i].volume/base:0,provisional=rows[i].time===date&&clock<1500;if(i-last>=3&&(ratio>=1.5||ratio<=.65&&!provisional)){const up=rows[i].close>=rows[i-1].close,expand=ratio>=1.5;mark(i,'VOL',expand?'expansion':'contraction',(expand?'放量':'缩量')+(up?'上涨':'回落'),`已发生量/此前20根均量=${ratio.toFixed(2)}倍；${provisional?'当前K线未收盘，不能外推全天量。':expand&&!up?'放量回落提示抛压，核验承接。':!expand&&!up?'缩量回落不能单独证明洗盘。':'继续结合收盘位置与支撑。'}`,rows[i].volume,expand&&up||!expand&&!up);last=i;}}if(i>=20)sum-=rows[i-20].volume;sum+=rows[i].volume;}
 return out.sort((a,b)=>a.time.localeCompare(b.time));
}
