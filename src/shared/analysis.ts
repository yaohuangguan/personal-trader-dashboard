import type { Candle } from './types';
export type TrendStage = '数据不足'|'蓄势'|'启动'|'主升'|'加速'|'分歧 / 走弱';
export type Dimension = { title: string; status: string; score: number; evidence: string[] };
export type Analysis = {
  ready: boolean; required: number; available: number; stage: TrendStage; score: number;
  bloom: boolean; aligned: boolean; rising: boolean; macdBull: boolean;
  ma: Record<number, number|null>; maSeries: Record<number,{time:string;value:number}[]>;
  volumeRatio: number|null; rsi: number|null; macd: { dif:number; dea:number; histogram:number } | null;
  atrPct: number|null; rangePosition: number|null; distanceToHighPct: number|null;
  dimensions: Dimension[]; warnings:string[]; asOf:string|null;
};
const periods=[5,10,20,60,120] as const;
const mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
function average(x:number[],i:number,period:number):number|null {
  return i+1<period?null:mean(x.slice(i-period+1,i+1));
}
function ema(xs:number[], n:number):number[] {
  const out:number[]=[]; const k=2/(n+1);
  for(const x of xs) out.push(out.length?x*k+out[out.length-1]*(1-k):x);
  return out;
}
function rsi14(closes:number[]):number|null {
  if(closes.length<15) return null;
  let ups=0,downs=0;
  for(let i=closes.length-14;i<closes.length;i++){const delta=closes[i]-closes[i-1]; ups+=Math.max(0,delta);downs+=Math.max(0,-delta);}
  if(downs===0)return 100;
  return 100-100/(1+ups/downs);
}
export function analyzeCandles(input:Candle[]):Analysis {
  const candles=input.filter(c=>c.close>0&&c.high>0&&c.low>0&&Number.isFinite(c.close)).slice().sort((a,b)=>a.time.localeCompare(b.time));
  const closes=candles.map(c=>c.close),volumes=candles.map(c=>c.volume);
  const n=candles.length,last=closes[n-1]??0,prev=closes[n-2]??0;
  const ma={} as Record<number,number|null>;
  const maSeries={} as Record<number,{time:string;value:number}[]>;
  for(const p of periods) {
    ma[p]=n?average(closes,n-1,p):null;
    maSeries[p]=candles.flatMap((c,i)=>{const value=average(closes,i,p);return value===null?[]:[{time:c.time,value:+value.toFixed(6)}];});
  }
  const ready=n>=121;
  const ordered=periods.every((p,i)=>i===periods.length-1 || (ma[p]!==null&&ma[periods[i+1]]!==null&&ma[p]!>ma[periods[i+1]]!));
  const sloped=periods.every(p=>{const prior=average(closes,n-6,p);return ma[p]!==null&&prior!==null&&ma[p]!>prior;});
  const vol20=n>=21?mean(volumes.slice(-21,-1)):null;
  const volumeRatio=vol20&&vol20>0?volumes[n-1]/vol20:null;
  const momentum=n>=2?last/prev-1:0;
  const e12=ema(closes,12),e26=ema(closes,26);
  const dif=e12.map((v,i)=>v-e26[i]),dea=ema(dif,9);
  const macd=n>=35?{dif:dif[n-1],dea:dea[n-1],histogram:dif[n-1]-dea[n-1]}:null;
  const macdBull=!!macd&&macd.dif>macd.dea&&macd.histogram>0;
  const lookback=candles.slice(-120),high=Math.max(...lookback.map(c=>c.high)),low=Math.min(...lookback.map(c=>c.low));
  const rangePosition=n>=20&&high>low?(last-low)/(high-low)*100:null;
  const distanceToHighPct=n>=20?(last/high-1)*100:null;
  const tr=candles.slice(-14).map((c,i,arr)=>{const previous=i?arr[i-1].close:closes[Math.max(0,n-arr.length-1)];return Math.max(c.high-c.low,Math.abs(c.high-previous),Math.abs(c.low-previous));});
  const atrPct=tr.length>=14&&last>0?mean(tr)/last*100:null;
  const above20=ma[20]!==null&&last>ma[20]!;
  const above60=ma[60]!==null&&last>ma[60]!;
  let consecutive20=0;
  for(let i=n-1;i>=19;i--){const avg=average(closes,i,20);if(avg!==null&&closes[i]>avg)consecutive20++;else break;}
  const high20=n>=20?Math.max(...candles.slice(-21,-1).map(c=>c.high)):null;
  const breakout=high20!==null&&last>high20;
  const priceScore=(ordered?22:0)+(sloped?16:0)+(above20?7:0)+(above60?5:0);
  const volumeScore=volumeRatio===null?0:(momentum>0&&volumeRatio>=1.4?18:momentum>0&&volumeRatio>=1?12:volumeRatio<0.8&&momentum<0?9:4);
  const timeScore=Math.min(15,Math.round(consecutive20/3)*3);
  const spaceScore=(breakout?10:0)+(rangePosition!==null&&rangePosition>=65&&rangePosition<=95?7:0);
  const score=ready?Math.min(100,priceScore+volumeScore+timeScore+spaceScore):0;
  const bloom=ready&&ordered&&sloped&&last>ma[5]!&&macdBull;
  let stage:TrendStage='数据不足';
  if(ready){
    if(!above60||(!above20&&!ordered))stage='分歧 / 走弱';
    else if(bloom&&volumeRatio!==null&&volumeRatio>=1.8&&rsi14(closes)!>=74)stage='加速';
    else if(bloom&&consecutive20>=10)stage='主升';
    else if(ordered&&above20)stage='启动';
    else stage='蓄势';
  }
  const dimensions:Dimension[]=[
    {title:'量 · Volume',status:volumeRatio===null?'暂无有效成交量':volumeRatio>=1.4?'相对放量':volumeRatio<=0.75?'相对缩量':'常态量能',score:volumeScore,evidence:[volumeRatio===null?'缺少成交量':('最新量 / 前20日均量：'+volumeRatio.toFixed(2)+'×'),momentum>0?'价格当日上涨':'价格当日未上涨']},
    {title:'价 · Price',status:ordered?'五线多头排列':'均线尚未完全多头排列',score:priceScore,evidence:['均线：5 / 10 / 20 / 60 / 120',sloped?'五条均线均在上行':'并非所有均线向上',above20?'收盘高于MA20':'收盘不高于MA20',macdBull?'MACD多头动量':'MACD动量未确认']},
    {title:'时 · Time',status:consecutive20>=10?'趋势持续':'趋势观察中',score:timeScore,evidence:['连续高于MA20：'+consecutive20+' 个交易日','观察窗口：最近120个交易日']},
    {title:'空 · Space',status:breakout?'突破前20日高点':'未确认20日突破',score:spaceScore,evidence:['120日区间位置：'+(rangePosition===null?'—':rangePosition.toFixed(1)+'%'),'距120日高点：'+(distanceToHighPct===null?'—':distanceToHighPct.toFixed(1)+'%'),'ATR(14) / 价格：'+(atrPct===null?'—':atrPct.toFixed(1)+'%')]}
  ];
  const warnings:string[]=['本模型为可解释的历史技术观察，不代表未来收益、入场点或交易建议。'];
  if(!ready)warnings.unshift('仅取得'+n+'根日K线，五线开花至少需要121根，不生成完整评分。');
  if(candles[n-1]?.time) {
    const lastDate=Date.parse(candles[n-1].time+'T00:00:00Z');
    if(Number.isFinite(lastDate) && Date.now()-lastDate>7*86400000)warnings.unshift('末根日线距今超过7天，可能已过期。');
  }
  if(vol20===0)warnings.unshift('成交量数据不可用，量能指标无法计算。');
  return {ready,required:121,available:n,stage,score,bloom,aligned:ordered,rising:sloped,macdBull,ma,maSeries,volumeRatio,rsi:rsi14(closes),macd,atrPct,rangePosition,distanceToHighPct,dimensions,warnings,asOf:candles[n-1]?.time??null};
}
