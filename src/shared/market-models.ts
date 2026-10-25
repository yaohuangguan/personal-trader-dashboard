import type {Candle} from './types';

/** Aggregate adjusted daily prices before grouping; volume always stays in its source unit. */
export function aggregateDaily(candles:Candle[], period:'week'|'month'):Candle[] {
 const groups=new Map<string,Candle>();
 for(const c of [...candles].sort((a,b)=>a.time.localeCompare(b.time))){
  const date=new Date(c.time+'T00:00:00Z');
  if(!Number.isFinite(date.getTime()))continue;
  if(period==='week')date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
  const key=period==='month'?c.time.slice(0,7):date.toISOString().slice(0,10),last=groups.get(key);
  groups.set(key,last?{time:c.time,open:last.open,high:Math.max(last.high,c.high),low:Math.min(last.low,c.low),close:c.close,volume:last.volume+c.volume}:{time:c.time,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume});
 }
 return [...groups.values()];
}

export type ChipBar=Candle&{turnover:number};
export function chipDistribution(input:ChipBar[],asOf?:string){
 const rows=[...new Map(input.filter(c=>(!asOf||c.time<=asOf)&&[c.high,c.low,c.close,c.turnover].every(Number.isFinite)&&c.low>0&&c.high>=c.low&&c.turnover>=0).map(c=>[c.time,c])).values()].sort((a,b)=>a.time.localeCompare(b.time));
 if(rows.length<2)return null;
 const lo=Math.min(...rows.map(c=>c.low)),hi=Math.max(...rows.map(c=>c.high)),pad=(hi-lo)*.02||lo*.02;
 const prices=Array.from({length:300},(_,i)=>lo-pad+(hi-lo+2*pad)*i/299);
 let chips=prices.map(()=>0),initialWeight=1;
 rows.forEach((c,i)=>{
  const mid=Math.min(c.high,Math.max(c.low,(c.high+c.low+c.close)/3));
  const weights=prices.map(p=>p<c.low||p>c.high?0:p<=mid?(mid===c.low?1:(p-c.low)/(mid-c.low)):(c.high===mid?1:(c.high-p)/(c.high-mid)));
  let total=weights.reduce((a,b)=>a+b,0);
  if(!total){weights[prices.reduce((best,p,j)=>Math.abs(p-mid)<Math.abs(prices[best]-mid)?j:best,0)]=1;total=1;}
  const turn=Math.min(1,c.turnover/100);
  chips=weights.map((w,j)=>i?chips[j]*(1-turn)+w/total*turn:w/total);
  if(i)initialWeight*=1-turn;
 });
 const sum=chips.reduce((a,b)=>a+b,0);chips=chips.map(x=>x/sum);
 const quantile=(q:number)=>{let n=0;for(let i=0;i<chips.length;i++){n+=chips[i];if(n>=q)return prices[i];}return prices.at(-1)!;};
 const range90=[quantile(.05),quantile(.95)] as const,range70=[quantile(.15),quantile(.85)] as const;
 const close=rows.at(-1)!.close;
 return {date:rows.at(-1)!.time,start:rows[0].time,days:rows.length,initialWeight,close,peak:prices[chips.indexOf(Math.max(...chips))],average:prices.reduce((n,p,i)=>n+p*chips[i],0),profit:chips.reduce((n,w,i)=>n+(prices[i]<=close?w:0),0),range90,range70,concentration90:(range90[1]-range90[0])/(range90[1]+range90[0])*100,concentration70:(range70[1]-range70[0])/(range70[1]+range70[0])*100,histogram:prices.map((price,i)=>({price,weight:chips[i]}))};
}

export type SentimentInput={up:number|null;down:number|null;broken:number|null;yesterdayMean:number|null};
/** Custom descriptive index v1, never a return forecast. No score with incomplete pools. */
export function marketSentiment(data:SentimentInput){
 const {up,down,broken,yesterdayMean}=data;
 if(up===null||down===null||broken===null||yesterdayMean===null||![up,down,broken,yesterdayMean].every(Number.isFinite)||Math.min(up,down,broken)<0||up+down===0||up+broken===0)return null;
 const balance=up/(up+down)*100,seal=up/(up+broken)*100,premium=Math.max(0,Math.min(100,50+yesterdayMean*5));
 return {score:Math.round(.4*balance+.3*seal+.3*premium),balance,seal,premium};
}
