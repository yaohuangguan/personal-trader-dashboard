import {CLASSIC_MA,FIBONACCI_MA,maPeriods,maRole,maSystem,maSystemName,type MASystem} from './ma-system';
import type {Candle} from './types';
export type ClassicShape={kind:'multi'|'spider'|'cannon'|'beauty'|'pointer';label:string;detail:string;priority:number;position:'above'|'below';anchorTime?:string};
export type MultiLineEvidence={version:3;system:MASystem;configured:number[];date:string;lines:number;periods:number[];includes60:boolean;decisionPeriod:number;dispersion:number;middleOffset:number;volume20:number;volume5:number;recentVolume:number;gain:number;closeLocation:number;normal:boolean;strong:boolean;bullishContinuation:boolean;systems?:MultiLineEvidence[]};
export function multiLineAt(bars:Candle[],i:number,ma:(p:number,i:number)=>number,atr:number,ratio:number,configured=CLASSIC_MA):MultiLineEvidence{
 const b=bars[i],p=bars[i-1],available=maPeriods(configured),periods=available.filter(n=>Number.isFinite(ma(n,i))&&b.open<=ma(n,i)&&b.close>ma(n,i)),prices=periods.map(n=>ma(n,i)),body=b.close-b.open;
 const previous5=bars.slice(i-5,i).reduce((s,c)=>s+c.volume,0)/5,recent=Math.max(...bars.slice(i-3,i).map(c=>c.volume));
 const dispersion=prices.length?(Math.max(...prices)/Math.min(...prices)-1)*100:100,middleOffset=body>0&&prices.length?Math.abs((Math.min(...prices)+Math.max(...prices))/2-(b.open+b.close)/2)/body:1;
 const volume20=ratio,volume5=previous5>0?b.volume/previous5:0,recentVolume=recent>0?b.volume/recent:0,gain=(b.close/p.close-1)*100,closeLocation=b.high>b.low?(b.close-b.low)/(b.high-b.low):0;
 const fast=available.slice(0,3),decisionPeriod=available.includes(60)?60:available.includes(55)?55:maRole(available,60);
 const normal=body>=.6*atr&&gain>=3&&volume20>=1.2&&closeLocation>=.7&&periods.length>=4&&dispersion<10&&fast.every(n=>b.close>ma(n,i))&&b.close/ma(maRole(available,20),i)<1.16;
 const contextPeriods=[...new Set([5,13,20,30,60].map(n=>maRole(available,n)))].sort((a,b)=>a-b),prior=contextPeriods.map(n=>ma(n,i-1));
 const bullishContinuation=normal&&contextPeriods.length>=4&&prior.every((v,k)=>Number.isFinite(v)&&(!k||prior[k-1]>v))&&contextPeriods.filter(n=>n>=20).every(n=>ma(n,i-1)>ma(n,i-4))&&p.close>=ma(decisionPeriod,i-1);
 const includes60=periods.includes(60)||periods.includes(55),strong=normal&&gain>5&&closeLocation>=.9&&volume20>=2&&volume5>=1.5&&recentVolume>=1.1&&includes60&&dispersion<5&&middleOffset<=.25;
 return {version:3,system:maSystem(available),configured:available,date:b.time,lines:periods.length,periods,decisionPeriod,includes60,dispersion,middleOffset,volume20,volume5,recentVolume,gain,closeLocation,normal,strong,bullishContinuation};
}
export function multiLineEvidence(bars:Candle[],configured?:number[]):MultiLineEvidence|null{
 const i=bars.length-1;if(i<64)return null;
 const sum=[0];bars.forEach((b,j)=>sum.push(sum[j]+b.close));const ma=(n:number,k=i)=>k+1>=n?(sum[k+1]-sum[k-n+1])/n:NaN;
 const base=bars.slice(i-20,i).reduce((s,c)=>s+c.volume,0)/20,atr=bars.slice(i-20,i).reduce((s,c,k)=>s+Math.max(c.high-c.low,Math.abs(c.high-bars[i-21+k].close),Math.abs(c.low-bars[i-21+k].close)),0)/20;
 const systems=(configured?[configured]:[CLASSIC_MA,FIBONACCI_MA]).map(p=>multiLineAt(bars,i,ma,atr,base>0?bars[i].volume/base:0,p));
 const best=[...systems].sort((a,b)=>Number(b.strong)-Number(a.strong)||Number(b.normal)-Number(a.normal)||b.lines-a.lines)[0];return {...best,systems};
}
/** Operational thresholds, not a statistical probability or a claim about order flow. */
export function classicShapes(bars:Candle[],i:number,ma:(period:number,index:number)=>number,atr:number,ratio:number,configured?:number[]):ClassicShape[]{
 if(i<64||!(atr>0))return [];
 const b=bars[i],p=bars[i-1],out:ClassicShape[]=[],gain=(b.close/p.close-1)*100,body=b.close-b.open,range=b.high-b.low,location=range?(b.close-b.low)/range:0;
 const m5=ma(5,i),m10=ma(10,i),m20=ma(20,i),m60=ma(60,i),bias20=(b.close/m20-1)*100;
 const core=[5,10,20,30,60],before=core.map(n=>ma(n,i-1)),compression=(Math.max(...before)/Math.min(...before)-1)*100;
 const crossed=core.filter(n=>b.open<=ma(n,i)&&b.close>ma(n,i));
 const solid=body>=.6*atr&&location>=.7,participation=ratio>=1.5,nearBase=bias20<16;
 const add=(kind:ClassicShape['kind'],label:string,detail:string,priority:number,position:ClassicShape['position']='below',anchorTime?:string)=>out.push({kind,label,detail,priority,position,anchorTime});
 const systems=(configured?[configured]:[CLASSIC_MA,FIBONACCI_MA]).map(p=>multiLineAt(bars,i,ma,atr,ratio,p)),hits=systems.filter(e=>e.normal),best=[...hits].sort((a,b)=>Number(b.strong)-Number(a.strong)||b.lines-a.lines)[0];
 if(best){const name=best.strong?'强力一阳多线'+(best.bullishContinuation?' · 多头':''):best.bullishContinuation?'多头一阳多线 · '+best.lines+'线':'一阳多线 · '+best.lines+'线';add('multi',name,systems.map(e=>`${maSystemName(e.system)}实体穿MA${e.periods.join('/')}；${e.normal?'有效':'条件未齐'}，线束离散${e.dispersion.toFixed(2)}%，中轴偏移${(e.middleOffset*100).toFixed(1)}%实体。`).join(' ')+`${best.bullishContinuation?'前一根核心均线已多头排列，20/30/55或60对应周期斜率向上，属于趋势中回落后的实体穿线；并非只认底部首次启动。':''}20日相对量${ratio.toFixed(2)}倍；普通不要求中轴居中，强力另需居中及55/60线等全部条件。`,best.strong?99:91);}
 const recentCross=(x:number,y:number)=>Array.from({length:5},(_,k)=>i-k).some(j=>ma(x,j-1)<=ma(y,j-1)&&ma(x,j)>ma(y,j));
 const cluster=Math.min(...Array.from({length:5},(_,k)=>{const v=[5,10,20].map(n=>ma(n,i-k-1));return (Math.max(...v)/Math.min(...v)-1)*100;}));
 if(solid&&gain>=2&&participation&&m5>m10&&m10>m20&&[5,10,20].every(n=>ma(n,i)>ma(n,i-3))&&cluster<2&&recentCross(5,10)&&recentCross(5,20)&&recentCross(10,20)&&b.open<=Math.min(m5,m10,m20)&&b.close>Math.max(m5,m10,m20)&&nearBase)
  add('spider','金蜘蛛',`5/10/20三组近5根交叉、前序聚合${cluster.toFixed(2)}%；当前放量阳线实体贯穿三线交汇，不以交叉单独命名。`,88);
 const a=bars[i-2],middleBody=p.open-p.close;
 if(solid&&a.close>a.open&&a.close-a.open>=.4*atr&&middleBody>0&&middleBody<=(a.close-a.open)*.75&&p.low>=a.low&&p.close>=(a.open+a.close)/2-.1*atr&&p.volume<=a.volume*.85&&b.close>Math.max(a.high,p.high)+.05*atr&&b.volume>=Math.max(a.volume,p.volume)*1.1&&ratio>=1.3&&b.close>m20&&m20>=ma(20,i-5))
  add('cannon','多方炮',`阳—缩量小阴—放量阳；中阴守首阳半位，末阳突破两根高点并收近高位，MA20未下行。`,85);
 for(let d=3;d<=8;d++){
  const n=i-d,launch=bars[n],shoulder=bars.slice(n+1,i+1),base=bars.slice(n-20,n).reduce((v,c)=>v+c.volume,0)/20;
  const launchBody=launch.close-launch.open,launchLocation=(launch.close-launch.low)/(launch.high-launch.low||1),shoulderLow=Math.min(...shoulder.map(c=>c.low)),shoulderHigh=Math.max(...shoulder.map(c=>c.high));
  if(launchBody>=.8*atr&&(launch.close/bars[n-1].close-1)>=.04&&launch.volume>=base*1.5&&launchLocation>=.7&&shoulder.every(c=>Math.abs(c.close/c.open-1)<=.025&&c.low>=(launch.open+launch.close)/2&&c.volume<=launch.volume*.85)&&shoulder.reduce((v,c)=>v+c.volume,0)/d<=launch.volume*.65&&shoulderHigh-shoulderLow<=Math.max(launchBody*1.25,atr*1.5)&&b.close>=launch.close*.96&&b.close>=m5&&m5>m10&&m10>m20&&m5>=ma(5,i-2)&&nearBase){
   add('beauty','美人肩',`${launch.time}放量阳线后${d}根低量小实体窄幅整理，守住实体半位；肩部形态已出现，突破仍需新承接。`,80,'below',launch.time);break;
  }
 }
 const wick=b.high-Math.max(b.open,b.close),lower=Math.min(b.open,b.close)-b.low,priorHigh=Math.max(...bars.slice(i-10,i).map(c=>c.high)),advance=(p.close/bars[i-11].close-1)*100;
 if(wick>=Math.max(Math.abs(body)*1.8,.6*atr)&&wick<=2*atr&&range<=2.5*atr&&range>0&&wick/range>=.45&&lower/range<=.3&&Math.abs(body)<=.5*atr&&body>=-.1*atr&&gain>=-.5&&gain<=3&&b.close>=m5-.15*atr&&m5>m10&&m10>m20&&m20>ma(20,i-5)&&m20>=m60*.99&&advance>=2&&advance<=18&&bias20>=0&&bias20<=12&&b.high>=priorHigh-.15*atr&&b.low>=m10-.3*atr&&ratio>=.75&&ratio<=1.8)
  add('pointer','仙人指路·待确认',`上升初段的受控量上影试探，守住短均线，非高位放量长上影；需随后1–3根放量突破${b.high.toFixed(2)}且不失守${b.low.toFixed(2)}，尚不能作为确认形态。`,55,'above',b.time);
 return out;
}
