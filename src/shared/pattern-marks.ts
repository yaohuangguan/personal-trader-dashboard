import type {Candle} from './types';
import type {StrategyAnalysis} from './strategy';
export type PatternMark={time:string;kind:string;label:string;detail:string;position:'above'|'below';priority:number;provisional:boolean;range?:{from:string;to:string;low:number;high:number}};
const avg=(a:number[])=>a.length?a.reduce((n,v)=>n+v,0)/a.length:0;
/** Shape annotations are observations, not orders. Future candles cannot remove earlier observations. */
export function patternMarks(input:Candle[],now=new Date()):PatternMark[]{
 const clock=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now),part=(k:string)=>clock.find(p=>p.type===k)?.value||'',day=`${part('year')}-${part('month')}-${part('day')}`,minute=Number(part('hour'))*60+Number(part('minute'));
 const bars=input.filter(b=>b.time<=day),out:PatternMark[]=[],sums=[0],vol=[0],lastEmitted=new Map<string,number>();
 if(bars.some((b,i)=>![b.open,b.close,b.high,b.low,b.volume].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.volume<0||i>0&&b.time<=bars[i-1].time))return [];
 bars.forEach((b,i)=>{sums.push(sums[i]+b.close);vol.push(vol[i]+b.volume);});
 const ma=(p:number,i:number)=>(sums[i+1]-sums[i+1-p])/p;
 for(let i=64;i<bars.length;i++){
  const b=bars[i],p=bars[i-1],base=(vol[i]-vol[i-20])/20,ratio=base?b.volume/base:0,gain=(b.close/p.close-1)*100,atr=avg(bars.slice(i-20,i).map((v,j)=>Math.max(v.high-v.low,Math.abs(v.high-bars[i-21+j].close),Math.abs(v.low-bars[i-21+j].close))));
  const location=b.high>b.low?(b.close-b.low)/(b.high-b.low):.5,body=Math.abs(b.close-b.open),provisional=b.time===day&&minute<900;
  const add=(kind:string,label:string,detail:string,priority=60,position:'above'|'below'='below',range?:PatternMark['range'],spacing=0)=>{if(i-(lastEmitted.get(kind)??-999)<spacing)return;out.push({time:b.time,kind,label,detail,priority,position,range,provisional});if(!provisional)lastEmitted.set(kind,i);};
  const crossed=[5,10,20,30,60].filter(n=>b.open<=ma(n,i)&&b.close>=ma(n,i));
  if(b.close>b.open&&gain>=3&&ratio>=1.2&&crossed.length>=3&&crossed.includes(60))add('multi','一阳多线',`实体穿过${crossed.length}条核心均线，含MA60；前20日相对量${ratio.toFixed(2)}倍。`,95);
  const m5=ma(5,i),m13=ma(13,i),m20=ma(20,i),shortRecovery=b.close>b.open&&b.close>m5&&b.close>m13&&p.close<Math.max(ma(5,i-1),ma(13,i-1))&&body>=atr*.55&&ratio>=1.35&&location>=.65;
  if(shortRecovery)add('reclaim','放量收复5/13线',`收复短均线并以较强实体收盘；相对量${ratio.toFixed(2)}倍，仍需核验风险位置。`,90);
  const recent=bars.slice(i-20,i),boxHigh=Math.max(...recent.map(b=>b.high)),boxLow=Math.min(...recent.map(b=>b.low)),older=(vol[i-20]-vol[i-40])/20;
  const tight=(Math.max(...[5,10,20,30,60].map(n=>ma(n,i)))/Math.min(...[5,10,20,30,60].map(n=>ma(n,i)))-1)*100;
  if((boxHigh/boxLow-1)<.2&&tight<8&&older>0&&base/older>=1.3&&b.close>=boxLow&&b.close<=boxHigh)add('box','箱体放量换手',`前20根区间${boxLow.toFixed(2)}–${boxHigh.toFixed(2)}，均量为此前20根${(base/older).toFixed(2)}倍；仅描述换手，不能证明吸筹。`,65,'above',{from:recent[0].time,to:b.time,low:boxLow,high:boxHigh},10);
  const localHigh=Math.max(...bars.slice(i-10,i).map(b=>b.high));
  if(b.close>localHigh&&p.close<=localHigh&&b.close>b.open&&ratio>=1.4&&location>=.65)add('breakout','放量突破局部高点',`收盘上破此前10根高点${localHigh.toFixed(2)}；突破后继续核验承接。`,80);
  if(bars[i-1].close/bars[i-11].close<.95&&b.close>b.open&&ratio>=2&&body>=.55*atr&&location>=.6)add('surge','下跌后放量',`前10根价格走低，当前参与量${ratio.toFixed(2)}倍；可作修复观察，未证明反转。`,85);
  const wick=b.high-Math.max(b.open,b.close);
  if(wick>=Math.max(body*1.8,.4*atr)&&b.close>=p.close*.99&&b.close>=m20&&m5>=ma(5,i-3)&&ratio>=.8&&ratio<=3)add('pointer','仙人指路候选',`上影试探、价格守住MA20且短线未走弱；长上影也可能是抛压，等待后续放量突破上影高点。`,60,'above');
  const a=bars[i-2];
  if(a.close>a.open&&p.close<p.open&&b.close>b.open&&p.low>=a.low&&b.close>a.high&&b.close>p.high&&b.volume>=Math.max(a.volume,p.volume)*1.1&&b.close>m20)add('cannon','多方炮',`阳—阴—阳，末阳突破前两根高点并放量。`,75);
  const recentCross=(x:number,y:number)=>Array.from({length:5},(_,k)=>i-k).some(j=>ma(x,j-1)<=ma(y,j-1)&&ma(x,j)>ma(y,j));
  if(m5>ma(10,i)&&ma(10,i)>m20&&[5,10,20].every(n=>ma(n,i)>ma(n,i-3))&&recentCross(5,10)&&recentCross(5,20)&&recentCross(10,20)&&b.close>m5&&ratio>=1.2)add('spider','金蜘蛛',`近5根5/10/20三组交叉聚合，当前多头抬升且量能配合。`,70,'below',undefined,4);
  for(let d=3;d<=8;d++){const n=i-d,launch=bars[n],baseLaunch=avg(bars.slice(n-20,n).map(b=>b.volume)),shoulder=bars.slice(n+1,i+1);
   if((launch.close/bars[n-1].close-1)>=.04&&launch.close>launch.open&&launch.volume>=baseLaunch*1.5&&shoulder.every(c=>Math.abs(c.close/c.open-1)<=.025&&c.low>=(launch.open+launch.close)/2)&&avg(shoulder.map(b=>b.volume))<=launch.volume*.75&&b.close>m5&&m5>ma(10,i)&&ma(10,i)>m20){add('beauty','美人肩',`${launch.time}放量阳线后缩量小实体整理，守住实体半位；后续仍须确认。`,80,'below',undefined,4);break;}
  }
 }
 return out;
}
/** One concise shape label per candle; execution markers take their own visual lane. */
export function primaryPatternMarks(marks:PatternMark[]):PatternMark[]{const selected=new Map<string,PatternMark>();for(const m of marks){const old=selected.get(m.time);if(!old||m.priority>old.priority)selected.set(m.time,m);}return [...selected.values()].sort((a,b)=>a.time.localeCompare(b.time));}

/** Stage changes remain dated observations, including failures with no simulated holding. */
export function reviewedPatternMarks(bars:Candle[],strategy:StrategyAnalysis,now=new Date()):PatternMark[]{
 const marks=patternMarks(bars,now),phases=new Set(['turning','broken','downward']);
 for(const step of strategy.timeline){if(phases.has(step.phase))marks.push({time:step.date,kind:'stage-'+step.phase,label:step.phase==='turning'?'回踩放量转强':step.phase==='broken'?'结构支撑失守':'向下开花',detail:step.reason,position:step.phase==='turning'?'below':'above',priority:step.phase==='turning'?93:98,provisional:false});}
 const p=strategy.plan;
 if(p.provisional&&p.asOf&&phases.has(p.phase))marks.push({time:p.asOf,kind:'stage-'+p.phase,label:p.phase==='turning'?'回踩转强预警':'结构风控预警',detail:p.flat.reason,position:p.phase==='turning'?'below':'above',priority:98,provisional:true});
 return marks.sort((a,b)=>a.time.localeCompare(b.time)||b.priority-a.priority);
}
