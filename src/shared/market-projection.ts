import type {Candle} from './types';
import {maPeriods,maRole} from './ma-system';
export type ProjectionScenario={id:'base'|'bull'|'bear';label:string;candles:Candle[];explanation?:string;source?:{from:string;to:string;distance:number|null};endReturn?:number;maxDrawdown?:number};
export type ProjectionPoint={time:string;session:number;base:number;bull:number;bear:number};
export type ProjectionBasis={regime:string;facts:string[];limitations:string[];eligibleWindows:number;matchedWindows:number;volumeAdjusted:boolean};
export type MarketProjection={available:boolean;asOf:string|null;anchor:number|null;horizon:number;model:'analogs'|'rules';sampleCount:number;points:ProjectionPoint[];scenarios:ProjectionScenario[];unit:string;support:number|null;resistance:number|null;conditions:{side:'base'|'bull'|'bear';text:string}[];notice:string;reason?:string;provisional:boolean;basis?:ProjectionBasis};
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const notice='条件情景，非确定预测、非收益概率。整段历史量价路径经当前波动率缩放，不是逐日中位数拼接；偏强偏弱按期末排序，途中允许交叉。未来日期排除周末但未含假期。推演价量均为假设，仅用于推演指标，不写入真实行情、评分或交易信号。';
type State={id:'breakout'|'up'|'down'|'pullback'|'range';label:string;direction:number};
type Neighbor={i:number;distance:number};
type Path={candles:Candle[];weight:number;source:{from:string;to:string;distance:number|null};end:number;drawdown:number};
/** Current-session volume is incomplete; estimate activity without treating it as a full trading day. */
function sessionFraction(now:Date,unit:string){
 const cn=new Date(now.getTime()+480*60000),m=cn.getUTCHours()*60+cn.getUTCMinutes();
 const part=clamp((Math.min(120,Math.max(0,m-570))+Math.min(120,Math.max(0,m-780)))/240,.15,1);
 if(unit==='day')return part;
 if(unit==='week')return clamp((Math.max(0,cn.getUTCDay()-1)+part)/5,.1,1);
 if(unit==='month'){
  const d=new Date(Date.UTC(cn.getUTCFullYear(),cn.getUTCMonth(),1));let before=0,total=0;
  while(d.getUTCMonth()===cn.getUTCMonth()){if(d.getUTCDay()>0&&d.getUTCDay()<6){total++;if(d.getUTCDate()<cn.getUTCDate())before++;}d.setUTCDate(d.getUTCDate()+1);}
  return clamp((before+part)/Math.max(1,total),.05,1);
 }return 1;
}
/** Prefix-only features, whole-path medoids and bounded moving-block fallback. No network or random price jitter. */
export function projectMarket(input:Candle[],options:{horizon?:number;maPeriods?:number[];now?:Date;unit?:string;symbol?:string;name?:string}={}):MarketProjection{
 const horizon=[5,10,15,20].includes(options.horizon||0)?options.horizon!:10,now=options.now||new Date();
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now),unit=options.unit||'day';
 const bars=input.filter(c=>c.time.slice(0,10)<=day),last=bars.at(-1),clock=(now.getUTCHours()*60+now.getUTCMinutes()+480)%1440;
 const provisional=last?.time.slice(0,10)===day&&clock<900;
 const result:MarketProjection={available:false,asOf:last?.time||null,anchor:last?.close||null,horizon,model:'rules',sampleCount:0,points:[],scenarios:[],unit,support:null,resistance:null,conditions:[],notice,provisional};
 if(bars.length<65||bars.some((b,i)=>![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.volume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||i>0&&b.time<=bars[i-1].time)){result.reason='需要至少65根同一复权基准的有效K线';return result;}
 const at=bars.length-1,known=provisional?at-1:at,fraction=provisional?sessionFraction(now,unit):1;
 const volume=bars.map((b,i)=>b.volume/(i===at?fraction:1)),sums=[0],vol=[0],tr=[0],moves=[0];
 bars.forEach((b,i)=>{sums.push(sums[i]+b.close);vol.push(vol[i]+volume[i]);tr.push(tr[i]+Math.max(b.high-b.low,i?Math.abs(b.high-bars[i-1].close):0,i?Math.abs(b.low-bars[i-1].close):0));moves.push(moves[i]+(i?Math.abs(b.close-bars[i-1].close):0));});
 const periods=maPeriods(options.maPeriods),fast=maRole(periods,5),short=maRole(periods,13),mid=maRole(periods,30),anchorMA=maRole(periods,60);
 const ma=(p:number,i:number)=>(sums[i+1]-sums[Math.max(0,i+1-p)])/Math.min(p,i+1);
 const atr=(i:number)=>Math.max((tr[i+1]-tr[i-13])/14,bars[i].close*.001);
 const av=(i:number,n:number)=>(vol[i+1]-vol[Math.max(0,i+1-n)])/Math.min(n,i+1);
 const state=(i:number):State=>{
  const b=bars[i],a=atr(i),f=ma(fast,i),s=ma(short,i),m=ma(mid,i),ms=(m-ma(mid,i-5))/a;
  const high=Math.max(...bars.slice(i-20,i).map(b=>b.high)),v3=av(i,3)/Math.max(1,av(i-3,20));
  if(b.close>high+.1*a&&v3>1.2&&b.close>s&&m>=ma(mid,i-5)-.1*a)return{id:'breakout',label:'放量突破／启动观察',direction:1};
  if(f>s&&s>m&&ms>.05&&b.close>m)return{id:'up',label:'多头趋势延续',direction:1};
  if(f<s&&s<m&&ms<-.05&&b.close<m)return{id:'down',label:'空头趋势／破位风险',direction:-1};
  if(b.close>ma(anchorMA,i)&&ms>-.1&&b.close<bars[i-5].close)return{id:'pullback',label:'上升结构回踩',direction:0};
  return{id:'range',label:'震荡／结构待确认',direction:0};
 };
 const features=(i:number)=>{
  const b=bars[i],a=atr(i),v=av(i,20),high=Math.max(...bars.slice(i-20,i).map(b=>b.high)),low=Math.min(...bars.slice(i-20,i).map(b=>b.low));
  return [(b.close-bars[i-5].close)/a/3,(b.close-bars[i-20].close)/a/6,
   (ma(fast,i)-ma(short,i))/a,(ma(short,i)-ma(mid,i))/a,(ma(mid,i)-ma(anchorMA,i))/a/2,
   (ma(mid,i)-ma(mid,i-5))/a,(ma(anchorMA,i)-ma(anchorMA,i-5))/a,
   Math.log(Math.max(.05,av(i,5)/Math.max(1,v))),Math.log(Math.max(.05,volume[i]/Math.max(1,av(i-1,20)))),
   (b.close-b.open)/a,(b.high-Math.max(b.open,b.close))/a,(Math.min(b.open,b.close)-b.low)/a,
   (b.close-bars[i-10].close)/Math.max(a*.1,moves[i+1]-moves[i-9]),
   (b.close-high)/a/2,(b.close-low)/Math.max(a,high-low)-.5,
   (ma(short,i)-ma(short,i-5))/a].map(v=>clamp(v,-4,4));
 };
 const current=features(at),regime=state(at),a=atr(at),price=last!.close,vol5=av(at,5),vol20=av(at,20),vr=volume[at]/Math.max(1,av(at-1,20));
 const distance=(i:number)=>{
  const f=features(i),s=state(i),opposite=regime.direction*s.direction<0;
  return Math.sqrt(mean(f.map((v,j)=>(v-current[j])**2)))+(opposite?1.5:regime.id===s.id?0:.12);
 };
 const candidates:Neighbor[]=[];
 for(let i=64;i+horizon<=known;i++){
  if(bars.slice(i+1,i+horizon+1).some((b,j)=>Math.abs(Math.log(b.close/bars[i+j].close))>.35))continue;
  candidates.push({i,distance:distance(i)});
 }
 candidates.sort((a,b)=>a.distance-b.distance);
 const selected:Neighbor[]=[];
 for(const c of candidates)if(c.distance<.95&&selected.length<12&&selected.every(p=>Math.abs(p.i-c.i)>=horizon))selected.push(c);
 result.model=selected.length>=4?'analogs':'rules';result.sampleCount=selected.length;
 const supports=[...periods.map(p=>ma(p,at)),Math.min(...bars.slice(-10).map(c=>c.low))].filter(v=>v<price-.25*a);
 const resistances=[...periods.map(p=>ma(p,at)),Math.max(...bars.slice(-20).map(c=>c.high))].filter(v=>v>price+.25*a);
 result.support=Math.max(price*.05,supports.length?Math.max(...supports):price-a);
 result.resistance=resistances.length?Math.min(...resistances):price+1.5*a;
 const times=projectionTimes(last!.time,unit,horizon),pool:Path[]=[];
 const stock=!!options.symbol&&/^[0-9]{6}\.(SH|SZ|BJ)$/.test(options.symbol)&&!(/^(000[0-9]{3}\.SH|399[0-9]{3}\.SZ)$/.test(options.symbol));
 const limit=unit==='day'&&stock?(options.symbol!.endsWith('.BJ')?.3:/^(300|301|688|689)/.test(options.symbol!)?.2:/ST/i.test(options.name||'')?.05:.1):null;
 const finish=(candles:Candle[],weight:number,source:Path['source'])=>{
  let peak=price,dd=0;for(const b of candles){peak=Math.max(peak,b.high);dd=Math.max(dd,1-b.low/peak);}
  pool.push({candles,weight,source,end:candles.at(-1)!.close/price-1,drawdown:dd});
 };
 const nextCandle=(bar:Candle,prior:number,previous:number,scale:number,drift:number,volumeBase:number):Candle=>{
  const gap=clamp(Math.log(bar.open/prior)*scale,-.18,.18),body=clamp(Math.log(bar.close/bar.open)*scale+drift,-.22,.22);
  const open=previous*Math.exp(gap),close=open*Math.exp(body);
  const high=Math.max(open,close)*(1+Math.max(0,(bar.high/Math.max(bar.open,bar.close)-1)*scale));
  const low=Math.min(open,close)*Math.max(.5,1-Math.max(0,(1-bar.low/Math.min(bar.open,bar.close))*scale));
  const bound=(v:number)=>{const n=limit===null?v:clamp(v,previous*(1-limit),previous*(1+limit));return stock?Math.max(.01,Math.round(n*100)/100):n;};
  return{time:'',open:bound(open),close:bound(close),high:bound(high),low:bound(low),volume:Math.max(0,bar.volume*volumeBase)};
 };
 if(result.model==='analogs'){
  for(const c of selected){
   const scale=clamp((a/price)/(atr(c.i)/bars[c.i].close),.4,2.5),candles:Candle[]=[];let previous=price;
   for(let d=0;d<horizon;d++){
    const b=nextCandle(bars[c.i+d+1],bars[c.i+d].close,previous,scale,0,vol5/Math.max(1,av(c.i,5)));
    b.time=times[d];candles.push(b);previous=b.close;
   }finish(candles,Math.exp(-2*c.distance*c.distance),{from:bars[c.i].time,to:bars[c.i+horizon].time,distance:c.distance});
  }
 }else{
  // Keep observed multi-bar price/volume dependencies. Deterministic block resampling, not a smooth average candle.
  const starts=Array.from({length:Math.max(1,known-24)},(_,i)=>i+21).filter(i=>i+3<=known);
  starts.sort((i,j)=>distance(i-1)-distance(j-1));
  const returns=bars.slice(Math.max(1,known-29),known+1).map((b,j)=>Math.log(b.close/bars[Math.max(1,known-29)+j-1].close));
  const recentMu=mean(returns),mu=clamp(.45*recentMu+.35*Math.log(price/bars[at-5].close)/5+.2*Math.log(ma(short,at)/ma(short,at-5))/5,-a/price*.45,a/price*.45)*(regime.id==='range'?.35:1);
  for(let k=0;k<24;k++){
   const candles:Candle[]=[];let previous=price,seed=(k+1)*2654435761>>>0,start=starts[k%Math.min(8,starts.length)];
   for(let d=0;d<horizon;d++){
    if(d>0&&d%3===0){seed=(Math.imul(seed,1664525)+1013904223)>>>0;start=starts[seed%starts.length];}
    const i=start+d%3,scale=clamp((a/price)/(atr(i-1)/bars[i-1].close),.5,2);
    const drift=mu*Math.exp(-d/(horizon+10))-recentMu*scale;
    const b=nextCandle(bars[i],bars[i-1].close,previous,scale,drift,vol5/Math.max(1,av(i-1,5)));
    b.time=times[d];candles.push(b);previous=b.close;
   }finish(candles,1,{from:bars[Math.max(0,known-29)].time,to:bars[known].time,distance:null});
  }
 }
 // Select ONE weighted medoid path; never paste marginal daily medians into artificial dojis.
 const pathDistance=(a:Path,b:Path)=>mean(a.candles.map((v,i)=>Math.abs(Math.log(v.close/b.candles[i].close))/(atr(at)/price)+.12*Math.abs(Math.log(Math.max(1,v.volume)/Math.max(1,b.candles[i].volume)))));
 const medoid=pool.reduce((best,p)=>pool.reduce((s,q)=>s+q.weight*pathDistance(p,q),0)<pool.reduce((s,q)=>s+q.weight*pathDistance(best,q),0)?p:best,pool[0]);
 const ordered=[...pool].sort((a,b)=>a.end-b.end);
 const weaker=ordered.filter(p=>p.end<=medoid.end),stronger=ordered.filter(p=>p.end>=medoid.end);
 const weak=weaker[Math.floor((weaker.length-1)*.35)],strong=stronger[Math.ceil((stronger.length-1)*.65)];
 for(const [id,label,path] of [['base','基准情景',medoid],['bull','偏强情景',strong],['bear','偏弱情景',weak]] as const){
  const method=result.model==='analogs'?'同股历史 '+path.source.from+'—'+path.source.to+' 的完整量价路径':'近30根已完成量价片段、每3根一块重采样，保留波动与量价节奏';
  const explanation=method+'；按当前ATR与近5根量能缩放。期末相对当前 '+(path.end>=0?'+':'')+(path.end*100).toFixed(1)+'%，路径内最大回撤 '+(path.drawdown*100).toFixed(1)+'%（情景数值，非收益承诺）。';
  result.scenarios.push({id,label,candles:path.candles,source:path.source,endReturn:path.end,maxDrawdown:path.drawdown,explanation});
 }
 for(let d=0;d<horizon;d++)result.points.push({time:times[d],session:d+1,base:medoid.candles[d].close,bull:strong.candles[d].close,bear:weak.candles[d].close});
 const slope=(ma(mid,at)-ma(mid,at-5))/ma(mid,at-5)*100,ret5=(price/bars[at-5].close-1)*100;
 result.basis={regime:regime.label,eligibleWindows:candidates.length,matchedWindows:selected.length,volumeAdjusted:fraction<1,
  facts:['当前结构：'+regime.label+'；近5根涨跌 '+ret5.toFixed(2)+'%。',
   'MA'+fast+'/'+short+'/'+mid+'/'+anchorMA+' 的位置和斜率参与匹配；中期均线近5根变化 '+slope.toFixed(2)+'%。',
   '最近一根量比 '+vr.toFixed(2)+'，近5根/20根量比 '+(vol5/Math.max(1,vol20)).toFixed(2)+'；ATR '+(a/price*100).toFixed(2)+'%。'+(fraction<1?'当前量按已过交易时段估计，收盘前会变化。':''),
   result.model==='analogs'?candidates.length+'个历史窗口中，选出 '+selected.length+'段不重叠相似量价路径；基准选整段代表路径，不取逐日中位数。':'独立相似样本仅 '+selected.length+' 段，不足4段；降级为近期量价片段重采样，依据较弱。'],
  limitations:['仅使用当前个股同周期价量与自定义MA；未引入板块、新闻、资金流，不能据此声称已综合这些信息。','跨12只股票滚动回放尚未优于价格不变基线；情景排序不是发生概率。']};
 result.conditions=[
  {side:'base',text:regime.label+'；支撑 '+result.support.toFixed(2)+'，压力 '+result.resistance.toFixed(2)+'。基准为整段代表路径，不预设缩量横盘或必然主升。'},
  {side:'bull',text:'放量站稳 '+result.resistance.toFixed(2)+'、回踩承接且短均线继续上行时，偏强分支更有依据；冲高回落或跌回突破位会削弱它。'},
  {side:'bear',text:'失守 '+result.support.toFixed(2)+' 且不能收回、放量下跌或均线向下发散时，偏弱分支更有依据，需核验防守计划。'}
 ];result.available=true;return result;
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
