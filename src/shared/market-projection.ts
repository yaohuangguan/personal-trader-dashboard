import type {Candle} from './types';
import {maPeriods,maRole} from './ma-system';
export type ProjectionScenario={id:'base'|'bull'|'bear';label:string;candles:Candle[]};
export type ProjectionPoint={time:string;session:number;base:number;bull:number;bear:number};
export type MarketProjection={available:boolean;asOf:string|null;anchor:number|null;horizon:number;model:'analogs'|'rules';sampleCount:number;points:ProjectionPoint[];scenarios:ProjectionScenario[];unit:string;support:number|null;resistance:number|null;conditions:{side:'base'|'bull'|'bear';text:string}[];notice:string;reason?:string;provisional:boolean};
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const quantile=(a:number[],p:number)=>{const s=[...a].sort((a,b)=>a-b),i=(s.length-1)*p,j=Math.floor(i);return s[j]+(s[Math.ceil(i)]-s[j])*(i-j);};
const notice='条件情景，非确定预测、非收益概率；区间是历史样本分位或波动规则，不是置信区间。未来日期按所选周期与交易时段排版，排除周末但未含假期，不代表开市日历。推演K线与量均为假设，假设价量仅用于推演区指标，不写入真实行情、评分或交易信号。';
/** Prefix features + bounded nearest neighbors: O(N*H), independent of cloud compute. */
export function projectMarket(input:Candle[],options:{horizon?:number;maPeriods?:number[];now?:Date;unit?:string}={}):MarketProjection{
 const horizon=[5,10,15].includes(options.horizon||0)?options.horizon!:15,now=options.now||new Date();
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now);
 const unit=options.unit||'day',bars=input.filter(c=>c.time.slice(0,10)<=day),last=bars.at(-1);
 const result:MarketProjection={available:false,asOf:last?.time||null,anchor:last?.close||null,horizon,model:'rules',sampleCount:0,points:[],scenarios:[],unit,support:null,resistance:null,conditions:[],notice,provisional:last?.time.slice(0,10)===day&&(now.getUTCHours()*60+now.getUTCMinutes()+480)%1440<900};
 if(bars.length<65||bars.some((b,i)=>![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.volume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||i>0&&b.time<=bars[i-1].time)){result.reason='需要至少65根同一复权基准的有效K线';return result;}
 const sums=[0],vol=[0],tr=[0],moves=[0];
 bars.forEach((b,i)=>{sums.push(sums[i]+b.close);vol.push(vol[i]+b.volume);tr.push(tr[i]+Math.max(b.high-b.low,i?Math.abs(b.high-bars[i-1].close):0,i?Math.abs(b.low-bars[i-1].close):0));moves.push(moves[i]+(i?Math.abs(b.close-bars[i-1].close):0));});
 const periods=maPeriods(options.maPeriods),mid=maRole(periods,30),anchorMA=maRole(periods,60);
 const ma=(p:number,i:number)=>(sums[i+1]-sums[Math.max(0,i+1-p)])/Math.min(p,i+1),atr=(i:number)=>Math.max((tr[i+1]-tr[i-13])/14,bars[i].close*.001);
 const features=(i:number)=>{const price=bars[i].close,a=atr(i),v=(vol[i+1]-vol[i-19])/20,v5=(vol[i+1]-vol[i-4])/5;return [
  (price-bars[i-5].close)/a/3,(price-bars[i-20].close)/a/6,
  (ma(maRole(periods,5),i)-ma(maRole(periods,13),i))/a,
  (ma(maRole(periods,13),i)-ma(mid,i))/a,
  (ma(mid,i)-ma(anchorMA,i))/a/2,(ma(anchorMA,i)-ma(anchorMA,i-5))/a,
  Math.log(Math.max(.1,v5/Math.max(1,v))),
  (price-bars[i].low)/Math.max(a*.1,bars[i].high-bars[i].low)-.5,
  (price-bars[i-10].close)/Math.max(a*.1,moves[i+1]-moves[i-9]),
 ].map(v=>clamp(v,-4,4));};
 const at=bars.length-1,current=features(at),a=atr(at),price=last!.close;
 const candidates:{i:number;distance:number}[]=[];
 for(let i=64;i+horizon<at;i++){
  // Reject discontinuous / implausible adjusted-price windows rather than learning ex-right gaps.
  if(bars.slice(i+1,i+horizon+1).some((b,j)=>Math.abs(Math.log(b.close/bars[i+j].close))>.35))continue;
  const f=features(i),distance=Math.sqrt(mean(f.map((v,j)=>(v-current[j])**2)));
  if(distance<1.15)candidates.push({i,distance});
 }
 candidates.sort((a,b)=>a.distance-b.distance);
 const selected:typeof candidates=[];
 for(const c of candidates)if(selected.length<12&&selected.every(p=>Math.abs(p.i-c.i)>=horizon))selected.push(c);
 result.model=selected.length>=4?'analogs':'rules';result.sampleCount=result.model==='analogs'?selected.length:0;
 const supports=[...periods.map(p=>ma(p,at)),Math.min(...bars.slice(-10).map(c=>c.low))].filter(v=>v<price-.25*a),resistances=[...periods.map(p=>ma(p,at)),Math.max(...bars.slice(-20).map(c=>c.high))].filter(v=>v>price+.25*a);
 result.support=Math.max(price*.05,supports.length?Math.max(...supports):price-a);
 result.resistance=resistances.length?Math.min(...resistances):price+1.5*a;
 const drift=clamp((ma(maRole(periods,5),at)-ma(maRole(periods,13),at))/price*.08,-a/price*.08,a/price*.08),times=projectionTimes(last!.time,unit,horizon);
 for(let d=1;d<=horizon;d++){

  const returns=selected.map(c=>Math.log(bars[c.i+d].close/bars[c.i].close)),v=a/price*Math.sqrt(d),base=result.model==='analogs'?quantile(returns,.5):drift*d;
  const lower=result.model==='analogs'?Math.min(base,quantile(returns,.2)):base-v,upper=result.model==='analogs'?Math.max(base,quantile(returns,.8)):base+v;
  result.points.push({time:times[d-1],session:d,base:price*Math.exp(clamp(base,-.5,.5)),bull:price*Math.exp(clamp(upper,-.5,.6)),bear:price*Math.exp(clamp(lower,-.6,.5))});
 }
 const recent=bars.slice(-20),avgVolume=mean(recent.map(b=>b.volume));
 for(const [id,label] of [['base','基准情景'],['bull','偏强情景'],['bear','偏弱情景']] as const){
  let previous=price;const candles:Candle[]=[];
  for(let d=0;d<horizon;d++){
   const sample=selected.map(c=>({bar:bars[c.i+d+1],atr:atr(c.i),prior:bars[c.i+d].close,volumeBase:mean(bars.slice(c.i-19,c.i+1).map(b=>b.volume))}));
   const gap=result.model==='analogs'?quantile(sample.map(c=>Math.log(c.bar.open/c.prior)),.5):0;
   const open=previous*Math.exp(clamp(gap,-.05,.05)),close=result.points[d][id];
   const upper=result.model==='analogs'?quantile(sample.map(c=>(c.bar.high-Math.max(c.bar.open,c.bar.close))/c.atr),.5)*a:mean(recent.map(b=>b.high-Math.max(b.open,b.close)));
   const lower=result.model==='analogs'?quantile(sample.map(c=>(Math.min(c.bar.open,c.bar.close)-c.bar.low)/c.atr),.5)*a:mean(recent.map(b=>Math.min(b.open,b.close)-b.low));
   const volume=result.model==='analogs'?quantile(sample.map(c=>c.bar.volume/Math.max(1,c.volumeBase)),.5)*avgVolume:avgVolume;
   candles.push({time:times[d],open,close,high:Math.max(open,close)+Math.max(a*.03,upper),low:Math.max(price*.01,Math.min(open,close)-Math.max(a*.03,lower)),volume:Math.max(0,volume)});previous=close;
  }
  result.scenarios.push({id,label,candles});
 }
 result.available=true;
 result.conditions=[
  {side:'base',text:`围绕${result.support.toFixed(2)}–${result.resistance.toFixed(2)}观察承接；${result.model==='analogs'?`${selected.length}段不重叠历史相似窗口的中位路径`:'相似样本不足，采用ATR波动规则情景'}，不预设必然主升。`},
  {side:'bull',text:`放量站稳${result.resistance.toFixed(2)}、短均线转强且板块同步时才观察向上分支；缩量冲高或承接转弱会使其失效。`},
  {side:'bear',text:`失守${result.support.toFixed(2)}且不能收回、放量下跌或均线向下发散时观察向下分支，优先核验原有防守计划。`},
 ];return result;
}

/** Hypothetical bar-end labels; session-aware, never presented as an exchange holiday calendar. */
export function projectionTimes(last:string,unit:string,count:number){
 const out:string[]=[],minute=/^m(5|15|30|60|120)$/.exec(unit),date=new Date(last.slice(0,10)+'T00:00:00Z');
 let clock=last.length>10?Number(last.slice(11,13))*60+Number(last.slice(14,16)):900;
 const nextDay=()=>{do{date.setUTCDate(date.getUTCDate()+1);}while(date.getUTCDay()===0||date.getUTCDay()===6);};
 for(let i=0;i<count;i++){
  if(minute){const step=Number(minute[1]);let found:number|undefined;
   for(const start of [570,780])for(let end=start+step;end<=start+120;end+=step)if(end>clock&&found===undefined)found=end;
   if(found===undefined){nextDay();found=570+step;}clock=found;
   out.push(date.toISOString().slice(0,10)+' '+String(Math.floor(clock/60)).padStart(2,'0')+':'+String(clock%60).padStart(2,'0'));
  }else if(unit==='week'){date.setUTCDate(date.getUTCDate()+7);date.setUTCDate(date.getUTCDate()+(5-date.getUTCDay()+7)%7);out.push(date.toISOString().slice(0,10));}
  else if(unit==='month'){date.setUTCFullYear(date.getUTCFullYear(),date.getUTCMonth()+2,0);while(date.getUTCDay()===0||date.getUTCDay()===6)date.setUTCDate(date.getUTCDate()-1);out.push(date.toISOString().slice(0,10));}
  else{nextDay();out.push(date.toISOString().slice(0,10));}
 }return out;
}
