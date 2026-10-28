import type {Candle} from './types';
import type {PatternMark} from './pattern-marks';
import {maPeriods,maRole} from './ma-system';

export const TREND_RULE_VERSION='directional-regime-v2';
export type TrendDirection='up'|'down'|'range'|'unknown';
export type TrendRegime={scale:'short'|'swing';label:string;direction:TrendDirection;since:string|null;fastPeriod:number;slowPeriod:number;provisional:boolean;detail:string};
type Side=-1|0|1;
const name=(side:Side)=>side===1?'上涨':side===-1?'下跌':'震荡';
/** Direction is an observed regime, not a forecast, entry signal or a retrospectively selected extremum. */
export function analyzeTrendRegimes(input:Candle[],options:{now?:Date;maPeriods?:number[]}={}){
 const cn=new Date((options.now||new Date()).getTime()+28800000),day=cn.toISOString().slice(0,10),forming=cn.getUTCHours()<15;
 const bars=input.filter(b=>b.time<=day),marks:PatternMark[]=[],regimes:TrendRegime[]=[],selected=maPeriods(options.maPeriods);
 if(bars.some((b,i)=>![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.volume<0||i>0&&b.time<=bars[i-1].time))return {version:TREND_RULE_VERSION,marks,regimes};
 // Constant-time window statistics. No scan of future bars and no full-strategy reruns.
 const sum=[0],sum2=[0],weighted=[0],travel=[0],tr=[0],vol=[0],upVol=[0],downVol=[0];
 bars.forEach((b,i)=>{const previous=bars[i-1]?.close??b.open,delta=b.close-previous;sum.push(sum[i]+b.close);sum2.push(sum2[i]+b.close*b.close);weighted.push(weighted[i]+i*b.close);travel.push(travel[i]+Math.abs(delta));tr.push(tr[i]+Math.max(b.high-b.low,Math.abs(b.high-previous),Math.abs(b.low-previous)));vol.push(vol[i]+b.volume);upVol.push(upVol[i]+(delta>0?b.volume:0));downVol.push(downVol[i]+(delta<0?b.volume:0));});
 const ma=(p:number,i:number)=>i+1>=p?(sum[i+1]-sum[i+1-p])/p:NaN;
 for(const cfg of [{scale:'short' as const,label:'短线',fast:5,slow:13,window:10,confirm:2},{scale:'swing' as const,label:'波段',fast:20,slow:60,window:30,confirm:3}]){
  const fastPeriod=maRole(selected,cfg.fast),slowPeriod=maRole(selected,cfg.slow),warmup=Math.max(20,slowPeriod+5,cfg.window+3);
  let side:Side=0,since:string|null=null,protectedLevel=NaN,warning=false,upCount=0,downCount=0,flatCount=0,lossCount=0,staleCount=0,known=false;
  let detail='历史不足，不能确认走势。',lastProvisional=false;
  if(fastPeriod>=slowPeriod){regimes.push({...cfg,fastPeriod,slowPeriod,direction:'unknown',since:null,provisional:false,detail:'当前均线缺少不同的快慢周期，此级别不生成趋势结论。'});continue;}
  for(let i=warmup;i<bars.length;i++){
   const b=bars[i],p=bars[i-1],atr=(tr[i]-tr[i-20])/20,base=(vol[i]-vol[i-20])/20;
   if(!(atr>0&&base>0&&b.volume>0))continue;
   const fast=ma(fastPeriod,i),slow=ma(slowPeriod,i),fastSlope=(fast-ma(fastPeriod,i-3))/atr,slowSlope=(slow-ma(slowPeriod,i-5))/atr;
   const from=i-cfg.window+1,n=cfg.window,sy=sum[i+1]-sum[from],sy2=sum2[i+1]-sum2[from],sxy=weighted[i+1]-weighted[from]-from*sy,sx=n*(n-1)/2,sxx=n*(n-1)*(2*n-1)/6;
   const covariance=sxy-sx*sy/n,varianceX=sxx-sx*sx/n,varianceY=sy2-sy*sy/n,slope=covariance/varianceX/atr,r2=varianceY>1e-12?Math.min(1,covariance*covariance/(varianceX*varianceY)):0;
   const displacement=(b.close-bars[from].close)/atr,path=travel[i+1]-travel[from+1],efficiency=path>0?Math.abs(b.close-bars[from].close)/path:0;
   const total=vol[i+1]-vol[i-4],buyShare=total>0?(upVol[i+1]-upVol[i-4])/total:0,sellShare=total>0?(downVol[i+1]-downVol[i-4])/total:0;
   const ratio=b.volume/base,location=b.high>b.low?(b.close-b.low)/(b.high-b.low):.5;
   const rawUp=b.close>Math.max(fast,slow)+.1*atr&&fast>slow+.08*atr&&fastSlope>.12&&slowSlope>.02&&displacement>(cfg.scale==='short'?1.2:2)&&slope>.045&&r2>=.35&&efficiency>=.28&&buyShare>=.52;
   // A persistent low-volume decline is still a downtrend. Volume expansion is not required to protect capital.
   const rawDown=b.close<Math.min(fast,slow)-.1*atr&&fast<slow-.08*atr&&fastSlope<-.12&&slowSlope<-.02&&displacement<-(cfg.scale==='short'?1.2:2)&&slope<-.045&&r2>=.35&&efficiency>=.28&&sellShare>=.52;
   upCount=rawUp?upCount+1:0;downCount=rawDown?downCount+1:0;
   const flat=(efficiency<.24||r2<.2)&&Math.abs(fast-slow)<.8*atr&&Math.abs(slowSlope)<.3;
   flatCount=flat?flatCount+1:0;
   const provisional=b.time===day&&forming,old=side;
   const supportLoss=side===1?b.close<protectedLevel-.2*atr&&b.close<fast-.2*atr:side===-1?b.close>protectedLevel+.2*atr&&b.close>fast+.2*atr:false;
   const middleLoss=side===1?b.close<slow-.25*atr&&fastSlope<0:side===-1?b.close>slow+.25*atr&&fastSlope>0:false;
   lossCount=supportLoss||middleLoss?lossCount+1:0;
   const shock=side===1?b.open-b.close>=1.2*atr&&ratio>=1.3&&location<.25&&b.close<slow-.3*atr:side===-1?b.close-b.open>=1.2*atr&&ratio>=1.3&&location>.75&&b.close>slow+.3*atr:false;
   const aligned=side===1?b.close>slow-.25*atr&&fastSlope>=-.1:side===-1?b.close<slow+.25*atr&&fastSlope<=.1:true;
   staleCount=side&&!aligned?staleCount+1:0;
   let next:Side=side,reason='';
   if(upCount>=cfg.confirm&&side!==1){next=1;reason=`连续${cfg.confirm}根价量支持，价格位于MA${fastPeriod}/${slowPeriod}上方、快慢线向上，区间净推进${displacement.toFixed(2)}ATR，路径效率${(efficiency*100).toFixed(0)}%，近5根上涨成交量占${(buyShare*100).toFixed(0)}%。`;}
   else if(downCount>=cfg.confirm&&side!==-1){next=-1;reason=`连续${cfg.confirm}根下行证据，价格位于MA${fastPeriod}/${slowPeriod}下方、快慢线向下，区间净推进${displacement.toFixed(2)}ATR，路径效率${(efficiency*100).toFixed(0)}%，近5根下跌成交量占${(sellShare*100).toFixed(0)}%。`;}
   else if(side&&(lossCount>=2||shock||flatCount>=3||staleCount>=(cfg.scale==='short'?5:8))){next=0;reason=shock?'放量反向长实体失守本级慢线，原单边结构失效；尚未确认反向趋势。':lossCount>=2?'连续两根失守已知摆点／慢线，原方向结构失效；尚未确认反向趋势。':flatCount>=3?'推进效率下降、快慢均线收拢，转入本级震荡。':'本级方向与价格位置持续背离，转为整理观察，尚未确认反向趋势。';}
   const priority=cfg.scale==='short'?94:96;
   if(next!==side){
    const label=next===0?`${cfg.label}${name(side)}失效 · 整理`:`${cfg.label}${name(next)}确认`;
    marks.push({time:b.time,kind:next===0?'trend-range':'trend-start',label,detail:`${cfg.label}级别（MA${fastPeriod}/${slowPeriod}，观察窗${n}根）：${reason}${since?' 原'+name(side)+'状态确认于'+since+'。':''}相对量${ratio.toFixed(2)}倍。确认日在当前日期，不回画到起点；不同级别可方向相反，不代表下根或未来持续涨跌，也不单独构成买卖点。`,direction:next===1?'bullish':next===-1?'bearish':'neutral',position:next===-1||next===0&&old===1?'above':'below',priority,provisional,status:provisional?'candidate':'confirmed',anchorTime:since??undefined,trendScale:cfg.scale,regime:next===1?'up':next===-1?'down':'range'});
    if(!provisional){side=next;since=b.time;known=true;warning=false;lossCount=0;staleCount=0;protectedLevel=side===1?Math.min(...bars.slice(i-2,i+1).map(c=>c.low)):side===-1?Math.max(...bars.slice(i-2,i+1).map(c=>c.high)):NaN;}
   }else if(side&&supportLoss&&!warning){
    marks.push({time:b.time,kind:'trend-warning',label:`${cfg.label}${name(side)}转弱`,detail:`${cfg.label}已知${side===1?'支撑':'压力'}${protectedLevel.toFixed(2)}被反向穿过，先记结构预警，尚不能据此确认反向趋势；相对量${ratio.toFixed(2)}倍。原状态${since}确认，后续可修复。`,direction:side===1?'bearish':'bullish',position:side===1?'above':'below',priority:92,provisional,status:provisional?'candidate':'observation',anchorTime:since??undefined,trendScale:cfg.scale,regime:side===1?'up':'down'});if(!provisional)warning=true;
   }
   if(!provisional){
    // A pivot becomes available only after two right-side bars. It affects the NEXT candle's defense.
    const j=i-2;if(side&&j>=2&&since&&bars[j].time>since){
     if(side===1&&[j-2,j-1,j+1,j+2].every(k=>bars[j].low<=bars[k].low)&&bars[j].low<Math.min(bars[j-1].low,bars[j+1].low))protectedLevel=Math.max(protectedLevel,bars[j].low);
     if(side===-1&&[j-2,j-1,j+1,j+2].every(k=>bars[j].high>=bars[k].high)&&bars[j].high>Math.max(bars[j-1].high,bars[j+1].high))protectedLevel=Math.min(protectedLevel,bars[j].high);
    }
    if(warning&&!supportLoss&&aligned&&(side===1?rawUp:rawDown))warning=false;
    if(!known&&flatCount>=3){known=true;since=b.time;}
   }
   lastProvisional=provisional;detail=`MA${fastPeriod}/${slowPeriod}；${known?name(side):'证据不足'}，相对量${ratio.toFixed(2)}倍，路径效率${(efficiency*100).toFixed(0)}%，拟合一致性${(r2*100).toFixed(0)}%。${provisional?'当前日线未完成。':''}`;
  }
  regimes.push({scale:cfg.scale,label:cfg.label,direction:!known?'unknown':side===1?'up':side===-1?'down':'range',since,fastPeriod,slowPeriod,provisional:lastProvisional,detail});
 }
 return {version:TREND_RULE_VERSION,marks:marks.sort((a,b)=>a.time.localeCompare(b.time)||b.priority-a.priority),regimes};
}
