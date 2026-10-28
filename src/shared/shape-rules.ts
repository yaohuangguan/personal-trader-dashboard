import type {Candle} from './types';
export type ClassicShape={kind:'multi'|'spider'|'cannon'|'beauty'|'pointer';label:string;detail:string;priority:number;position:'above'|'below';anchorTime?:string};
export type MultiLineEvidence={version:2;date:string;lines:number;periods:number[];includes60:boolean;dispersion:number;middleOffset:number;volume20:number;volume5:number;recentVolume:number;gain:number;closeLocation:number;normal:boolean;strong:boolean};
export function multiLineEvidence(bars:Candle[]):MultiLineEvidence|null{
 const i=bars.length-1;if(i<64)return null;const b=bars[i],p=bars[i-1],ma=(n:number,k=i)=>bars.slice(k-n+1,k+1).reduce((s,c)=>s+c.close,0)/n;
 const periods=[5,10,20,30,60].filter(n=>b.open<=ma(n)&&b.close>ma(n)),prices=periods.map(n=>ma(n)),body=b.close-b.open;
 const base=bars.slice(i-20,i).reduce((s,c)=>s+c.volume,0)/20,previous5=bars.slice(i-5,i).reduce((s,c)=>s+c.volume,0)/5,recent=Math.max(...bars.slice(i-3,i).map(c=>c.volume)),atr=bars.slice(i-20,i).reduce((s,c,k)=>s+Math.max(c.high-c.low,Math.abs(c.high-bars[i-21+k].close),Math.abs(c.low-bars[i-21+k].close)),0)/20;
 const dispersion=prices.length?(Math.max(...prices)/Math.min(...prices)-1)*100:100,middleOffset=body>0&&prices.length?Math.abs((Math.min(...prices)+Math.max(...prices))/2-(b.open+b.close)/2)/body:1;
 const volume20=base>0?b.volume/base:0,volume5=previous5>0?b.volume/previous5:0,recentVolume=recent>0?b.volume/recent:0,gain=(b.close/p.close-1)*100,closeLocation=b.high>b.low?(b.close-b.low)/(b.high-b.low):0;
 const before=[5,10,20,30,60].map(n=>ma(n,i-1)),compression=(Math.max(...before)/Math.min(...before)-1)*100;
 const normal=body>=.6*atr&&gain>=3&&volume20>=1.2&&closeLocation>=.7&&periods.length>=4&&compression<10&&b.close>Math.max(ma(5),ma(10),ma(20))&&b.close/ma(20)<1.16;
 const strong=normal&&gain>5&&closeLocation>=.9&&volume20>=2&&volume5>=1.5&&recentVolume>=1.1&&periods.includes(60)&&dispersion<5&&middleOffset<=.25;
 return {version:2,date:b.time,lines:periods.length,periods,includes60:periods.includes(60),dispersion,middleOffset,volume20,volume5,recentVolume,gain,closeLocation,normal,strong};
}
/** Operational thresholds, not a statistical probability or a claim about order flow. */
export function classicShapes(bars:Candle[],i:number,ma:(period:number,index:number)=>number,atr:number,ratio:number):ClassicShape[]{
 if(i<64||!(atr>0))return [];
 const b=bars[i],p=bars[i-1],out:ClassicShape[]=[],gain=(b.close/p.close-1)*100,body=b.close-b.open,range=b.high-b.low,location=range?(b.close-b.low)/range:0;
 const m5=ma(5,i),m10=ma(10,i),m20=ma(20,i),m60=ma(60,i),bias20=(b.close/m20-1)*100;
 const core=[5,10,20,30,60],before=core.map(n=>ma(n,i-1)),compression=(Math.max(...before)/Math.min(...before)-1)*100;
 const crossed=core.filter(n=>b.open<=ma(n,i)&&b.close>ma(n,i));
 const solid=body>=.6*atr&&location>=.7,participation=ratio>=1.5,nearBase=bias20<16;
 const add=(kind:ClassicShape['kind'],label:string,detail:string,priority:number,position:ClassicShape['position']='below',anchorTime?:string)=>out.push({kind,label,detail,priority,position,anchorTime});
 if(solid&&gain>=3&&ratio>=1.2&&crossed.length>=4&&compression<10&&b.close>Math.max(m5,m10,m20)&&nearBase){
  const prices=crossed.map(n=>ma(n,i)),middle=Math.abs((Math.min(...prices)+Math.max(...prices))/2-(b.open+b.close)/2)/body,spread=(Math.max(...prices)/Math.min(...prices)-1)*100;
  const previous5=bars.slice(i-5,i).reduce((n,c)=>n+c.volume,0)/5,previous3=Math.max(...bars.slice(i-3,i).map(c=>c.volume));
  const strong=gain>5&&location>=.9&&ratio>=2&&b.volume>=previous5*1.5&&b.volume>=previous3*1.1&&crossed.includes(60)&&spread<5&&middle<=.25;
  add('multi',strong?'强力一阳多线':'一阳多线 · '+crossed.length+'线',`实体实际穿过MA${crossed.join('/')}；${crossed.includes(60)?'包含':'未穿过'}MA60。线束离散${spread.toFixed(2)}%，中轴偏移${(middle*100).toFixed(1)}%实体；20日相对量${ratio.toFixed(2)}倍，5日相对量${(b.volume/previous5).toFixed(2)}倍，收于振幅${Math.round(location*100)}%。${strong?'当日强度条件成立，后续3–5根排列与半位支撑仍须另行核验。':'未满足全部强力条件；不以穿过两三条线冒充一阳多线。'}`,strong?99:91);
 }
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
