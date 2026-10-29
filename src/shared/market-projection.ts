import type {Candle} from './types';
import {maPeriods,maRole} from './ma-system';
export type ProjectionPoint={time:string;session:number;base:number;bull:number;bear:number};
export type MarketProjection={available:boolean;asOf:string|null;anchor:number|null;horizon:number;model:'analogs'|'rules';sampleCount:number;points:ProjectionPoint[];support:number|null;resistance:number|null;conditions:{side:'base'|'bull'|'bear';text:string}[];notice:string;reason?:string;provisional:boolean};
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const quantile=(a:number[],p:number)=>{const s=[...a].sort((a,b)=>a-b),i=(s.length-1)*p,j=Math.floor(i);return s[j]+(s[Math.ceil(i)]-s[j])*(i-j);};
const notice='条件情景，非确定预测、非收益概率；区间是历史样本分位或波动规则，不是置信区间。未来日期仅排除周末用于排版，不代表交易所开市日历。推演线不参与真实K线、指标、评分或交易信号。';
/** Prefix features + bounded nearest neighbors: O(N*H), independent of cloud compute. */
export function projectMarket(input:Candle[],options:{horizon?:number;maPeriods?:number[];now?:Date}={}):MarketProjection{
 const horizon=[5,10,15].includes(options.horizon||0)?options.horizon!:15,now=options.now||new Date();
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now);
 const bars=input.filter(c=>c.time<=day),last=bars.at(-1);
 const result:MarketProjection={available:false,asOf:last?.time||null,anchor:last?.close||null,horizon,model:'rules',sampleCount:0,points:[],support:null,resistance:null,conditions:[],notice,provisional:last?.time===day&&(now.getUTCHours()*60+now.getUTCMinutes()+480)%1440<900};
 if(bars.length<65||bars.some((b,i)=>![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.volume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||i>0&&b.time<=bars[i-1].time)){result.reason='需要至少65根同一复权基准的有效日线';return result;}
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
 const drift=clamp((ma(maRole(periods,5),at)-ma(maRole(periods,13),at))/price*.08,-a/price*.08,a/price*.08),date=new Date(last!.time+'T00:00:00Z');
 for(let d=1;d<=horizon;d++){
  do{date.setUTCDate(date.getUTCDate()+1);}while(date.getUTCDay()===0||date.getUTCDay()===6);
  const returns=selected.map(c=>Math.log(bars[c.i+d].close/bars[c.i].close)),v=a/price*Math.sqrt(d),base=result.model==='analogs'?quantile(returns,.5):drift*d;
  const lower=result.model==='analogs'?Math.min(base,quantile(returns,.2)):base-v,upper=result.model==='analogs'?Math.max(base,quantile(returns,.8)):base+v;
  result.points.push({time:date.toISOString().slice(0,10),session:d,base:price*Math.exp(clamp(base,-.5,.5)),bull:price*Math.exp(clamp(upper,-.5,.6)),bear:price*Math.exp(clamp(lower,-.6,.5))});
 }
 result.available=true;
 result.conditions=[
  {side:'base',text:`围绕${result.support.toFixed(2)}–${result.resistance.toFixed(2)}观察承接；${result.model==='analogs'?`${selected.length}段不重叠历史相似窗口的中位路径`:'相似样本不足，采用ATR波动规则情景'}，不预设必然主升。`},
  {side:'bull',text:`放量站稳${result.resistance.toFixed(2)}、短均线转强且板块同步时才观察向上分支；缩量冲高或承接转弱会使其失效。`},
  {side:'bear',text:`失守${result.support.toFixed(2)}且不能收回、放量下跌或均线向下发散时观察向下分支，优先核验原有防守计划。`},
 ];return result;
}
