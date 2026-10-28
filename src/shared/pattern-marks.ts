import type {Candle} from './types';
import {reusablePatterns} from './strategy-evidence';
import type {StrategyAnalysis} from './strategy';
import {maPeriods,maRole} from './ma-system';
import {classicShapes} from './shape-rules';
import {guidePatternMarks} from './guide-patterns';
export type PatternMark={direction?:'bullish'|'bearish'|'neutral';time:string;kind:string;label:string;detail:string;position:'above'|'below';priority:number;provisional:boolean;chartVisible?:boolean;status?:'candidate'|'confirmed'|'observation';anchorTime?:string;range?:{from:string;to:string;low:number;high:number}};
const avg=(a:number[])=>a.length?a.reduce((n,v)=>n+v,0)/a.length:0;
/** Shape annotations are observations, not orders. Future candles cannot remove earlier observations. */
export function patternMarks(input:Candle[],now=new Date(),options:{symbol?:string;name?:string;maPeriods?:number[]}={}):PatternMark[]{
 const clock=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now),part=(k:string)=>clock.find(p=>p.type===k)?.value||'',day=`${part('year')}-${part('month')}-${part('day')}`,minute=Number(part('hour'))*60+Number(part('minute'));
 const bars=input.filter(b=>b.time<=day),out:PatternMark[]=[],sums=[0],vol=[0],lastEmitted=new Map<string,number>();
 if(bars.some((b,i)=>![b.open,b.close,b.high,b.low,b.volume].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.volume<0||i>0&&b.time<=bars[i-1].time))return [];
 bars.forEach((b,i)=>{sums.push(sums[i]+b.close);vol.push(vol[i]+b.volume);});
 const selected=maPeriods(options.maPeriods),rawMA=(p:number,i:number)=>i+1>=p?(sums[i+1]-sums[i+1-p])/p:NaN,ma=(p:number,i:number)=>rawMA(options.maPeriods?maRole(selected,p):p,i);
 for(let i=64;i<bars.length;i++){
  const b=bars[i],p=bars[i-1],base=(vol[i]-vol[i-20])/20,ratio=base?b.volume/base:0,gain=(b.close/p.close-1)*100,atr=avg(bars.slice(i-20,i).map((v,j)=>Math.max(v.high-v.low,Math.abs(v.high-bars[i-21+j].close),Math.abs(v.low-bars[i-21+j].close))));
  const location=b.high>b.low?(b.close-b.low)/(b.high-b.low):.5,body=Math.abs(b.close-b.open),provisional=b.time===day&&minute<900;
  const add=(kind:string,label:string,detail:string,priority=60,position:'above'|'below'='below',range?:PatternMark['range'],spacing=0)=>{if(i-(lastEmitted.get(kind)??-999)<spacing)return;out.push({time:b.time,kind,label,detail,priority,position,range,provisional,direction:kind==='box'?'neutral':'bullish'});if(!provisional)lastEmitted.set(kind,i);};
  const m5=ma(5,i),m13=ma(13,i),m20=ma(20,i);
  for(const hit of classicShapes(bars,i,rawMA,atr,ratio,options.maPeriods)){
   const identity=hit.kind+':'+(hit.anchorTime||'');
   if(hit.kind==='beauty'&&lastEmitted.has(identity)||hit.kind==='pointer'&&i-(lastEmitted.get('pointer')??-999)<5)continue;
   const candidate=hit.kind==='pointer';
   out.push({...hit,direction:'bullish',time:b.time,provisional,chartVisible:!candidate,status:candidate?'candidate':'observation'});
   if(!provisional){lastEmitted.set(identity,i);lastEmitted.set(hit.kind,i);}
  }
  const reclaim=b.close>b.open&&gain>=2.5&&body>=atr*.7&&location>=.75&&ratio>=1.5&&b.close>Math.max(m5,m13,m20)&&p.close<Math.min(ma(5,i-1),ma(13,i-1))&&bars.slice(i-5,i).filter((c,k)=>c.close<ma(13,i-5+k)).length>=3;
  if(reclaim)add('reclaim','放量收复5/13线',`此前5根至少3根在MA13下方，当前强实体收复5/13及20线；相对量${ratio.toFixed(2)}倍。`,90,'below',undefined,5);
  const up5=b.close>b.open&&gain>=3&&body>=.6*atr&&location>=.7&&ratio>=1.3&&p.close<ma(5,i-1)&&b.close>m5+.1*atr;
  if(up5&&!out.some(m=>m.time===b.time&&m.kind==='multi')){
   const symbol=options.symbol||'',rate=symbol.endsWith('.BJ')?.3:/^(300|301|688|689)/.test(symbol)?.2:.1,limit=Math.round(p.close*(1+rate)*100)/100;
   const limitLike=/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)&&!!options.name&&!/ST|退|^[NC]/i.test(options.name)&&Math.abs(b.close-limit)<.005&&Math.abs(b.high-b.close)<.005;
   add('ma5-reclaim',limitLike?'涨停幅度突破MA5':'放量上穿MA5',`${limitLike?'按代码板块涨停幅度和分币取整估算，非交易所涨停标志；':''}当前实体上穿MA5，但不满足至少四条实体穿线条件，不能称为一阳多线。`,75,'below',undefined,5);
  }
  const left=bars[i-2];
  if(p.high<Math.min(left.high,b.high)&&p.low<Math.min(left.low,b.low)&&p.low<Math.min(...bars.slice(i-10,i-1).map(c=>c.low))&&b.close>p.high&&b.close>b.open&&ratio>=1.1){
   out.push({time:b.time,kind:'bottom-fractal',direction:'bullish',label:provisional?'底分型 · 待收盘':'底分型确认',detail:`${p.time}为三根中间低点，当前右侧K线高低点均抬高且收过中间高点；确认标在右侧日期。`,position:'below',priority:78,provisional,anchorTime:p.time,status:provisional?'candidate':'confirmed'});
  }
  const recent=bars.slice(i-20,i),boxHigh=Math.max(...recent.map(b=>b.high)),boxLow=Math.min(...recent.map(b=>b.low)),older=(vol[i-20]-vol[i-40])/20;
  const tight=(Math.max(...[5,10,20,30,60].map(n=>ma(n,i)))/Math.min(...[5,10,20,30,60].map(n=>ma(n,i)))-1)*100;
  if((boxHigh/boxLow-1)<.2&&tight<8&&older>0&&base/older>=1.3&&b.close>=boxLow&&b.close<=boxHigh)add('box','箱体放量换手',`前20根区间${boxLow.toFixed(2)}–${boxHigh.toFixed(2)}，均量为此前20根${(base/older).toFixed(2)}倍；仅描述换手，不能证明吸筹。`,65,'above',{from:recent[0].time,to:b.time,low:boxLow,high:boxHigh},10);
  const localHigh=Math.max(...bars.slice(i-10,i).map(b=>b.high));
  if(b.close>localHigh+.05*atr&&p.close<=localHigh&&b.close>b.open&&body>=.65*atr&&ratio>=1.5&&location>=.75&&(b.close/m20-1)<.18)add('breakout','放量突破局部高点',`收盘上破此前10根高点${localHigh.toFixed(2)}；突破后继续核验承接。`,80,'below',undefined,7);
  if(bars[i-1].close/bars[i-11].close<.92&&b.close>b.open&&gain>=3&&ratio>=2.2&&body>=.8*atr&&location>=.75)add('surge','下跌后放量',`前10根价格走低，当前参与量${ratio.toFixed(2)}倍；可作修复观察，未证明反转。`,85,'below',undefined,7);
  for(let d=1;d<=3;d++){
   const anchor=bars[i-d],probe=out.find(m=>m.kind==='pointer'&&m.time===anchor.time&&!m.provisional);
   if(!probe||out.some(m=>m.kind==='pointer-confirmed'&&m.anchorTime===anchor.time))continue;
   const held=bars.slice(i-d+1,i).every((c,k)=>c.low>=anchor.low-.1*atr&&c.close>=ma(20,i-d+1+k));
   if(held&&b.close>anchor.high+.05*atr&&b.close>b.open&&body>=.5*atr&&location>=.7&&ratio>=1.3&&b.volume>=anchor.volume*1.15){
    out.push({time:b.time,kind:'pointer-confirmed',direction:'bullish',label:provisional?'仙人指路 · 确认预警':'仙人指路确认',detail:`${anchor.time}上影试探后第${d}根放量突破上影高点；确认发生在当前日期，不回写试探日。`,position:'below',priority:92,provisional,status:provisional?'candidate':'confirmed',anchorTime:anchor.time});
   }
  }
 }
 return [...out,...guidePatternMarks(bars,now,'day',options.maPeriods)].sort((a,b)=>a.time.localeCompare(b.time)||b.priority-a.priority);
}
/** One concise shape label per candle; execution markers take their own visual lane. */
export function primaryPatternMarks(marks:PatternMark[]):PatternMark[]{const selected=new Map<string,PatternMark>();for(const m of marks){if(m.chartVisible===false)continue;const old=selected.get(m.time);if(!old||m.priority>old.priority)selected.set(m.time,m);}return [...selected.values()].sort((a,b)=>a.time.localeCompare(b.time));}

/** Stage changes remain dated observations, including failures with no simulated holding. */
export function reviewedPatternMarks(bars:Candle[],strategy:StrategyAnalysis,now=new Date(),options:{symbol?:string;name?:string;maPeriods?:number[]}={}):PatternMark[]{
 const marks=[...(reusablePatterns(strategy,options,now)||patternMarks(bars,now,options))],phases=new Set(['turning','broken','downward']);
 for(const step of strategy.timeline){if(phases.has(step.phase))marks.push({time:step.date,kind:'stage-'+step.phase,direction:step.phase==='turning'?'bullish':'bearish',label:step.phase==='turning'?'回踩放量转强':step.phase==='broken'?'结构支撑失守':'向下开花',detail:step.reason,position:step.phase==='turning'?'below':'above',priority:step.phase==='turning'?93:98,provisional:false});}
 const p=strategy.plan;
 if(p.provisional&&p.asOf&&phases.has(p.phase))marks.push({time:p.asOf,kind:'stage-'+p.phase,direction:p.phase==='turning'?'bullish':'bearish',label:p.phase==='turning'?'回踩转强预警':'结构风控预警',detail:p.flat.reason,position:p.phase==='turning'?'below':'above',priority:98,provisional:true});
 return marks.sort((a,b)=>a.time.localeCompare(b.time)||b.priority-a.priority);
}
