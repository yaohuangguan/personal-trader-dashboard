import {sma} from './chart-indicators';
import type {Candle} from './types';
export type Direction='bullish'|'bearish'|'neutral';
export function marketContext(bars:Candle[],provisional=false){
 const last=bars.at(-1),previous=bars.at(-2),periods=[5,10,20,30,60];
 const values=periods.map(p=>sma(bars,p).at(-1)?.value),ready=values.every(v=>v!=null);
 let state='样本不足',direction:Direction='neutral',detail='至少需要60根有效日线。';
 const window=bars.slice(-60),high=window.length?Math.max(...window.map(b=>b.high)):null,low=window.length?Math.min(...window.map(b=>b.low)):null;
 if(ready&&last){const ma=values as number[],ordered=ma.slice(0,-1).every((v,i)=>v>ma[i+1]),reverse=ma.slice(0,-1).every((v,i)=>v<ma[i+1]);
  const history=sma(bars,60),slope=history.length>=6?history.at(-1)!.value/history.at(-6)!.value-1:null;
  if(ordered&&last.close>=ma[2]){state='多头排列';direction='bullish';detail='MA5>10>20>30>60；短中期价格结构偏多，仍需观察量能和支撑。';}
  else if(reverse&&last.close<=ma[2]){state='空头排列';direction='bearish';detail='MA5<10<20<30<60；均线压制偏空，反弹需先确认结构改善。';}
  else if(slope!==null&&Math.abs(slope)<.01&&high&&low&&(high/low-1)<.2){state='箱体震荡';detail='60日均线近5根变化不足1%，近60日振幅小于20%；关注箱体上下沿。';}
  else if(last.close<ma[2]){state='趋势调整';direction='bearish';detail='收盘位于MA20下方，均线尚未形成完整空头排列。';}
  else {state='均线交织';detail='均线方向尚未统一；等待突破、量能与后续确认。';}
 }
 let label='量能待核验',bias:Direction='neutral',explanation='缺少前20日均量。';
 const base=bars.slice(-21,-1),mean=base.length===20?base.reduce((n,b)=>n+b.volume,0)/20:0,ratio=last&&mean>0?last.volume/mean:null;
 if(last&&previous&&ratio!==null){const gain=(last.close/previous.close-1)*100;
  if(provisional){label='盘中量能待确认';explanation='累计量尚未覆盖整日，不直接判断缩量；等待收盘复核。';}
  else if(ratio>=1.2&&gain>.5){label='量增价涨 · 偏多';bias='bullish';explanation='上涨伴随成交量高于前20日均量，承接较积极；留意过度放量与冲高回落。';}
  else if(ratio>=1.2&&gain<-.5){label='量增价跌 · 偏空';bias='bearish';explanation='下跌伴随放量，说明抛压加大；高低位置和后续支撑仍需复核，不直接归因为主力出货。';}
  else if(ratio<=.8&&gain<-.5){label='缩量回调 · 观察';explanation='抛压与参与度同步下降；守住支撑可继续观察，破位仍需控制风险。';}
  else if(ratio<=.8&&gain>.5){label='缩量上涨 · 谨慎';explanation='价格走高但参与量不足，突破持续性需要后续增量成交确认。';}
  else if(Math.abs(gain)<=.5){label=ratio>=1.2?'放量滞涨 · 分歧':'量价平衡 · 中性';explanation=ratio>=1.2?'成交活跃但价格进展有限，多空分歧加大；等待方向选择。':'价格与成交量暂未提供清晰方向。';}
  else {label=gain>0?'平量上涨 · 偏多':'平量回落 · 偏空';bias=gain>0?'bullish':'bearish';explanation='量能接近前20日均量，结合均线结构与关键价位观察延续。';}
 }
 return {structure:{state,direction,detail,period:'日线 · MA5/10/20/30/60',asOf:last?.time||null,support:low,resistance:high,provisional},priceVolume:{label,direction:bias,explanation,volumeRatio:ratio,provisional}};
}
